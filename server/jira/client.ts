import type { z } from 'zod';
import type { JiraConfig } from '../config';
import { log } from '../logger';
import {
  ListAlertsResponseSchema,
  ListTeamsResponseSchema,
  RawAlertSchema,
  TenantInfoSchema,
  type RawAlert,
} from './schemas';

/**
 * Read-only client for the Jira Service Management Cloud Operations REST API.
 *
 * Endpoints used (all GET), from the official reference
 * https://developer.atlassian.com/cloud/jira/service-desk-ops/rest/v2/api-group-alerts/
 *
 *   GET https://api.atlassian.com/jsm/ops/api/{cloudId}/v1/alerts        List alerts
 *   GET https://api.atlassian.com/jsm/ops/api/{cloudId}/v1/alerts/{id}   Get alert
 *   GET https://api.atlassian.com/jsm/ops/api/{cloudId}/v1/teams         List teams
 *   GET https://{site}/_edge/tenant_info                                 cloudId lookup
 *
 * Authentication is HTTP Basic with an Atlassian account email and API token.
 * This class has no method that writes to Jira.
 */

const API_ROOT = 'https://api.atlassian.com/jsm/ops/api';
export const MAX_PAGE_SIZE = 100; // documented maximum of `size`
export const MAX_OFFSET_PLUS_SIZE = 20_000; // documented hard limit of the list endpoint

export type JiraErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'schema';

export class JiraApiError extends Error {
  constructor(
    readonly kind: JiraErrorKind,
    readonly status: number | null,
    /** Safe to show to the user: no response body, no credentials. */
    readonly publicMessage: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(publicMessage);
    this.name = 'JiraApiError';
  }
}

function errorForStatus(status: number, retryAfterMs: number | null): JiraApiError {
  switch (status) {
    case 401:
      return new JiraApiError('auth', status, 'Jira rejected the credentials (401). Check JIRA_EMAIL and JIRA_API_TOKEN.');
    case 403:
      return new JiraApiError('forbidden', status, 'The Jira account is not allowed to read Operations alerts (403).');
    case 404:
      return new JiraApiError('not_found', status, 'Jira returned 404. Check JIRA_SITE_URL / JIRA_CLOUD_ID and that Operations is enabled on the site.');
    case 400:
    case 422:
      return new JiraApiError('validation', status, `Jira rejected the request (${status}). Check JIRA_ALERT_QUERY.`);
    case 429:
      return new JiraApiError('rate_limit', status, 'Jira rate limit reached (429). The backend is waiting before it retries.', retryAfterMs);
    default:
      return new JiraApiError(status >= 500 ? 'server' : 'validation', status, `Jira returned an unexpected status (${status}).`);
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface AlertPage {
  alerts: RawAlert[];
  /** Total number of alerts matching the query, when Jira reports it. */
  total: number | null;
  hasNext: boolean;
  /** Items dropped because they failed validation. */
  skipped: number;
}

export interface ListAlertsParams {
  query?: string;
  offset: number;
  size: number;
  sort?: 'createdAt' | 'insertedAt' | 'lastOccurredAt' | 'priority';
  order?: 'asc' | 'desc';
}

export class JiraClient {
  private readonly authorization: string;
  private cloudIdPromise: Promise<string> | null = null;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  /** Total HTTP requests sent to Atlassian since start, for diagnostics. */
  requestCount = 0;

  constructor(
    private readonly config: JiraConfig,
    private readonly maxConcurrency = 4,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.authorization = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
  }

  async listAlerts(params: ListAlertsParams): Promise<AlertPage> {
    const body = await this.get('/v1/alerts', ListAlertsResponseSchema, {
      query: params.query,
      offset: params.offset,
      size: params.size,
      sort: params.sort ?? 'createdAt',
      order: params.order ?? 'desc',
    });
    const values = body.values ?? [];
    const alerts: RawAlert[] = [];
    let skipped = 0;
    for (const value of values) {
      const parsed = RawAlertSchema.safeParse(value);
      if (parsed.success) alerts.push(parsed.data);
      else skipped += 1;
    }
    return {
      alerts,
      total: body.count ?? null,
      // Documented convention: a missing or null `links.next` means last page.
      hasNext: values.length > 0 && Boolean(body.links?.next),
      skipped,
    };
  }

  async getAlert(id: string): Promise<RawAlert> {
    return this.get(`/v1/alerts/${encodeURIComponent(id)}`, RawAlertSchema);
  }

  async listTeams(): Promise<Map<string, string>> {
    const teams = await this.get('/v1/teams', ListTeamsResponseSchema);
    const names = new Map<string, string>();
    for (const team of teams) if (team.teamName) names.set(team.teamId, team.teamName);
    return names;
  }

  private cloudId(): Promise<string> {
    if (this.config.cloudId) return Promise.resolve(this.config.cloudId);
    this.cloudIdPromise ??= this.request(`${this.config.siteUrl}/_edge/tenant_info`, TenantInfoSchema, false)
      .then((info) => info.cloudId)
      .catch((error) => {
        this.cloudIdPromise = null; // allow a later retry
        throw error;
      });
    return this.cloudIdPromise;
  }

  private async get<S extends z.ZodType>(
    path: string,
    schema: S,
    query: Record<string, string | number | undefined> = {},
  ): Promise<z.infer<S>> {
    const cloudId = await this.cloudId();
    const url = new URL(`${API_ROOT}/${encodeURIComponent(cloudId)}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return this.request(url.toString(), schema, true);
  }

  /** GET with timeout, bounded concurrency, and limited retries. */
  private async request<S extends z.ZodType>(url: string, schema: S, authenticated: boolean): Promise<z.infer<S>> {
    await this.acquire();
    try {
      const maxAttempts = 3;
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await this.attempt(url, schema, authenticated);
        } catch (error) {
          const retryable =
            error instanceof JiraApiError &&
            (error.kind === 'network' || error.kind === 'server' || error.kind === 'rate_limit');
          if (!retryable || attempt >= maxAttempts) throw error;
          const wait = error.retryAfterMs ?? 500 * 2 ** (attempt - 1) + Math.random() * 250;
          // A long Retry-After is not waited out here: the caller serves
          // cached data and schedules the next synchronisation instead.
          if (wait > 10_000) throw error;
          await sleep(wait);
        }
      }
    } finally {
      this.release();
    }
  }

  private async attempt<S extends z.ZodType>(url: string, schema: S, authenticated: boolean): Promise<z.infer<S>> {
    const started = Date.now();
    // Only the path is logged: no query string, no headers, no body.
    const safePath = new URL(url).pathname.replace(/\/api\/[^/]+\//, '/api/{cloudId}/');
    let response: Response;
    this.requestCount += 1;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(authenticated ? { Authorization: this.authorization } : {}),
        },
        // Never follow a redirect with credentials attached.
        redirect: authenticated ? 'error' : 'follow',
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      log.warn('jira request failed', { path: safePath, reason: timedOut ? 'timeout' : 'network', ms: Date.now() - started });
      throw new JiraApiError('network', null, timedOut ? 'Jira did not answer in time.' : 'Could not reach Jira (network error).');
    }

    log.debug('jira request', { path: safePath, status: response.status, ms: Date.now() - started });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      log.warn('jira request rejected', { path: safePath, status: response.status });
      throw errorForStatus(response.status, parseRetryAfter(response.headers.get('retry-after')));
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new JiraApiError('schema', response.status, 'Jira returned a response that is not valid JSON.');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // Field paths only: the values could be alert content.
      const paths = parsed.error.issues.slice(0, 5).map((i) => i.path.join('.') || '(root)');
      log.error('jira response failed validation', { path: safePath, fields: paths.join(',') });
      throw new JiraApiError('schema', response.status, 'Jira returned an unexpected response format.');
    }
    return parsed.data;
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}

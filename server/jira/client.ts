import { z } from 'zod';
import type { ActionResult, AlertAction, AlertAttachment, AlertLogEntry, AlertNote, DirectoryEntry, DirectoryUser, Page } from '../../shared/actions';
import type { JiraConfig } from '../config';
import { log } from '../logger';
import {
  AcceptedResponseSchema,
  AttachmentSchema,
  AttachmentsPageSchema,
  AttachmentUrlSchema,
  EscalationsPageSchema,
  ListAlertsResponseSchema,
  ListTeamsResponseSchema,
  LogSchema,
  LogsPageSchema,
  NamedSchema,
  NoteSchema,
  NotesPageSchema,
  PlatformUserSchema,
  PlatformUsersSchema,
  RawAlertSchema,
  RequestStatusSchema,
  SchedulesPageSchema,
  TenantInfoSchema,
  type RawAlert,
} from './schemas';

/**
 * Client for the Jira Service Management Cloud Operations REST API.
 *
 * Endpoints, from the official reference and its OpenAPI document
 * https://developer.atlassian.com/cloud/jira/service-desk-ops/rest/v2/api-group-alerts/
 * (base https://api.atlassian.com/jsm/ops/api/{cloudId}):
 *
 *   Reads (GET)
 *     /v1/alerts                           List alerts
 *     /v1/alerts/{id}                      Get alert
 *     /v1/alerts/{id}/notes                List alert notes
 *     /v1/alerts/{id}/logs                 List alert logs
 *     /v1/alerts/{id}/attachments          List attachments
 *     /v1/alerts/{id}/attachments/{aid}    Get attachment download URL
 *     /v1/alerts/requests/{requestId}      Get request status
 *     /v1/teams                            List teams
 *     /v1/teams/{teamId}/escalations       List escalations
 *     /v1/schedules                        List schedules
 *   Writes, only from performAction() and only for enabled actions
 *     see shared/actions.ts for the action -> endpoint table
 *   Elsewhere
 *     https://{site}/_edge/tenant_info                cloudId lookup, no credentials
 *     https://{site}/rest/api/3/user/search            Jira platform: find users (assign, responders)
 *     https://{site}/rest/api/3/myself                 Jira platform: the account behind the token
 *
 * Authentication is HTTP Basic with an Atlassian account email and API token.
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

/** What a request is for: decides which message a failure gets. */
export type Purpose = 'sync' | 'read' | 'write';

function errorForStatus(status: number, retryAfterMs: number | null, purpose: Purpose = 'sync'): JiraApiError {
  if (purpose !== 'sync' && status !== 401 && status !== 429) {
    const verb = purpose === 'write' ? 'this action' : 'reading this';
    switch (status) {
      case 403:
        return new JiraApiError('forbidden', status, `Jira refused ${verb} for the configured account (403). Check its Operations permissions.`);
      case 404:
        return new JiraApiError('not_found', status, 'Jira did not find it (404). The alert may have been deleted.');
      case 400:
      case 422:
        return new JiraApiError('validation', status, `Jira rejected the request (${status}).`);
      default:
        if (status >= 500) return new JiraApiError('server', status, `Jira failed to process the request (${status}).`);
    }
  }
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

/** Request body of Create alert, as documented. */
export interface CreateAlertBody {
  message: string;
  alias?: string;
  description?: string;
  responders?: Array<{ id: string; type: 'team' | 'user' | 'escalation' | 'schedule' }>;
  tags?: string[];
  entity?: string;
  source?: string;
  priority?: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  extraProperties?: Record<string, string>;
  note?: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  authenticated?: boolean;
  purpose?: Purpose;
}

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Validates list items one by one; invalid ones are dropped. */
function parseEach<S extends z.ZodType>(values: unknown[] | null | undefined, schema: S): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  for (const value of values ?? []) {
    const parsed = schema.safeParse(value);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

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
  /** No request is sent before this time (set by a 429). */
  private pausedUntil = 0;

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

  // ---- Notes, activity log, attachments --------------------------------

  async listNotes(id: string): Promise<Page<AlertNote>> {
    const body = await this.get(`/v1/alerts/${encodeURIComponent(id)}/notes`, NotesPageSchema, { size: 100 }, 'read');
    return {
      values: parseEach(body.values, NoteSchema).map((n) => ({ id: n.id, createdAt: toTime(n.createdAt), note: n.note ?? '', owner: n.owner ?? null })),
      hasMore: Boolean(body.links?.next),
    };
  }

  async listLogs(id: string): Promise<Page<AlertLogEntry>> {
    const body = await this.get(`/v1/alerts/${encodeURIComponent(id)}/logs`, LogsPageSchema, { size: 100 }, 'read');
    return {
      values: parseEach(body.values, LogSchema).map((l) => ({ time: toTime(l.logTime), type: l.logType ?? null, text: l.log ?? '', owner: l.owner ?? null })),
      hasMore: Boolean(body.links?.next),
    };
  }

  async listAttachments(id: string): Promise<Page<AlertAttachment>> {
    const body = await this.get(`/v1/alerts/${encodeURIComponent(id)}/attachments`, AttachmentsPageSchema, { size: 100 }, 'read');
    return {
      values: parseEach(body.values, AttachmentSchema).map((a) => ({
        id: a.id,
        name: a.attachmentName ?? a.name ?? a.id,
        insertedAt: toTime(a.insertedAt ?? a.createdAt),
      })),
      hasMore: Boolean(body.links?.next),
    };
  }

  /** A temporary download link. It carries its own token, so it is never logged. */
  async attachmentUrl(id: string, attachmentId: string): Promise<string> {
    const body = await this.get(
      `/v1/alerts/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`,
      AttachmentUrlSchema,
      {},
      'read',
    );
    return body.url;
  }

  // ---- Pickers -----------------------------------------------------------

  async listSchedules(): Promise<DirectoryEntry[]> {
    const out: DirectoryEntry[] = [];
    // size is at most 50 for this endpoint; ten pages are plenty for a picker.
    for (let offset = 0; offset < 500; offset += 50) {
      const body = await this.get('/v1/schedules', SchedulesPageSchema, { size: 50, offset }, 'read');
      const page = parseEach(body.values, NamedSchema);
      for (const s of page) if (s.enabled !== false) out.push({ id: s.id, name: s.name ?? s.id });
      if (!body.links?.next || page.length === 0) break;
    }
    return out;
  }

  async listEscalations(teamId: string): Promise<DirectoryEntry[]> {
    const body = await this.get(`/v1/teams/${encodeURIComponent(teamId)}/escalations`, EscalationsPageSchema, { size: 100 }, 'read');
    return parseEach(body.values, NamedSchema)
      .filter((e) => e.enabled !== false)
      .map((e) => ({ id: e.id, name: e.name ?? e.id }));
  }

  /** Jira platform "Find users". Needs the Browse users and groups permission. */
  async searchUsers(query: string): Promise<DirectoryUser[]> {
    const url = new URL(`${this.config.siteUrl}/rest/api/3/user/search`);
    url.searchParams.set('query', query);
    url.searchParams.set('maxResults', '20');
    const users = await this.request(url.toString(), PlatformUsersSchema, { purpose: 'read' });
    return parseEach(users, PlatformUserSchema)
      .filter((u) => u.active !== false && (u.accountType ?? 'atlassian') === 'atlassian')
      .map((u) => ({ accountId: u.accountId, displayName: u.displayName ?? u.accountId }));
  }

  /** Jira platform "Get current user": the account the API token belongs to. */
  async myself(): Promise<DirectoryUser> {
    const user = await this.request(`${this.config.siteUrl}/rest/api/3/myself`, PlatformUserSchema, { purpose: 'read' });
    return { accountId: user.accountId, displayName: user.displayName ?? user.accountId };
  }

  // ---- Writes ------------------------------------------------------------

  /**
   * Sends one action and waits a few seconds for Jira to process it.
   * Jira answers 202 and processes the request asynchronously; the outcome
   * is read from Get request status. Not retried on network errors or 5xx,
   * because the request may already have been accepted.
   */
  async performAction(id: string, action: AlertAction): Promise<ActionResult> {
    const path = `/v1/alerts/${encodeURIComponent(id)}`;
    switch (action.action) {
      case 'acknowledge':
      case 'unacknowledge':
      case 'close':
        return this.sendAsync('POST', `${path}/${action.action}`, undefined);
      case 'snooze':
        return this.sendAsync('POST', `${path}/snooze`, { endTime: action.endTime });
      case 'assign':
        return this.sendAsync('POST', `${path}/assign`, { accountId: action.accountId });
      case 'addResponder':
        return this.sendAsync('POST', `${path}/responders`, { id: action.responder.id, type: action.responder.type });
      case 'escalate':
        return this.sendAsync('POST', `${path}/escalate`, { escalationId: action.escalationId });
      case 'priority':
        return this.sendAsync('PATCH', `${path}/priority`, { priority: action.priority });
      case 'addTags':
        return this.sendAsync('POST', `${path}/tags`, { tags: action.tags });
      case 'removeTags':
        return this.sendAsync('DELETE', `${path}/tags`, { tags: action.tags });
      case 'addNote':
        // Add alert note answers 200 with the note itself: done synchronously.
        await this.write('POST', `${path}/notes`, { note: action.note }, z.unknown());
        return { state: 'done', message: null };
    }
  }

  private async sendAsync(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown): Promise<ActionResult> {
    const accepted = await this.write(method, path, body, AcceptedResponseSchema);
    if (!accepted.requestId) return { state: 'pending', message: null };
    const { state, message } = await this.awaitRequest(accepted.requestId);
    return { state, message };
  }

  /**
   * Create alert (POST /v1/alerts). Not used by the application: only by the
   * script that fills a test site with sample alerts (scripts/jira-test-alerts.ts).
   */
  async createAlert(body: CreateAlertBody): Promise<ActionResult & { alertId: string | null }> {
    const accepted = await this.write('POST', '/v1/alerts', body, AcceptedResponseSchema);
    if (!accepted.requestId) return { state: 'pending', message: null, alertId: null };
    return this.awaitRequest(accepted.requestId);
  }

  /** Waits between Get request status polls: about eight seconds in total. */
  statusPollDelaysMs: number[] = [300, 500, 800, 1200, 1600, 2000, 2000];

  private async awaitRequest(requestId: string): Promise<ActionResult & { alertId: string | null }> {
    for (const delay of this.statusPollDelaysMs) {
      await sleep(delay);
      let status: z.infer<typeof RequestStatusSchema>;
      try {
        status = await this.get(`/v1/alerts/requests/${encodeURIComponent(requestId)}`, RequestStatusSchema, {}, 'read');
      } catch (error) {
        // 404 means "not processed yet" for this endpoint, and a 429 only
        // delays the answer: keep asking. Any other failure means the outcome
        // is unknown; the action itself was accepted.
        if (error instanceof JiraApiError && (error.kind === 'not_found' || error.kind === 'rate_limit')) continue;
        return { state: 'pending', message: null, alertId: null };
      }
      if (typeof status.isSuccess !== 'boolean') continue;
      const message = status.status ? status.status.slice(0, 300) : null;
      if (status.isSuccess) return { state: 'done', message, alertId: status.alertId ?? null };
      throw new JiraApiError('validation', 200, message ? `Jira did not apply the action: ${message}` : 'Jira did not apply the action.');
    }
    return { state: 'pending', message: null, alertId: null };
  }

  private async write<S extends z.ZodType>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown, schema: S): Promise<z.infer<S>> {
    const cloudId = await this.cloudId();
    const url = `${API_ROOT}/${encodeURIComponent(cloudId)}${path}`;
    return this.request(url, schema, { method, body, purpose: 'write' });
  }

  private cloudId(): Promise<string> {
    if (this.config.cloudId) return Promise.resolve(this.config.cloudId);
    this.cloudIdPromise ??= this.request(`${this.config.siteUrl}/_edge/tenant_info`, TenantInfoSchema, { authenticated: false })
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
    purpose: Purpose = 'sync',
  ): Promise<z.infer<S>> {
    const cloudId = await this.cloudId();
    const url = new URL(`${API_ROOT}/${encodeURIComponent(cloudId)}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return this.request(url.toString(), schema, { purpose });
  }

  /**
   * One request with timeout, bounded concurrency and limited retries.
   * Reads are retried on network errors, 5xx and 429. Writes only on 429,
   * which guarantees the first attempt was not processed.
   */
  private async request<S extends z.ZodType>(url: string, schema: S, options: RequestOptions = {}): Promise<z.infer<S>> {
    const isWrite = (options.method ?? 'GET') !== 'GET';
    await this.acquire();
    try {
      const maxAttempts = 3;
      for (let attempt = 1; ; attempt += 1) {
        // After a 429, every request waits, not only the one that was refused.
        const pause = this.pausedUntil - Date.now();
        if (pause > 0) {
          if (pause > 10_000) throw new JiraApiError('rate_limit', 429, 'Jira rate limit reached (429). The backend is waiting before it retries.', pause);
          await sleep(pause);
        }
        try {
          return await this.attempt(url, schema, options);
        } catch (error) {
          if (error instanceof JiraApiError && error.kind === 'rate_limit') {
            const wait = error.retryAfterMs ?? 1000 * attempt;
            this.pausedUntil = Math.max(this.pausedUntil, Date.now() + wait);
          }
          const retryable =
            error instanceof JiraApiError &&
            (error.kind === 'rate_limit' || (!isWrite && (error.kind === 'network' || error.kind === 'server')));
          if (!retryable || attempt >= maxAttempts) throw error;
          if (error.kind === 'rate_limit') {
            // The shared pause above does the waiting. A long Retry-After is
            // not waited out here: the caller serves cached data instead.
            if (this.pausedUntil - Date.now() > 10_000) throw error;
            continue;
          }
          await sleep(500 * 2 ** (attempt - 1) + Math.random() * 250);
        }
      }
    } finally {
      this.release();
    }
  }

  private async attempt<S extends z.ZodType>(url: string, schema: S, options: RequestOptions): Promise<z.infer<S>> {
    const { method = 'GET', body, authenticated = true, purpose = 'sync' } = options;
    const started = Date.now();
    // Only the method and path are logged: no query string, no headers, no body.
    const safePath = `${method} ${new URL(url).pathname.replace(/^\/jsm\/ops\/api\/[^/]+\//, '/jsm/ops/api/{cloudId}/')}`;
    let response: Response;
    this.requestCount += 1;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(authenticated ? { Authorization: this.authorization } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
      const retryAfter = response.headers.get('retry-after');
      log.warn('jira request rejected', { path: safePath, status: response.status, ...(retryAfter ? { retryAfter } : {}) });
      throw errorForStatus(response.status, parseRetryAfter(response.headers.get('retry-after')), purpose);
    }

    let json: unknown;
    try {
      // 204 No Content, or an empty 202.
      const text = await response.text();
      json = text === '' ? {} : JSON.parse(text);
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

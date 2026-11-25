import { randomInt } from 'node:crypto';
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
  HeartbeatSchema,
  MaintenanceSchema,
  OnCallResponseSchema,
  OpsEntitySchema,
  PagedValuesSchema,
  ScheduleSchema,
  CreatedIdSchema,
  RawContactSchema,
  RawNotificationRuleSchema,
  type RawContact,
  type RawNotificationRule,
  type RawMaintenance,
  type RawOnCallParticipant,
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
 * OAuth uses the ex/jira gateway; basic authentication uses the direct endpoints.
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
export type Purpose = 'sync' | 'read' | 'write' | 'background';

/**
 * Jira's own reason from a refused write (for example a plan or permission
 * limit), cut short and stripped of control characters. Shown to the user
 * who asked for the write; never logged.
 */
async function refusalText(response: Response): Promise<string | null> {
  try {
    const text = (await response.text()).slice(0, 4000);
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    const parts: string[] = [];
    const add = (v: unknown) => {
      if (typeof v === 'string' && v.trim()) parts.push(v.trim());
    };
    add(b.message);
    add(b.errorMessage);
    if (Array.isArray(b.errorMessages)) b.errorMessages.forEach(add);
    if (Array.isArray(b.errors)) {
      for (const e of b.errors) if (e && typeof e === 'object') add((e as Record<string, unknown>).title ?? (e as Record<string, unknown>).message ?? (e as Record<string, unknown>).detail);
    } else if (b.errors && typeof b.errors === 'object') {
      Object.values(b.errors as Record<string, unknown>).forEach(add);
    }
    const joined = [...new Set(parts)].join(' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    return joined ? joined.slice(0, 300) : null;
  } catch {
    return null;
  }
}

/** Kind of a write that Jira refused with a reason. */
function refusalKind(status: number): JiraErrorKind {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'validation';
}

/** Messages for a read or write the user asked for; null where the sync message applies. */
function userRequestError(status: number, purpose: 'read' | 'write'): JiraApiError | null {
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
      return status >= 500 ? new JiraApiError('server', status, `Jira failed to process the request (${status}).`) : null;
  }
}

function errorForStatus(status: number, retryAfterMs: number | null, purpose: Purpose = 'sync', detail: string | null = null): JiraApiError {
  if (purpose === 'write' && detail && status !== 401 && status !== 429) {
    return new JiraApiError(refusalKind(status), status, `Jira refused the request (${status}): ${detail}`);
  }
  if ((purpose === 'read' || purpose === 'write') && status !== 401 && status !== 429) {
    const error = userRequestError(status, purpose);
    if (error) return error;
  }
  return syncError(status, retryAfterMs);
}

/** Messages for the background sync: they point at the configuration. */
function syncError(status: number, retryAfterMs: number | null): JiraApiError {
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

const MAX_ATTEMPTS = 3;

/**
 * Reads are retried on network errors, 5xx and 429. Writes only on 429,
 * which guarantees the first attempt was not processed.
 */
function isRetryable(error: unknown, isWrite: boolean): error is JiraApiError {
  return (
    error instanceof JiraApiError &&
    (error.kind === 'rate_limit' || (!isWrite && (error.kind === 'network' || error.kind === 'server')))
  );
}

/** The error for a response that is not OK. Jira's reason is read only from a refused write. */
async function rejection(response: Response, purpose: Purpose, safePath: string): Promise<JiraApiError> {
  const wantsReason = purpose === 'write' && response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 429;
  const detail = wantsReason ? await refusalText(response) : null;
  if (!wantsReason) await response.body?.cancel().catch(() => undefined);
  const retryAfter = response.headers.get('retry-after');
  log.warn('jira request rejected', { path: safePath, status: response.status, ...(retryAfter ? { retryAfter } : {}) });
  return errorForStatus(response.status, parseRetryAfter(response.headers.get('retry-after')), purpose, detail);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    // 204 No Content, or an empty 202.
    const text = await response.text();
    return text === '' ? {} : JSON.parse(text);
  } catch {
    throw new JiraApiError('schema', response.status, 'Jira returned a response that is not valid JSON.');
  }
}

function parseResponse<S extends z.ZodType>(json: unknown, schema: S, status: number, safePath: string): z.infer<S> {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // Field paths only: the values could be alert content.
    const paths = parsed.error.issues.slice(0, 5).map((i) => i.path.join('.') || '(root)');
    log.error('jira response failed validation', { path: safePath, fields: paths.join(',') });
    throw new JiraApiError('schema', status, 'Jira returned an unexpected response format.');
  }
  return parsed.data;
}

/** Fetch options of one Jira request: a JSON or multipart body, and the credentials only when authenticated. */
function requestInit(method: string, body: unknown, authenticated: boolean, authorization: string, timeoutMs: number): RequestInit {
  const multipart = body instanceof FormData;
  return {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }),
      ...(authenticated ? { Authorization: authorization } : {}),
    },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
    // Never follow a redirect with credentials attached.
    redirect: authenticated ? 'error' : 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  };
}

/** Request body of Create global / team maintenance (CreateMaintenanceRequest), as documented. */
export type MaintenanceEntityType = 'integration' | 'policy' | 'sync';
export type MaintenanceRuleState = 'disabled' | 'enabled';

export interface CreateMaintenanceBody {
  description?: string;
  startDate?: string;
  endDate?: string;
  rules: Array<{ entity: { id: string; type: MaintenanceEntityType }; state: MaintenanceRuleState }>;
}

/** Request body of Create alert, as documented. */
export interface CreateAlertBody {
  message: string;
  /** Custom actions offered on the alert. */
  actions?: string[];
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

function maintenanceEntityPath(kind: 'integration' | 'policy' | 'sync'): string {
  if (kind === 'integration') return '/v1/integrations';
  if (kind === 'policy') return '/v1/alerts/policies';
  return '/v1/syncs';
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
  background?: boolean;
}

export class JiraClient {
  private readonly authorization: string;
  private cloudIdPromise: Promise<string> | null = null;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly backgroundWaiting: Array<() => void> = [];
  /** Total HTTP requests sent to Atlassian since start, for diagnostics. */
  requestCount = 0;
  /** No request is sent before this time (set by a 429). */
  private pausedUntil = 0;

  constructor(
    private readonly config: JiraConfig,
    private readonly maxConcurrency = 4,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly bearer?: { token(): Promise<string>; invalidate(): void },
  ) {
    if (!bearer && (!config.email || !config.apiToken)) throw new Error('Jira basic credentials are missing.');
    if (bearer && !config.cloudId) throw new Error('OAuth requires an authorized site.');
    const credentials = `${config.email}:${config.apiToken}`;
    this.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  private get platformRoot(): string {
    return this.bearer ? `https://api.atlassian.com/ex/jira/${encodeURIComponent(this.config.cloudId!)}` : this.config.siteUrl;
  }

  private async opsRoot(): Promise<string> {
    return this.bearer ? `${this.platformRoot}/jsm/ops/api` : `${API_ROOT}/${encodeURIComponent(await this.cloudId())}`;
  }

  async listAlerts(params: ListAlertsParams): Promise<AlertPage> {
    const body = await this.get('/v1/alerts', ListAlertsResponseSchema, {
      query: params.query,
      offset: params.offset,
      size: params.size,
      sort: params.sort ?? 'createdAt',
      order: params.order ?? 'desc',
    }, params.background ? 'background' : 'sync');
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

  async uploadAttachment(id: string, name: string, data: Buffer): Promise<AlertAttachment> {
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(data)]), name);
    const attachment = await this.write('POST', `/v1/alerts/${encodeURIComponent(id)}/attachments`, form, AttachmentSchema);
    return { id: attachment.id, name: attachment.attachmentName ?? attachment.name ?? name, insertedAt: toTime(attachment.insertedAt ?? attachment.createdAt) };
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
    const url = new URL(`${this.platformRoot}/rest/api/3/user/search`);
    url.searchParams.set('query', query);
    url.searchParams.set('maxResults', '20');
    const users = await this.request(url.toString(), PlatformUsersSchema, { purpose: 'read' });
    return parseEach(users, PlatformUserSchema)
      .filter((u) => u.active !== false && (u.accountType ?? 'atlassian') === 'atlassian')
      .map((u) => ({ accountId: u.accountId, displayName: u.displayName ?? u.accountId }));
  }

  /** Jira platform "Get current user": the account the API token belongs to. */
  async myself(): Promise<DirectoryUser> {
    const user = await this.request(`${this.platformRoot}/rest/api/3/myself`, PlatformUserSchema, { purpose: 'read' });
    return { accountId: user.accountId, displayName: user.displayName ?? user.accountId };
  }

  // ---- Operations context (maintenances, heartbeats, on-call) -------------

  /** Reads up to `maxPages` pages of an offset-paged list. */
  private async pages<S extends z.ZodType>(path: string, item: S, size: number, maxPages: number, query: Record<string, string> = {}): Promise<z.infer<S>[]> {
    const out: z.infer<S>[] = [];
    for (let page = 0, offset = 0; page < maxPages; page += 1, offset += size) {
      const body = await this.get(path, PagedValuesSchema, { ...query, offset, size }, 'read');
      const values = parseEach(body.values, item);
      out.push(...values);
      if (!body.links?.next || (body.values ?? []).length === 0) break;
    }
    return out;
  }

  /** Active and planned maintenances: global, or of one team. */
  listMaintenances(teamId?: string): Promise<RawMaintenance[]> {
    const path = teamId ? `/v1/teams/${encodeURIComponent(teamId)}/maintenances` : '/v1/maintenances';
    return this.pages(path, MaintenanceSchema, 100, 5, { type: 'non-expired' });
  }

  /** What a maintenance rule can point at: integrations, global alert policies or syncs. */
  listMaintenanceEntities(kind: 'integration' | 'policy' | 'sync'): Promise<Array<z.infer<typeof OpsEntitySchema>>> {
    return this.pages(maintenanceEntityPath(kind), OpsEntitySchema, 100, 5);
  }

  /** Schedules with their owning team (size is at most 50 for this endpoint). */
  listScheduleDetails(): Promise<Array<z.infer<typeof ScheduleSchema>>> {
    return this.pages('/v1/schedules', ScheduleSchema, 50, 10);
  }

  listHeartbeats(teamId: string): Promise<Array<z.infer<typeof HeartbeatSchema>>> {
    return this.pages(`/v1/teams/${encodeURIComponent(teamId)}/heartbeats`, HeartbeatSchema, 100, 5);
  }

  /** Who is on call now for one schedule, as the nested participant tree. */
  async listOnCall(scheduleId: string): Promise<RawOnCallParticipant[]> {
    const body = await this.get(`/v1/schedules/${encodeURIComponent(scheduleId)}/on-calls`, OnCallResponseSchema, { flat: 'false' }, 'read');
    if (body.onCallParticipants) return body.onCallParticipants;
    return (body.onCallUsers ?? []).map((id) => ({ id, type: 'user' }));
  }

  /** Create global or team maintenance. Jira answers 201 with the maintenance (no request status). */
  createMaintenance(body: CreateMaintenanceBody, teamId: string | null): Promise<RawMaintenance> {
    const path = teamId ? `/v1/teams/${encodeURIComponent(teamId)}/maintenances` : '/v1/maintenances';
    return this.write('POST', path, body, MaintenanceSchema);
  }

  /** Cancel global or team maintenance: ends an active one early, or calls off a planned one. */
  cancelMaintenance(id: string, teamId: string | null): Promise<RawMaintenance> {
    const path = teamId
      ? `/v1/teams/${encodeURIComponent(teamId)}/maintenances/${encodeURIComponent(id)}/cancel`
      : `/v1/maintenances/${encodeURIComponent(id)}/cancel`;
    return this.write('POST', path, undefined, MaintenanceSchema);
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
      case 'customAction':
        return this.sendAsync('POST', `${path}/action`, { actionName: action.actionName });
      case 'addNote':
        // Add alert note answers 200 with the note itself: done synchronously.
        await this.write('POST', `${path}/notes`, { note: action.note }, z.unknown());
        return { state: 'done', message: null };
      case 'editNote':
        await this.write('PATCH', `${path}/notes/${encodeURIComponent(action.noteId)}`, { note: action.note }, z.unknown());
        return { state: 'done', message: null };
      case 'deleteNote':
        await this.write('DELETE', `${path}/notes/${encodeURIComponent(action.noteId)}`, undefined, z.unknown());
        return { state: 'done', message: null };
    }
  }

  private async sendAsync(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown): Promise<ActionResult> {
    const accepted = await this.write(method, path, body, AcceptedResponseSchema);
    if (!accepted.requestId) return { state: 'pending', message: null };
    const { state, message } = await this.awaitRequest(accepted.requestId);
    return { state, message };
  }

  // ---- Test-site tools: used by scripts/ only, never by the application ----

  /** Create heartbeat (POST /v1/teams/{teamId}/heartbeats). */
  async createHeartbeat(
    teamId: string,
    body: { name: string; description?: string; interval: number; intervalUnit: 'minutes' | 'hours' | 'days'; enabled: boolean; alertMessage?: string; alertTags?: string[]; alertPriority?: CreateAlertBody['priority'] },
  ): Promise<void> {
    await this.write('POST', `/v1/teams/${encodeURIComponent(teamId)}/heartbeats`, body, z.unknown());
  }

  /** Ping heartbeat (GET /v1/teams/{teamId}/heartbeats/ping?name=). */
  // ---- Personal notification settings (the signed-in user's own) ----------

  listContacts(): Promise<RawContact[]> {
    return this.pages('/v1/users/contacts', RawContactSchema, 100, 5);
  }

  listNotificationRules(): Promise<RawNotificationRule[]> {
    return this.pages('/v1/notification-rules', RawNotificationRuleSchema, 100, 5);
  }

  async createContact(method: string, to: string): Promise<void> {
    await this.write('POST', '/v1/users/contacts', { method, to }, z.unknown());
  }

  async updateContact(id: string, to: string): Promise<void> {
    await this.write('PATCH', `/v1/users/contacts/${encodeURIComponent(id)}`, { to }, z.unknown());
  }

  async setContactEnabled(id: string, enabled: boolean): Promise<void> {
    await this.write('PATCH', `/v1/users/contacts/${encodeURIComponent(id)}/${enabled ? 'activate' : 'deactivate'}`, undefined, z.unknown());
  }

  async deleteContact(id: string): Promise<void> {
    await this.write('DELETE', `/v1/users/contacts/${encodeURIComponent(id)}`, undefined, z.unknown());
  }

  /** Jira answers 201 with the rule. */
  createNotificationRule(body: unknown): Promise<{ id: string }> {
    return this.write('POST', '/v1/notification-rules', body, CreatedIdSchema);
  }

  /** Fields left out keep their value. Jira requires name, actionType and enabled. */
  async updateNotificationRule(id: string, body: unknown): Promise<void> {
    await this.write('PATCH', `/v1/notification-rules/${encodeURIComponent(id)}`, body, z.unknown());
  }

  async deleteNotificationRule(id: string): Promise<void> {
    await this.write('DELETE', `/v1/notification-rules/${encodeURIComponent(id)}`, undefined, z.unknown());
  }

  async createRuleStep(ruleId: string, body: unknown): Promise<void> {
    await this.write('POST', `/v1/notification-rules/${encodeURIComponent(ruleId)}/steps`, body, z.unknown());
  }

  async updateRuleStep(ruleId: string, id: string, body: unknown): Promise<void> {
    await this.write('PATCH', `/v1/notification-rules/${encodeURIComponent(ruleId)}/steps/${encodeURIComponent(id)}`, body, z.unknown());
  }

  async deleteRuleStep(ruleId: string, id: string): Promise<void> {
    await this.write('DELETE', `/v1/notification-rules/${encodeURIComponent(ruleId)}/steps/${encodeURIComponent(id)}`, undefined, z.unknown());
  }

  async pingHeartbeat(teamId: string, name: string): Promise<void> {
    await this.get(`/v1/teams/${encodeURIComponent(teamId)}/heartbeats/ping`, z.unknown(), { name }, 'read');
  }

  /** Delete heartbeat (DELETE /v1/teams/{teamId}/heartbeats?name=). */
  async deleteHeartbeat(teamId: string, name: string): Promise<void> {
    await this.write('DELETE', `/v1/teams/${encodeURIComponent(teamId)}/heartbeats?name=${encodeURIComponent(name)}`, undefined, z.unknown());
  }

  /**
   * Create alert (POST /v1/alerts). Not used by the application: only by the
   * scripts that fill a test site (scripts/jira-test-alerts.ts, scripts/jira-simulate.ts).
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
    const url = `${await this.opsRoot()}${path}`;
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
    const url = new URL(`${await this.opsRoot()}${path}`);
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
    await this.acquire(options.purpose === 'background');
    try {
      for (let attempt = 1; ; attempt += 1) {
        // After a 429, every request waits, not only the one that was refused.
        const pause = this.pendingPause();
        if (pause > 0) await sleep(pause);
        try {
          return await this.attempt(url, schema, options);
        } catch (error) {
          this.pauseAfterRateLimit(error, attempt);
          const delay = this.retryDelay(error, attempt, isWrite);
          if (delay > 0) await sleep(delay);
        }
      }
    } finally {
      this.release();
    }
  }

  /** How long every request still waits after a 429. A pause above 10 s fails at once. */
  private pendingPause(): number {
    const pause = this.pausedUntil - Date.now();
    if (pause > 10_000) throw new JiraApiError('rate_limit', 429, 'Jira rate limit reached (429). The backend is waiting before it retries.', pause);
    return pause;
  }

  /** A 429 pauses all requests, for Retry-After or one more second per attempt. */
  private pauseAfterRateLimit(error: unknown, attempt: number): void {
    if (error instanceof JiraApiError && error.kind === 'rate_limit') {
      const wait = error.retryAfterMs ?? 1000 * attempt;
      this.pausedUntil = Math.max(this.pausedUntil, Date.now() + wait);
    }
  }

  /**
   * The wait before the next attempt, or the error thrown again when there
   * is none. A 429 returns 0: the shared pause does the waiting.
   */
  private retryDelay(error: unknown, attempt: number, isWrite: boolean): number {
    if (!isRetryable(error, isWrite) || attempt >= MAX_ATTEMPTS) throw error;
    if (error.kind === 'rate_limit') {
      // A long Retry-After is not waited out here: the caller serves cached data instead.
      if (this.pausedUntil - Date.now() > 10_000) throw error;
      return 0;
    }
    return 500 * 2 ** (attempt - 1) + randomInt(250);
  }

  private async attempt<S extends z.ZodType>(url: string, schema: S, options: RequestOptions): Promise<z.infer<S>> {
    const { method = 'GET', body, authenticated = true, purpose = 'sync' } = options;
    const started = Date.now();
    // Only the method and path are logged: no query string, no headers, no body.
    const safePath = `${method} ${new URL(url).pathname.replace(/^\/jsm\/ops\/api\/[^/]+\//, '/jsm/ops/api/{cloudId}/')}`;
    let response: Response;
    this.requestCount += 1;
    const authorization = this.bearer ? `Bearer ${await this.bearer.token()}` : this.authorization;
    try {
      response = await this.fetchImpl(url, requestInit(method, body, authenticated, authorization, this.config.requestTimeoutMs));
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      log.warn('jira request failed', { path: safePath, reason: timedOut ? 'timeout' : 'network', ms: Date.now() - started });
      throw new JiraApiError('network', null, timedOut ? 'Jira did not answer in time.' : 'Could not reach Jira (network error).');
    }

    log.debug('jira request', { path: safePath, status: response.status, ms: Date.now() - started });
    if (response.status === 401 && this.bearer) {
      this.bearer.invalidate();
      await response.body?.cancel();
      throw new JiraApiError('auth', 401, 'Your Jira authorization expired. Sign in again.');
    }
    if (!response.ok) throw await rejection(response, purpose, safePath);
    return parseResponse(await readJson(response), schema, response.status, safePath);
  }

  private acquire(background: boolean): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => (background ? this.backgroundWaiting : this.waiting).push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift() ?? this.backgroundWaiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}

import type {
  ActionResult,
  AlertAction,
  AlertAttachment,
  AlertLogEntry,
  AlertNote,
  DirectoryEntry,
  DirectoryUser,
  Page,
} from '../../shared/actions';
import type { AlertDetail, AlertsResponse, HistoryResponse, StatusResponse } from '../../shared/types';
import { DESKTOP_CONFIG_API, type DesktopConfigResponse, type DesktopConfigSaveRequest, type DesktopConfigSaveResponse } from '../../shared/desktopConfig';
import { HISTORY_ANALYSIS_RESULT_PAGE_SIZE, type HistoryAnalysisResultPage, type HistoryAnalysisStatus, type HistoryMonth } from '../../shared/historyAnalysis';

/**
 * The frontend talks only to the local backend (/api). It never calls Jira
 * and never sees credentials.
 */

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** The error message of a failed response: the backend's own, else one for its status. */
async function failureMessage(response: Response): Promise<string> {
  let message = `The backend answered with status ${response.status}.`;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      message = body.error;
    }
  } catch {
    // Not JSON (for example the dev proxy while the backend restarts).
    if (response.status >= 500) message = 'The Alert Center backend is not reachable. Is the server running?';
  }
  return message;
}

export async function getJson<T>(url: string, signal?: AbortSignal, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal, headers: { Accept: 'application/json', ...init.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError('The Alert Center backend is not reachable. Is the server running?', null);
  }
  if (!response.ok) {
    if (response.status === 401 && response.headers.get('X-Alert-Center-Login') === '1') {
      globalThis.location.replace('/api/auth/login');
    }
    throw new ApiRequestError(await failureMessage(response), response.status);
  }
  return (await response.json()) as T;
}

export function fetchStatus(signal?: AbortSignal): Promise<StatusResponse> {
  return getJson('/api/status', signal);
}

export function fetchAlerts(
  options: { knownVersion?: string; force?: boolean },
  signal?: AbortSignal,
): Promise<AlertsResponse> {
  const params = new URLSearchParams();
  if (options.knownVersion) params.set('known', options.knownVersion);
  if (options.force) params.set('refresh', '1');
  const query = params.toString();
  const search = query ? `?${query}` : '';
  return getJson(`/api/alerts${search}`, signal);
}

export function fetchAlertDetail(id: string, signal?: AbortSignal): Promise<AlertDetail> {
  return getJson(`/api/alerts/${encodeURIComponent(id)}`, signal);
}

export function fetchHistory(window: { from: string; to: string }, offset: number, signal?: AbortSignal): Promise<HistoryResponse> {
  const params = new URLSearchParams({ ...window, offset: String(offset) });
  return getJson(`/api/history?${params}`, signal);
}

export function startHistoryAnalysis(from: string, to: string, signal?: AbortSignal): Promise<HistoryAnalysisStatus> {
  return getJson('/api/history-analysis', signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Alert-Center-Action': '1' },
    body: JSON.stringify({ from, to }),
  });
}

export function fetchHistoryAnalysis(signal?: AbortSignal): Promise<HistoryAnalysisStatus | null> {
  return getJson('/api/history-analysis', signal);
}

export async function fetchHistoryAnalysisResults(id: string, signal?: AbortSignal): Promise<HistoryMonth[]> {
  const months: HistoryMonth[] = [];
  for (let month = 0; ; month += 1) {
    let result: HistoryAnalysisResultPage;
    let combined: HistoryMonth | null = null;
    let offset = 0;
    do {
      const params = new URLSearchParams({ id, month: String(month), offset: String(offset) });
      result = await getJson<HistoryAnalysisResultPage>(`/api/history-analysis/results?${params}`, signal);
      if (combined) combined.alerts.push(...result.month.alerts);
      else combined = result.month;
      offset += HISTORY_ANALYSIS_RESULT_PAGE_SIZE;
    } while (result.hasNextPage);
    months.push(combined);
    if (!result.hasNextMonth) return months;
  }
}

export function cancelHistoryAnalysis(id: string): Promise<HistoryAnalysisStatus> {
  return getJson('/api/history-analysis/cancel', undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Alert-Center-Action': '1' },
    body: JSON.stringify({ id }),
  });
}

const enc = encodeURIComponent;

export interface ActionResponse {
  result: ActionResult;
  alert: AlertDetail | null;
}

/**
 * Sends one write action. The custom header is what the backend requires
 * for writes: a page on another site cannot send it without a CORS
 * preflight, which the backend never grants.
 */
export function postAction(id: string, action: AlertAction): Promise<ActionResponse> {
  return getJson(`/api/alerts/${enc(id)}/actions`, undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Alert-Center-Action': '1' },
    body: JSON.stringify(action),
  });
}

export function fetchNotes(id: string, signal?: AbortSignal): Promise<Page<AlertNote>> {
  return getJson(`/api/alerts/${enc(id)}/notes`, signal);
}

export function fetchLogs(id: string, signal?: AbortSignal): Promise<Page<AlertLogEntry>> {
  return getJson(`/api/alerts/${enc(id)}/logs`, signal);
}

export function fetchAttachments(id: string, signal?: AbortSignal): Promise<Page<AlertAttachment>> {
  return getJson(`/api/alerts/${enc(id)}/attachments`, signal);
}

export function uploadAttachment(id: string, file: File): Promise<AlertAttachment> {
  return getJson(`/api/alerts/${enc(id)}/attachments`, undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Alert-Center-Action': '1', 'X-Attachment-Name': enc(file.name) },
    body: file,
  });
}

export function fetchAttachmentUrl(id: string, attachmentId: string): Promise<{ url: string }> {
  return getJson(`/api/alerts/${enc(id)}/attachments/${enc(attachmentId)}`);
}

export function fetchMe(signal?: AbortSignal): Promise<DirectoryUser> {
  return getJson('/api/directory/me', signal);
}

export function searchUsers(query: string, signal?: AbortSignal): Promise<DirectoryUser[]> {
  return getJson(`/api/directory/users?query=${enc(query)}`, signal);
}

export function fetchTeams(signal?: AbortSignal): Promise<DirectoryEntry[]> {
  return getJson('/api/directory/teams', signal);
}

export function fetchSchedules(signal?: AbortSignal): Promise<DirectoryEntry[]> {
  return getJson('/api/directory/schedules', signal);
}

export function fetchEscalations(teamId: string, signal?: AbortSignal): Promise<DirectoryEntry[]> {
  return getJson(`/api/directory/teams/${enc(teamId)}/escalations`, signal);
}

/** Desktop app only: the editable settings of the configuration file. Secrets are never returned. */
export function fetchDesktopConfig(signal?: AbortSignal): Promise<DesktopConfigResponse> {
  return getJson(DESKTOP_CONFIG_API, signal);
}

export function saveDesktopConfig(request: DesktopConfigSaveRequest): Promise<DesktopConfigSaveResponse> {
  return getJson(DESKTOP_CONFIG_API, undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Alert-Center-Action': '1' },
    body: JSON.stringify(request),
  });
}

import type { AlertDetail, AlertsResponse, StatusResponse } from '../../shared/types';

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

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError('The Alert Center backend is not reachable. Is the server running?', null);
  }
  if (!response.ok) {
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
    throw new ApiRequestError(message, response.status);
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
  return getJson(`/api/alerts${query ? `?${query}` : ''}`, signal);
}

export function fetchAlertDetail(id: string, signal?: AbortSignal): Promise<AlertDetail> {
  return getJson(`/api/alerts/${encodeURIComponent(id)}`, signal);
}

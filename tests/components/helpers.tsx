import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import type { StatusResponse, SyncMeta } from '../../shared/types';
import type { ActionId } from '../../shared/actions';

/** A query client per test: no retries, no delay, nothing shared between tests. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function renderWithClient(ui: ReactNode, client: QueryClient = createTestQueryClient()): RenderResult & { client: QueryClient } {
  const wrap = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  const result = render(wrap(ui));
  return { ...result, rerender: (next: ReactNode) => result.rerender(wrap(next)), client };
}

// ---- Backend mock ------------------------------------------------------------------

export interface ApiCall {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
}

/** A route answers with a body (status 200), a Response, or a promise of either. */
export type ApiRoute = unknown | ((call: ApiCall) => unknown);

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A route answer that never arrives: the component stays in its loading state. */
export const never = (): Promise<never> => new Promise<never>(() => undefined);

/**
 * Replaces fetch for the /api routes the component calls. Routes are keyed
 * "METHOD /api/path" (no query string). An unknown route answers 404, which
 * the component shows as an error, so a missing mock is visible.
 */
export function mockApi(routes: Record<string, ApiRoute>): { calls: ApiCall[]; fetch: ReturnType<typeof vi.fn> } {
  const calls: ApiCall[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const call: ApiCall = { method, path: url.pathname, search: url.searchParams, body };
    calls.push(call);
    const key = `${method} ${url.pathname}`;
    if (!(key in routes)) return jsonResponse({ error: `Not mocked: ${key}` }, 404);
    const route = routes[key];
    const answer = await (typeof route === 'function' ? (route as (call: ApiCall) => unknown)(call) : route);
    return answer instanceof Response ? answer : jsonResponse(answer);
  });
  vi.stubGlobal('fetch', fetch);
  return { calls, fetch };
}

// ---- Fixtures ----------------------------------------------------------------------

export const META: SyncMeta = {
  mode: 'demo',
  lastSyncAt: Date.UTC(2026, 10, 20, 9, 0),
  lastAttemptAt: Date.UTC(2026, 10, 20, 9, 0),
  stale: false,
  error: null,
  total: 42,
  truncated: false,
  skipped: 0,
  lastSyncDurationMs: 120,
  retryAt: null,
};

export function makeStatus(overrides: Partial<StatusResponse> = {}, actions: ActionId[] = []): StatusResponse {
  return {
    mode: 'demo',
    readOnly: actions.length === 0,
    writes: { enabled: actions.length > 0, actions },
    site: null,
    defaultRefreshSeconds: 60,
    cacheTtlSeconds: 30,
    limits: { maxOpenAlerts: 5000, maxClosedAlerts: 2000, closedLookbackHours: 72 },
    extraction: {
      customerTagPrefixes: ['customer:'],
      customerCompanyTagPrefixes: [],
      customerPropertyKeys: ['Customer'],
      serviceTagPrefixes: ['service:'],
      servicePropertyKeys: ['Service'],
      serviceFallbackToEntity: false,
    },
    warnings: [],
    meta: META,
    ...overrides,
  };
}

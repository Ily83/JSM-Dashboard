import { describe, expect, it } from 'vitest';
import type { JiraConfig } from '../server/config';
import { JiraApiError, JiraClient } from '../server/jira/client';
import { JiraSource } from '../server/jira/source';
import { redact } from '../server/logger';
import { AlertStore } from '../server/services/alertStore';
import { DAY_MS, HISTORY_MAX_OFFSET, HISTORY_PAGE_SIZE } from '../shared/history';
import type { ExtractionRules } from '../shared/types';

/** A stand-in for the Jira Operations API, following the documented request and response shapes. */
interface FakeAlert {
  id: string;
  status: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  extraProperties?: Record<string, string>;
  description?: string;
  acknowledged?: boolean;
}

function fakeJira(options: { alerts: FakeAlert[]; listOmitsExtraProperties?: boolean; listCount?: number }) {
  const calls: Array<{ method: string; path: string; query: URLSearchParams; authorization: string | null }> = [];
  let failWith: (() => Response) | null = null;

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? 'GET', path: url.pathname, query: url.searchParams, authorization: headers.get('authorization') });
    if (url.pathname === '/_edge/tenant_info') return json({ cloudId: 'cloud-123' });
    if (failWith) return failWith();
    if (url.pathname.endsWith('/v1/teams')) return json([{ teamId: 't1', teamName: 'Cloud Operations' }]);

    const single = url.pathname.match(/\/v1\/alerts\/([^/]+)$/);
    if (single) {
      const found = options.alerts.find((a) => a.id === decodeURIComponent(single[1]!));
      return found ? json(found) : json({ errors: [{ title: 'Alert not found' }] }, 404);
    }
    if (url.pathname.endsWith('/v1/alerts')) {
      const query = url.searchParams.get('query') ?? '';
      const wantOpen = !query.includes('NOT status: open');
      const history = query.match(/createdAt >= (\d+) AND createdAt < (\d+)/);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const size = Number(url.searchParams.get('size') ?? 20);
      const matching = options.alerts
        .filter((a) => history
          ? Date.parse(a.createdAt) >= Number(history[1]) && Date.parse(a.createdAt) < Number(history[2])
          : (a.status === 'open') === wantOpen)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const values = matching.slice(offset, offset + size).map((a) => {
        if (!options.listOmitsExtraProperties) return a;
        const { extraProperties: _e, description: _d, ...rest } = a;
        return rest;
      });
      const hasNext = offset + size < matching.length;
      return json({ values, count: options.listCount ?? matching.length, links: hasNext ? { next: `/v1/alerts?offset=${offset + size}&size=${size}` } : {} });
    }
    return json({ errors: [{ title: 'Unknown' }] }, 404);
  }) as typeof fetch;

  return { fetchImpl, calls, setFailure: (factory: (() => Response) | null) => (failWith = factory), json };
}

const config: JiraConfig = {
  siteUrl: 'https://example.atlassian.net',
  siteHost: 'example.atlassian.net',
  cloudId: null,
  email: 'ops@example.com',
  apiToken: 'ATATT-secret-token-value',
  alertQuery: null,
  openQuery: 'status: open',
  closedQuery: 'NOT status: open',
  alertUrlTemplate: '{siteUrl}/jira/ops/alerts/{id}',
  maxOpenAlerts: 2000,
  maxClosedAlerts: 500,
  closedLookbackHours: 72,
  fullSyncMinutes: 15,
  requestTimeoutMs: 5000,
  enrichDetails: 'auto',
  enrichMaxPerSync: 50,
};

const rules: ExtractionRules = {
  customerTagPrefixes: ['customer:'],
  customerPropertyKeys: ['customer'],
  serviceTagPrefixes: ['service:'],
  servicePropertyKeys: ['service'],
  serviceFallbackToEntity: true,
};

function makeAlerts(count: number, status = 'open'): FakeAlert[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${status}-${String(i).padStart(4, '0')}`,
    status,
    message: `Alert ${i}`,
    createdAt: new Date(Date.now() - i * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - i * 60_000).toISOString(),
    tags: ['customer:Contoso'],
    extraProperties: { customer: 'Fabrikam', service: 'Billing' },
    description: `Description ${i}`,
  }));
}

describe('Jira integration (against a fake API)', () => {
  it('pages through all open and recently closed alerts with GET and Basic auth only', async () => {
    const jira = fakeJira({ alerts: [...makeAlerts(250), ...makeAlerts(30, 'closed')] });
    const source = new JiraSource(config, rules, new JiraClient(config, 4, jira.fetchImpl));
    const snapshot = await source.sync(null);

    expect(snapshot.alerts.size).toBe(280);
    expect(snapshot.truncated).toBe(false);
    expect(new Set(jira.calls.map((c) => c.method))).toEqual(new Set(['GET']));
    const listCalls = jira.calls.filter((c) => c.path.endsWith('/v1/alerts'));
    expect(listCalls.every((c) => Number(c.query.get('size')) <= 100)).toBe(true);
    expect(listCalls.filter((c) => c.query.get('query') === 'status: open').length).toBe(3); // 100 + 100 + 50
    expect(listCalls.every((c) => c.path.startsWith('/jsm/ops/api/cloud-123/'))).toBe(true);
    const expected = `Basic ${Buffer.from('ops@example.com:ATATT-secret-token-value').toString('base64')}`;
    expect(listCalls.every((c) => c.authorization === expected)).toBe(true);
    // The unauthenticated cloudId lookup must not receive credentials.
    expect(jira.calls.find((c) => c.path === '/_edge/tenant_info')?.authorization).toBeNull();

    const first = snapshot.alerts.get('open-0000')!;
    expect(first.customers).toEqual(['Contoso', 'Fabrikam']);
    expect(first.service).toBe('Billing');
    expect(first.url).toBe('https://example.atlassian.net/jira/ops/alerts/open-0000');
  });

  it('respects the configured maximum and reports truncation', async () => {
    const jira = fakeJira({ alerts: makeAlerts(250) });
    const limited = { ...config, maxOpenAlerts: 120 };
    const snapshot = await new JiraSource(limited, rules, new JiraClient(limited, 4, jira.fetchImpl)).sync(null);
    expect(snapshot.alerts.size).toBe(120);
    expect(snapshot.truncated).toBe(true);
  });

  it('reads older open and closed alerts by creation date without starting live sync or loading details', async () => {
    const from = Date.UTC(2025, 1, 1);
    const until = from + 7 * DAY_MS;
    const within = [...makeAlerts(100), ...makeAlerts(2, 'closed')].map((alert, i) => ({
      ...alert,
      createdAt: new Date(from + i).toISOString(),
    }));
    const outside = [from - 1, until].map((date, i) => ({
      ...within[0]!,
      id: `outside-${i}`,
      createdAt: new Date(date).toISOString(),
    }));
    const jira = fakeJira({ alerts: [...within, ...outside] });
    const scoped = { ...config, alertQuery: 'tag: prod', maxOpenAlerts: 1, maxClosedAlerts: 0 };
    const store = new AlertStore(new JiraSource(scoped, rules, new JiraClient(scoped, 4, jira.fetchImpl)), 30_000);

    const first = await store.getHistory({ from, until, offset: 0 });
    const second = await store.getHistory({ from, until, offset: HISTORY_PAGE_SIZE });
    expect(first.hasNext).toBe(true);
    expect(second.hasNext).toBe(false);
    expect([...first.alerts, ...second.alerts].map((a) => a.id)).toEqual(within.map((a) => a.id).reverse());
    expect(first.alerts[0]?.status).toBe('closed');
    expect(jira.calls.map(({ method, path }) => [method, path])).toEqual([
      ['GET', '/_edge/tenant_info'],
      ['GET', '/jsm/ops/api/cloud-123/v1/alerts'],
      ['GET', '/jsm/ops/api/cloud-123/v1/alerts'],
    ]);
    expect(jira.calls[2]?.query.get('query')).toBe(`(tag: prod) AND createdAt >= ${from} AND createdAt < ${until}`);
    expect(jira.calls[2]?.query.get('offset')).toBe(String(HISTORY_PAGE_SIZE));
    expect(store.meta().lastSyncAt).toBeNull();
  });

  it('warns about dense windows and stops paging below the Jira limit', async () => {
    const jira = fakeJira({ alerts: [], listCount: 20_001 });
    const source = new JiraSource(config, rules, new JiraClient(config, 4, jira.fetchImpl));
    const from = Date.UTC(2025, 1, 1);
    const until = from + DAY_MS;
    expect(await source.loadHistory({ from, until, offset: 0 })).toMatchObject({ hasNext: true, truncated: true });
    expect(await source.loadHistory({ from, until, offset: HISTORY_MAX_OFFSET })).toMatchObject({ hasNext: false, truncated: true });
    const params = jira.calls.at(-1)!.query;
    expect(Number(params.get('offset')) + Number(params.get('size'))).toBeLessThan(20_000);
  });

  it('light sync: asks only for open alerts and looks up the ones that disappeared', async () => {
    const alerts = makeAlerts(5);
    const jira = fakeJira({ alerts });
    const source = new JiraSource(config, rules, new JiraClient(config, 4, jira.fetchImpl));
    const first = await source.sync(null);

    alerts[2]!.status = 'closed'; // closed in Jira between two polls
    jira.calls.length = 0;
    const second = await source.sync(first);

    expect(second.alerts.get('open-0002')?.status).toBe('closed');
    expect(second.alerts.size).toBe(5);
    expect(jira.calls.map((c) => c.path.replace(/.*\/v1/, ''))).toEqual(['/alerts', '/alerts/open-0002']);
  });

  it('fetches details only when the list omits extra properties, within the budget, once per version', async () => {
    const alerts = makeAlerts(10).map((a) => ({ ...a, tags: [] }));
    const jira = fakeJira({ alerts, listOmitsExtraProperties: true });
    const budget = { ...config, enrichMaxPerSync: 4 };
    const source = new JiraSource(budget, rules, new JiraClient(budget, 4, jira.fetchImpl));

    const first = await source.sync(null);
    const details = () => jira.calls.filter((c) => /\/v1\/alerts\/open-/.test(c.path)).length;
    expect(details()).toBe(4);
    expect([...first.alerts.values()].filter((a) => a.customers.includes('Fabrikam')).length).toBe(4);

    const second = await source.sync(first);
    expect(details()).toBe(8); // four more, the first four come from the cache
    expect([...second.alerts.values()].filter((a) => a.customers.includes('Fabrikam')).length).toBe(8);

    await source.sync(second);
    const third = await source.sync(second);
    expect(details()).toBe(10);
    expect([...third.alerts.values()].every((a) => a.detailLoaded)).toBe(true);
  });

  it('turns HTTP errors into sanitised errors', async () => {
    const jira = fakeJira({ alerts: [] });
    const client = new JiraClient(config, 4, jira.fetchImpl);

    jira.setFailure(() => jira.json({ code: 401, message: 'token ATATT-secret-token-value rejected' }, 401));
    const unauthorized = await client.listAlerts({ offset: 0, size: 10 }).catch((e: unknown) => e);
    expect(unauthorized).toBeInstanceOf(JiraApiError);
    expect((unauthorized as JiraApiError).kind).toBe('auth');
    expect((unauthorized as JiraApiError).publicMessage).not.toContain('ATATT');

    jira.setFailure(() => jira.json({}, 429, { 'retry-after': '120' }));
    const limited = (await client.listAlerts({ offset: 0, size: 10 }).catch((e: unknown) => e)) as JiraApiError;
    expect(limited.kind).toBe('rate_limit');
    expect(limited.retryAfterMs).toBe(120_000);

    jira.setFailure(() => new Response('<html>gateway</html>', { status: 200 }));
    const invalid = (await client.listAlerts({ offset: 0, size: 10 }).catch((e: unknown) => e)) as JiraApiError;
    expect(invalid.kind).toBe('schema');
  });
});

describe('AlertStore', () => {
  it('caches within the TTL, shares one sync between callers and reports unchanged versions', async () => {
    const jira = fakeJira({ alerts: makeAlerts(3) });
    const source = new JiraSource(config, rules, new JiraClient(config, 4, jira.fetchImpl));
    const store = new AlertStore(source, 30_000);

    const [a, b] = await Promise.all([store.getAlerts(), store.getAlerts()]);
    const listCalls = () => jira.calls.filter((c) => c.path.endsWith('/v1/alerts') && c.query.get('query') === 'status: open').length;
    expect(listCalls()).toBe(1);
    expect(a.alerts).toHaveLength(3);
    expect(b.version).toBe(a.version);

    const again = await store.getAlerts({ knownVersion: a.version });
    expect(listCalls()).toBe(1);
    expect(again.unchanged).toBe(true);
    expect(again.alerts).toHaveLength(0);
    expect(again.meta.lastSyncAt).not.toBeNull();
  });

  it('keeps serving the last good data when Jira fails, and waits out a rate limit', async () => {
    const jira = fakeJira({ alerts: makeAlerts(3) });
    const source = new JiraSource(config, rules, new JiraClient(config, 4, jira.fetchImpl));
    const store = new AlertStore(source, 0);
    await store.getAlerts();

    jira.setFailure(() => jira.json({}, 429, { 'retry-after': '300' }));
    const stale = await store.getAlerts({ force: true });
    expect(stale.alerts).toHaveLength(3);
    expect(stale.meta.stale).toBe(true);
    expect(stale.meta.error).toMatch(/rate limit/i);
    expect(stale.meta.retryAt).toBeGreaterThan(Date.now() + 200_000);

    const callsBefore = jira.calls.length;
    await store.getAlerts({ force: true }); // must not hit Jira while rate limited
    expect(jira.calls.length).toBe(callsBefore);
  });
});

describe('log redaction', () => {
  it('masks credentials', () => {
    expect(redact('Authorization: Basic b3BzQGV4YW1wbGUuY29tOnNlY3JldA==')).not.toContain('b3BzQGV4');
    expect(redact('token ATATT-example-not-a-real-token leaked')).not.toContain('ATATT-example');
    expect(redact('GET /x?api_key=12345&size=10')).toBe('GET /x?api_key=[redacted]&size=10');
  });
});

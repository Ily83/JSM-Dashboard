import { describe, expect, it, vi } from 'vitest';
import type { JiraConfig } from '../server/config';
import { JiraApiError, JiraClient, MAX_OFFSET_PLUS_SIZE } from '../server/jira/client';
import { JiraSource } from '../server/jira/source';
import { redact } from '../server/logger';
import { AlertStore } from '../server/services/alertStore';
import { HistoryAnalysisService } from '../server/services/historyAnalysis';
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
  responders?: Array<{ id: string; type: string }>;
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
  writeActions: [],
};

const rules: ExtractionRules = {
  customerTagPrefixes: ['customer:'],
  customerCompanyTagPrefixes: [],
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
  it('labels schedule and escalation responders using the same directory as the pickers', async () => {
    const raw = { ...makeAlerts(1)[0], responders: [
      { id: 't1', type: 'team' }, { id: 'shared', type: 'schedule' }, { id: 'shared', type: 'escalation' }, { id: 'unavailable', type: 'schedule' },
    ] };
    const jira = fakeJira({ alerts: [raw] });
    const directory = {
      teams: async () => [{ id: 't1', name: 'Team' }],
      schedules: async () => [{ id: 'shared', name: 'Schedule' }],
      escalations: vi.fn(async () => [{ id: 'shared', name: 'Escalation' }]),
    };
    const source = new JiraSource(config, rules, new JiraClient(config, 4, jira.fetchImpl), null, directory);
    const snapshot = await source.sync(null);
    expect(snapshot.alerts.get(raw.id)?.responders.map(r => r.name)).toEqual(['Team', 'Schedule', 'Escalation', undefined]);
    expect(directory.escalations).toHaveBeenCalledWith('t1');
  });
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

  it('recovers a throttled request and scans every ID past the offset ceiling without per-alert reads', async () => {
    const from = Date.UTC(2026, 0, 1);
    const to = Date.UTC(2026, 0, 31);
    const until = to + DAY_MS;
    const middle = from + (until - from) / 2;
    const count = MAX_OFFSET_PLUS_SIZE + 1;
    const alerts = Array.from({ length: count }, (_, i) => {
      const createdAt = new Date(i < 10_000 ? from + i : middle + i - 10_000).toISOString();
      return { id: `history-${i}`, message: 'Synthetic alert', status: 'open', createdAt, updatedAt: createdAt };
    });
    const jira = fakeJira({ alerts });
    const upstream = vi.fn<typeof fetch>(jira.fetchImpl);
    // Throttle the first alert page but not tenant discovery.
    upstream.mockImplementationOnce(jira.fetchImpl).mockResolvedValueOnce(jira.json({}, 429, { 'retry-after': '0' }));
    const client = new JiraClient(config, 1, upstream);
    const source = new JiraSource(config, rules, client);
    const analysis = new HistoryAnalysisService(page => source.loadHistory(page), 0);
    const job = analysis.start(from, to)!;
    await vi.waitFor(() => expect(analysis.status()?.state).toBe('completed'), { timeout: 10_000 });

    const [month] = analysis.results(job.id)!;
    expect(month.partial).toBe(false);
    expect(month.alerts).toHaveLength(count);
    expect(new Set(month.alerts.map(alert => alert.id))).toEqual(new Set(alerts.map(alert => alert.id)));
    const listCalls = jira.calls.slice(1);
    expect(listCalls).toHaveLength(202); // Parent probe, then 100 + 101 pages.
    expect(client.requestCount).toBe(204); // Also count discovery and one 429.
    expect(jira.calls.every(call => call.method === 'GET')).toBe(true);
    expect(listCalls.every(call => call.path.endsWith('/v1/alerts') &&
      Number(call.query.get('offset')) + Number(call.query.get('size')) < MAX_OFFSET_PLUS_SIZE)).toBe(true);
  }, 15_000);

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

  it('also reads a few closed alerts, and keeps known properties when an alert changes', async () => {
    const open = makeAlerts(3).map((a) => ({ ...a, tags: [] }));
    const closed = makeAlerts(15, 'closed').map((a) => ({ ...a, tags: [] }));
    const jira = fakeJira({ alerts: [...open, ...closed], listOmitsExtraProperties: true });
    const settings = { ...config };
    const source = new JiraSource(settings, rules, new JiraClient(settings, 4, jira.fetchImpl));

    const first = await source.sync(null);
    const closedDetails = () => jira.calls.filter((c) => /\/v1\/alerts\/closed-/.test(c.path)).length;
    // Open alerts first, then at most ten closed ones per run.
    expect(closedDetails()).toBe(10);
    expect(first.alerts.get('closed-0000')?.service).toBe('Billing');

    // The alert changes in Jira (a note, say): its list entry is newer, the
    // cached properties stay visible until they are read again (no reading in this run).
    settings.enrichMaxPerSync = 0;
    open[0]!.updatedAt = new Date(Date.now() + 1000).toISOString();
    const second = await source.sync(first);
    const changed = second.alerts.get('open-0000')!;
    expect(changed.service).toBe('Billing');
    expect(changed.customers).toContain('Fabrikam');
    expect(changed.detailLoaded).toBe(false);
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
    // While Jira asked to wait, nothing else is sent either.
    const sent = jira.calls.length;
    const waiting = (await client.listAlerts({ offset: 0, size: 10 }).catch((e: unknown) => e)) as JiraApiError;
    expect(waiting.kind).toBe('rate_limit');
    expect(jira.calls.length).toBe(sent);

    jira.setFailure(() => new Response('<html>gateway</html>', { status: 200 }));
    const fresh = new JiraClient(config, 4, jira.fetchImpl);
    const invalid = (await fresh.listAlerts({ offset: 0, size: 10 }).catch((e: unknown) => e)) as JiraApiError;
    expect(invalid.kind).toBe('schema');
  });
});

describe('AlertStore', () => {
  it('does not replace a post-action refresh with an older in-flight sync', async () => {
    const alerts = makeAlerts(1);
    const jira = fakeJira({ alerts });
    const source = new JiraSource(config, rules, new JiraClient(config, 4, jira.fetchImpl));
    const store = new AlertStore(source, 0);
    await store.getAlerts();

    const stale = await source.sync(null);
    let finish!: (snapshot: typeof stale) => void;
    vi.spyOn(source, 'sync').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const syncing = store.getAlerts({ force: true });

    alerts[0].acknowledged = true;
    expect(await store.refreshAlert(alerts[0].id)).toMatchObject({ acknowledged: true });
    finish(stale);
    expect((await syncing).alerts).toMatchObject([{ acknowledged: true }]);
  });

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

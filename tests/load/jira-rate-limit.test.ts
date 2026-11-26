import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../server/config';
import { JiraClient, MAX_OFFSET_PLUS_SIZE } from '../../server/jira/client';
import { JiraSource } from '../../server/jira/source';
import { log } from '../../server/logger';
import { AlertStore } from '../../server/services/alertStore';
import { HistoryAnalysisService } from '../../server/services/historyAnalysis';

const DAY = Date.UTC(2026, 10, 25);
const FIXTURE_SITE = 'https://jira-fixture.invalid';
const OPS_ROOT = '/jsm/ops/api/fixture/v1';
const RPS = 4;
const config = loadConfig({
  JIRA_SITE_URL: FIXTURE_SITE, JIRA_EMAIL: 'fixture@example.invalid', JIRA_API_TOKEN: 'fixture-only',
  JIRA_CLOUD_ID: 'fixture', JIRA_REQUESTS_PER_SECOND: String(RPS),
});

function alert(id: string, time: number, status: 'open' | 'closed' = 'open', revision = 0) {
  const createdAt = new Date(time).toISOString();
  return { id, createdAt, updatedAt: new Date(time + revision).toISOString(), status,
    message: `Fixture ${id} revision ${revision}`, tags: ['customer:Fixture'], priority: 'P3', extraProperties: {} };
}

type Attempt = { backend: number; at: number; limited: boolean };

/** In-process only: admitted GETs share one rolling quota across all simulated desktops. */
function fakeTenant(limit: number, respond: (url: URL) => Response) {
  const recent: number[] = [];
  const attempts: Attempt[] = [];
  let externalRps = 0;
  function forBackend(backend: number): typeof fetch {
    return async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://api.atlassian.com');
      expect(url.pathname.startsWith(`${OPS_ROOT}/`)).toBe(true);
      expect(init?.method).toBe('GET');
      const at = Date.now();
      while (recent.length && recent[0] <= at - 1000) recent.shift();
      const limited = recent.length >= limit - externalRps;
      attempts.push({ backend, at, limited });
      if (limited) return new Response(null, { status: 429, headers: { 'retry-after': '15', 'ratelimit-reason': 'simulated-shared-budget' } });
      recent.push(at);
      return respond(url);
    };
  }
  return {
    attempts, forBackend,
    // Model shared capacity already occupied by other integrations, not a claim about Terraform's real quota.
    setExternalRps: (requests: number) => { externalRps = requests; },
  };
}

function peakPerSecond(attempts: Attempt[]): number {
  let start = 0;
  let peak = 0;
  for (let end = 0; end < attempts.length; end++) {
    while (attempts[end].at - attempts[start].at >= 1000) start++;
    peak = Math.max(peak, end - start + 1);
  }
  return peak;
}

async function settle<T>(work: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return work;
}

describe('Jira load test with no network', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: DAY + 86_400_000, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', () => { throw new Error('Network is disabled during Jira load tests'); });
    vi.spyOn(log, 'info').mockImplementation(() => {});
    vi.spyOn(log, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('recovers all 50,000 History records while respecting the Jira offset ceiling and request cap', async () => {
    const count = 50_000;
    const alerts = Array.from({ length: count }, (_, i) => alert(`history-${i}`, DAY + i * 1000));
    const upstream = fakeTenant(20, url => {
      const query = url.searchParams.get('query') ?? '';
      const range = query.match(/createdAt >= (\d+) AND createdAt < (\d+)/)!;
      const from = Math.max(0, Math.min(count, Math.ceil((Number(range[1]) - DAY) / 1000)));
      const until = Math.max(from, Math.min(count, Math.ceil((Number(range[2]) - DAY) / 1000)));
      const offset = Number(url.searchParams.get('offset'));
      const size = Number(url.searchParams.get('size'));
      expect(offset + size).toBeLessThan(MAX_OFFSET_PLUS_SIZE);
      const end = Math.max(from, until - offset);
      const values = alerts.slice(Math.max(from, end - size), end).reverse();
      return Response.json({ values, count: until - from,
        links: offset + size < until - from ? { next: 'next' } : {} });
    });
    const jira = config.jira!;
    const client = new JiraClient(jira, 4, upstream.forBackend(0));
    const source = new JiraSource(jira, config.extraction, client);
    const history = new HistoryAnalysisService(page => source.loadHistory(page));
    const started = Date.now();
    const job = history.start(DAY, DAY)!;
    await vi.runAllTimersAsync();
    const status = history.status()!;
    expect(status).toMatchObject({ state: 'completed', partial: false });
    const ids = new Set(history.results(job.id)![0].alerts.map(record => record.id));
    expect(ids.size).toBe(count);
    expect(alerts.every(record => ids.has(record.id))).toBe(true);
    expect(peakPerSecond(upstream.attempts)).toBe(1); // History is paced separately at one page per second.
    expect(client.rateLimitedCount).toBe(0);
    console.log('Local Jira History load:', JSON.stringify({
      alerts: ids.size, requests: client.requestCount, virtualSeconds: (Date.now() - started) / 1000,
      peakPerSecond: peakPerSecond(upstream.attempts), partial: status.partial,
    }));
  }, 30_000);

  it('keeps cached alerts and recovers after a shared quota is exceeded by 16 desktops', async () => {
    const quota = 20;
    const desktopCount = 16;
    const openCount = 2_000;
    const closedCount = 500;
    const total = openCount + closedCount;
    const ttlMs = 30_000;
    const open = Array.from({ length: openCount }, (_, i) => alert(`open-${i}`, DAY - i * 1000));
    const closed = Array.from({ length: closedCount }, (_, i) => alert(`closed-${i}`, DAY - i * 1000, 'closed'));
    const upstream = fakeTenant(quota, url => {
      if (url.pathname === `${OPS_ROOT}/teams`) return Response.json([]);
      expect(url.pathname).toBe(`${OPS_ROOT}/alerts`);
      const dataset = url.searchParams.get('query')?.includes('NOT status: open') ? closed : open;
      const offset = Number(url.searchParams.get('offset'));
      const size = Number(url.searchParams.get('size'));
      return Response.json({ values: dataset.slice(offset, offset + size), count: dataset.length,
        links: offset + size < dataset.length ? { next: 'next' } : {} });
    });
    const jira = config.jira!;
    const stores = Array.from({ length: desktopCount }, (_, i) => {
      const client = new JiraClient(jira, 4, upstream.forBackend(i));
      return new AlertStore(new JiraSource(jira, config.extraction, client), ttlMs);
    });

    // Warm in groups of four (16 allowed starts/s under the fake quota of 20).
    const groups = Array.from({ length: desktopCount / 4 }, (_, i) => stores.slice(i * 4, i * 4 + 4));
    for (const group of groups) {
      const results = await settle(Promise.all(group.map(store => store.getAlerts())));
      expect(results.every(result => result.alerts.length === total && !result.meta.stale)).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(upstream.attempts.filter(attempt => attempt.limited)).toHaveLength(0);

    const rounds = [];
    for (let revision = 1; revision <= 3; revision++) {
      await vi.advanceTimersByTimeAsync(60_000);
      open[0] = alert('open-0', DAY, 'open', revision);
      const before = upstream.attempts.length;
      const results = await settle(Promise.all(stores.map(store => store.getAlerts())));
      const attempts = upstream.attempts.slice(before);
      const cached = results.filter(result => result.meta.stale);
      expect(cached.length).toBeGreaterThan(0);
      expect(results.every(result => result.alerts.length === total)).toBe(true);
      expect(attempts.filter(attempt => attempt.limited).length).toBeGreaterThan(0);
      const after = upstream.attempts.length;
      const forced = await Promise.all(stores.flatMap((store, i) => results[i].meta.stale ? [store.getAlerts({ force: true })] : []));
      expect(forced.every(result => result.meta.stale && result.alerts.length === total)).toBe(true);
      expect(upstream.attempts.length).toBe(after);
      rounds.push({ requests: attempts.length, limited: attempts.filter(attempt => attempt.limited).length, stale: cached.length });
    }

    // After the shared pressure clears, let all desktops poll in staggered groups.
    const pressureCleared = Date.now();
    const lastRetry = Math.max(...stores.map(store => store.meta().retryAt ?? pressureCleared));
    // A desktop with consecutive failures can still be in backoff when the
    // next minute's poll arrives. Wait for it rather than forcing a retry.
    const recoveryWaitMs = Math.max(60_000, lastRetry - pressureCleared + 1);
    await vi.advanceTimersByTimeAsync(recoveryWaitMs);
    const recoveryStart = upstream.attempts.length;
    for (const group of groups) {
      const recovered = await settle(Promise.all(group.map(store => store.getAlerts())));
      expect(recovered.every(result => !result.meta.stale && result.alerts.length === total &&
        result.alerts.find(record => record.id === 'open-0')?.summary === 'Fixture open-0 revision 3')).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
    }
    const recovery = upstream.attempts.slice(recoveryStart);
    expect(recovery.filter(attempt => attempt.limited)).toHaveLength(0);
    const perBackendPeak = Math.max(...stores.map((_, i) => peakPerSecond(upstream.attempts.filter(attempt => attempt.backend === i))));
    expect(perBackendPeak).toBe(RPS);
    expect(peakPerSecond(upstream.attempts.filter(attempt => !attempt.limited))).toBe(quota);
    console.log('Local Jira shared-quota load:', JSON.stringify({
      desktopCount, alertsPerDesktop: total, fakeQuotaPerSecond: quota, perBackendPeak,
      aggregateAttemptPeak: peakPerSecond(upstream.attempts), totalRequests: upstream.attempts.length,
      rounds, recoveryWaitMs, recoveryRequests: recovery.length, recoveredDesktops: stores.length,
    }));
  }, 30_000);

  it('protects cached data when external automation leaves less than one desktop’s budget', async () => {
    const quota = 20;
    const open = Array.from({ length: 500 }, (_, i) => alert(`shared-${i}`, DAY - i * 1000));
    const upstream = fakeTenant(quota, url => {
      if (url.pathname === `${OPS_ROOT}/teams`) return Response.json([]);
      if (url.searchParams.get('query')?.includes('NOT status: open')) return Response.json({ values: [], count: 0 });
      const offset = Number(url.searchParams.get('offset'));
      const size = Number(url.searchParams.get('size'));
      return Response.json({ values: open.slice(offset, offset + size), count: open.length,
        links: offset + size < open.length ? { next: 'next' } : {} });
    });
    const client = new JiraClient(config.jira!, 4, upstream.forBackend(0));
    const store = new AlertStore(new JiraSource(config.jira!, config.extraction, client), 30_000);
    const initial = await settle(store.getAlerts());
    expect(initial.alerts).toHaveLength(500);

    upstream.setExternalRps(18);
    open[0] = alert('shared-0', DAY, 'open', 1);
    await vi.advanceTimersByTimeAsync(60_000);
    const failed = await settle(store.getAlerts({ knownVersion: initial.version }));
    expect(failed).toMatchObject({ unchanged: true, meta: { stale: true, total: 500 } });
    expect(failed.version).toBe(initial.version);
    expect(failed.meta.retryAt).toBeGreaterThan(Date.now());
    const before = client.requestCount;
    await store.getAlerts({ force: true });
    expect(client.requestCount).toBe(before);
    const throttled = client.rateLimitedCount;
    expect(throttled).toBeGreaterThan(0);

    const coldClient = new JiraClient(config.jira!, 4, upstream.forBackend(1));
    const coldStore = new AlertStore(new JiraSource(config.jira!, config.extraction, coldClient), 30_000);
    const cold = await settle(coldStore.getAlerts());
    expect(cold).toMatchObject({ alerts: [], meta: { stale: true, lastSyncAt: null } });
    expect(coldClient.rateLimitedCount).toBeGreaterThan(0);

    upstream.setExternalRps(16);
    await vi.advanceTimersByTimeAsync(60_000);
    const recovered = await settle(store.getAlerts({ knownVersion: initial.version }));
    expect(recovered).toMatchObject({ unchanged: false, meta: { stale: false, total: 500 } });
    expect(recovered.alerts.find(record => record.id === 'shared-0')?.summary).toBe('Fixture shared-0 revision 1');
    expect(client.rateLimitedCount).toBe(throttled);
    console.log('Local Jira external-contention load:', JSON.stringify({
      fakeQuotaPerSecond: quota, externalPeakPerSecond: 18, appCapPerSecond: RPS,
      rateLimited: throttled, cachedAlertsPreserved: failed.meta.total, coldStartAlerts: cold.meta.total,
      recoveredAlerts: recovered.meta.total,
    }));
  });
});

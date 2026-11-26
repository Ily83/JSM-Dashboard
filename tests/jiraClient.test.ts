import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JiraConfig } from '../server/config';
import { JiraApiError, JiraClient } from '../server/jira/client';
import { log } from '../server/logger';

const config = {
  siteUrl: 'https://example.atlassian.net',
  siteHost: 'example.atlassian.net',
  cloudId: 'cloud-123',
  email: 'ops@example.com',
  apiToken: 'ATATT-example-not-a-real-token',
  requestTimeoutMs: 5000,
  requestsPerSecond: 0,
} as JiraConfig;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tooMany = (retryAfter: string) => new Response('', { status: 429, headers: { 'retry-after': retryAfter } });

/** A client whose requests are answered by `respond` (an Error fails the request); `sent` lists "METHOD /path". */
function fakeApi(respond: (n: number) => Response | Error) {
  const sent: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    sent.push(`${init?.method ?? 'GET'} ${url.pathname.replace('/jsm/ops/api/cloud-123', '')}`);
    const response = respond(sent.length);
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  const client = new JiraClient(config, 4, fetchImpl);
  client.statusPollDelaysMs = [];
  return { client, sent };
}

describe('JiraClient errors', () => {
  it('points the sync at the configuration and user requests at what was asked', async () => {
    await expect(fakeApi(() => json({}, 403)).client.listAlerts({ offset: 0, size: 10 })).rejects.toThrow(
      'The Jira account is not allowed to read Operations alerts (403).',
    );
    await expect(fakeApi(() => json({}, 403)).client.listNotes('a1')).rejects.toThrow(/^Jira refused reading this for the configured account \(403\)/);
    await expect(fakeApi(() => json({}, 404)).client.listNotes('a1')).rejects.toThrow('Jira did not find it (404). The alert may have been deleted.');
    await expect(fakeApi(() => json({}, 422)).client.listAlerts({ offset: 0, size: 10 })).rejects.toThrow('Jira rejected the request (422). Check JIRA_ALERT_QUERY.');
    await expect(fakeApi(() => json({}, 409)).client.listNotes('a1')).rejects.toMatchObject({ kind: 'validation', publicMessage: 'Jira returned an unexpected status (409).' });
  });

  it("shows Jira's own reason for a refused write, and a plain message for a failed one", async () => {
    const refused = fakeApi(() => json({ errorMessages: ['Your plan does not include this.'] }, 403));
    await expect(refused.client.performAction('a1', { action: 'close' })).rejects.toMatchObject({
      kind: 'forbidden',
      publicMessage: 'Jira refused the request (403): Your plan does not include this.',
    });
    const failed = fakeApi(() => json({ message: 'stack trace' }, 502));
    await expect(failed.client.performAction('a1', { action: 'close' })).rejects.toMatchObject({
      kind: 'server',
      publicMessage: 'Jira failed to process the request (502).',
    });
    expect(failed.sent).toHaveLength(1);
  });
});

describe('JiraClient retries', () => {
  it('retries a read after a short 429 and after a network error', async () => {
    const limited = fakeApi((n) => (n === 1 ? tooMany('0') : json({ values: [] })));
    await expect(limited.client.listNotes('a1')).resolves.toEqual({ values: [], hasMore: false });
    expect(limited.sent).toHaveLength(2);

    const offline = fakeApi((n) => (n === 1 ? new TypeError('fetch failed') : json({ values: [] })));
    await expect(offline.client.listNotes('a1')).resolves.toEqual({ values: [], hasMore: false });
    expect(offline.sent).toHaveLength(2);
  });

  describe('JiraClient scheduling', () => {
    it('serves interactive requests before queued background analysis', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const sent: string[] = [];
      const client = new JiraClient(config, 1, (async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        sent.push(path);
        if (sent.length === 1) await gate;
        return json({ values: [] });
      }) as typeof fetch);
      const first = client.listAlerts({ offset: 0, size: 10 });
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      const background = client.listAlerts({ offset: 0, size: 10, background: true });
      const interactive = client.listNotes('a1');
      await Promise.resolve();
      release();
      await Promise.all([first, background, interactive]);
      expect(sent[1]).toContain('/alerts/a1/notes');
      expect(sent[2]).toMatch(/\/v1\/alerts$/);
    });
  });

  it('gives up on a read after three attempts', async () => {
    const api = fakeApi(() => tooMany('0'));
    await expect(api.client.listNotes('a1')).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
    expect(api.sent).toHaveLength(3);
  });

  it('after a long Retry-After, fails the following requests at once instead of sending them', async () => {
    const api = fakeApi(() => tooMany('30'));
    await expect(api.client.listAlerts({ offset: 0, size: 10 })).rejects.toMatchObject({ kind: 'rate_limit', retryAfterMs: 30_000 });
    const next = await api.client.performAction('a1', { action: 'acknowledge' }).catch((error: unknown) => error);
    expect(next).toBeInstanceOf(JiraApiError);
    expect(next).toMatchObject({ kind: 'rate_limit', status: 429 });
    expect((next as JiraApiError).retryAfterMs).toBeGreaterThan(20_000);
    expect(api.sent).toEqual(['GET /v1/alerts']);
  });
});

describe('JiraClient request pacing', () => {
  afterEach(() => vi.useRealTimers());

  it('spaces concurrent sends at the configured rate without an initial burst', async () => {
    vi.useFakeTimers({ now: 0 });
    const sent: number[] = [];
    const client = new JiraClient({ ...config, requestsPerSecond: 4 }, 4, async () => {
      sent.push(Date.now());
      return json({ values: [] });
    });
    const completed = Promise.all(Array.from({ length: 9 }, () => client.listAlerts({ offset: 0, size: 1 })));
    await vi.runAllTimersAsync();
    await completed;
    expect(sent).toEqual([0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000]);
  });

  it('rechecks a newer Retry-After while waiting and paces retries too', async () => {
    vi.useFakeTimers({ now: 0 });
    const sent: number[] = [];
    const client = new JiraClient({ ...config, requestsPerSecond: 4 }, 4, async () => {
      sent.push(Date.now());
      if (sent.length === 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        return tooMany('1');
      }
      return json({ values: [] });
    });
    const completed = Promise.all(Array.from({ length: 3 }, () => client.listAlerts({ offset: 0, size: 1 })));
    await vi.runAllTimersAsync();
    await completed;
    expect(sent).toEqual([0, 1100, 1350, 1600]);
    expect(client.rateLimitedCount).toBe(1);
  });

  it('slows down for enforced quota warnings and safely logs only rate-limit headers', async () => {
    vi.useFakeTimers({ now: 0 });
    const sent: number[] = [];
    const debug = vi.spyOn(log, 'debug').mockImplementation(() => {});
    try {
      const client = new JiraClient({ ...config, requestsPerSecond: 4 }, 4, async () => {
        sent.push(Date.now());
        const headers = sent.length !== 1 ? undefined : {
          'ratelimit-policy': '"tenant-app-quota";q=100;w=2',
          'ratelimit': '"tenant-app-quota";r=10;t=2',
          'set-cookie': 'session=private',
        };
        return Response.json({ values: [] }, { headers });
      });
      const completed = Promise.all(Array.from({ length: 3 }, () => client.listAlerts({ offset: 0, size: 1 })));
      await vi.runAllTimersAsync();
      await completed;
      expect(sent).toEqual([0, 500, 1000]);
      expect(client.rateLimitHeaderCount).toBe(1);
      expect(debug.mock.calls[0]?.[1]).toMatchObject({ ratelimit: '"tenant-app-quota";r=10;t=2' });
      expect(debug.mock.calls[0]?.[1]).not.toHaveProperty('set-cookie');
    } finally {
      debug.mockRestore();
    }
  });

  it('honors an exhausted window but does not enforce beta quota hints', async () => {
    vi.useFakeTimers({ now: 0 });
    const sent: number[] = [];
    const client = new JiraClient({ ...config, requestsPerSecond: 4 }, 4, async () => {
      sent.push(Date.now());
      const headers: HeadersInit | undefined = sent.length === 1 ? { 'beta-ratelimit': '"tenant-app-quota";r=0;t=50' }
        : sent.length === 2 ? { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': new Date(5000).toISOString() } : undefined;
      return Response.json({ values: [] }, { headers });
    });
    const completed = Promise.all(Array.from({ length: 3 }, () => client.listAlerts({ offset: 0, size: 1 })));
    await vi.runAllTimersAsync();
    await completed;
    expect(sent).toEqual([0, 250, 5000]);
    expect(client.rateLimitedCount).toBe(0);
    expect(client.rateLimitHeaderCount).toBe(2);
  });
});

describe('JiraClient maintenance targets', () => {
  it('reads each kind from its documented endpoint', async () => {
    const api = fakeApi(() => json({ values: [] }));
    await api.client.listMaintenanceEntities('integration');
    await api.client.listMaintenanceEntities('policy');
    await api.client.listMaintenanceEntities('sync');
    expect(api.sent).toEqual(['GET /v1/integrations', 'GET /v1/alerts/policies', 'GET /v1/syncs']);
  });
});

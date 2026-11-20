import { describe, expect, it } from 'vitest';
import type { JiraConfig } from '../server/config';
import { JiraApiError, JiraClient } from '../server/jira/client';

const config = {
  siteUrl: 'https://example.atlassian.net',
  siteHost: 'example.atlassian.net',
  cloudId: 'cloud-123',
  email: 'ops@example.com',
  apiToken: 'ATATT-example-not-a-real-token',
  requestTimeoutMs: 5000,
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

describe('JiraClient maintenance targets', () => {
  it('reads each kind from its documented endpoint', async () => {
    const api = fakeApi(() => json({ values: [] }));
    await api.client.listMaintenanceEntities('integration');
    await api.client.listMaintenanceEntities('policy');
    await api.client.listMaintenanceEntities('sync');
    expect(api.sent).toEqual(['GET /v1/integrations', 'GET /v1/alerts/policies', 'GET /v1/syncs']);
  });
});

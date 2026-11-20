import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION_IDS } from '../shared/actions';
import { createApp } from '../server/app';
import { loadConfig, parseWriteActions, type AppConfig, type JiraConfig } from '../server/config';
import { DemoSource } from '../server/demo/demoSource';
import { JiraApiError, JiraClient } from '../server/jira/client';
import { AlertStore } from '../server/services/alertStore';
import { ActionRequestError, ActionService, parseAction } from '../server/services/operations';

const NOW = Date.parse('2026-11-19T12:00:00Z');

describe('parseAction', () => {
  it('accepts every documented action shape', () => {
    expect(parseAction({ action: 'acknowledge' })).toEqual({ action: 'acknowledge' });
    expect(parseAction({ action: 'assign', accountId: '5b10ac8d82e05b22cc7d4ef5' })).toMatchObject({ action: 'assign' });
    expect(parseAction({ action: 'addResponder', responder: { id: 'team-1', type: 'team' } })).toMatchObject({ action: 'addResponder' });
    expect(parseAction({ action: 'priority', priority: 'P2' })).toEqual({ action: 'priority', priority: 'P2' });
    expect(parseAction({ action: 'addTags', tags: [' a ', 'a', 'customer:Contoso'] })).toEqual({ action: 'addTags', tags: ['a', 'customer:Contoso'] });
    expect(parseAction({ action: 'addNote', note: '  checked  ' })).toEqual({ action: 'addNote', note: 'checked' });
  });

  it('rejects unknown actions, bad values and extra-long input, naming fields but not values', () => {
    for (const body of [
      null,
      { action: 'delete' },
      { action: 'priority', priority: 'P9' },
      { action: 'assign', accountId: 'x y' },
      { action: 'addTags', tags: [] },
      { action: 'addNote', note: 'x'.repeat(25_001) },
      { action: 'addResponder', responder: { id: 'a', type: 'everyone' } },
    ]) {
      expect(() => parseAction(body), JSON.stringify(body).slice(0, 60)).toThrow(ActionRequestError);
    }
    try {
      parseAction({ action: 'assign', accountId: 'secret value' });
    } catch (error) {
      expect((error as Error).message).toContain('accountId');
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('keeps snoozes between one minute and 30 days and normalises the time', () => {
    expect(() => parseAction({ action: 'snooze', endTime: new Date(NOW + 10_000).toISOString() }, NOW)).toThrow(/one minute/);
    expect(() => parseAction({ action: 'snooze', endTime: new Date(NOW + 31 * 86_400_000).toISOString() }, NOW)).toThrow(/30 days/);
    expect(parseAction({ action: 'snooze', endTime: '2026-11-19T14:00:00+01:00' }, NOW)).toEqual({ action: 'snooze', endTime: '2026-11-19T13:00:00.000Z' });
  });
});

describe('JIRA_WRITE_ACTIONS', () => {
  it('is off by default and accepts all, or a list', () => {
    expect(parseWriteActions(undefined).actions).toEqual([]);
    expect(parseWriteActions('false').actions).toEqual([]);
    expect(parseWriteActions('true').actions).toEqual([...ACTION_IDS]);
    expect(parseWriteActions('Close, acknowledge, nope')).toEqual({ actions: ['acknowledge', 'close'], unknown: ['nope'] });
  });

  it('live mode stays read-only unless enabled; demo mode allows everything', () => {
    const live = { JIRA_SITE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'a@example.com', JIRA_API_TOKEN: 'ATATT-example-not-a-real-token' };
    expect(loadConfig(live).writeActions).toEqual([]);
    expect(loadConfig({ ...live, JIRA_WRITE_ACTIONS: 'acknowledge' }).writeActions).toEqual(['acknowledge']);
    expect(loadConfig({}).writeActions).toEqual([...ACTION_IDS]);
  });
});

// ---- Jira client against a fake API --------------------------------------------

const jiraConfig = {
  siteUrl: 'https://example.atlassian.net',
  siteHost: 'example.atlassian.net',
  cloudId: 'cloud-123',
  email: 'ops@example.com',
  apiToken: 'ATATT-example-not-a-real-token',
  requestTimeoutMs: 5000,
} as JiraConfig;

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeWriteApi(script: (call: Call, n: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call = { method: init?.method ?? 'GET', path: url.pathname.replace('/jsm/ops/api/cloud-123', ''), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return script(call, calls.length);
  }) as typeof fetch;
  const client = new JiraClient(jiraConfig, 4, fetchImpl);
  client.statusPollDelaysMs = [1, 1, 1, 1];
  return { client, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const accepted = () => json({ result: 'Request will be processed', requestId: 'req-1', took: 0.01 }, 202);

describe('JiraClient write actions (against a fake API)', () => {
  it('sends each action to its documented endpoint with the documented body', async () => {
    const { client, calls } = fakeWriteApi((call) => (call.path.startsWith('/v1/alerts/requests/') ? json({ isSuccess: true, status: 'ok' }) : accepted()));
    await client.performAction('a1', { action: 'acknowledge' });
    await client.performAction('a1', { action: 'unacknowledge' });
    await client.performAction('a1', { action: 'close' });
    await client.performAction('a1', { action: 'snooze', endTime: '2026-11-19T13:00:00.000Z' });
    await client.performAction('a1', { action: 'assign', accountId: 'acc-1' });
    await client.performAction('a1', { action: 'addResponder', responder: { id: 't1', type: 'team' } });
    await client.performAction('a1', { action: 'escalate', escalationId: 'esc-1' });
    await client.performAction('a1', { action: 'priority', priority: 'P1' });
    await client.performAction('a1', { action: 'addTags', tags: ['x'] });
    await client.performAction('a1', { action: 'removeTags', tags: ['x'] });
    await client.performAction('a1', { action: 'customAction', actionName: 'Restart service' });
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes).toEqual([
      { method: 'POST', path: '/v1/alerts/a1/acknowledge', body: undefined },
      { method: 'POST', path: '/v1/alerts/a1/unacknowledge', body: undefined },
      { method: 'POST', path: '/v1/alerts/a1/close', body: undefined },
      { method: 'POST', path: '/v1/alerts/a1/snooze', body: { endTime: '2026-11-19T13:00:00.000Z' } },
      { method: 'POST', path: '/v1/alerts/a1/assign', body: { accountId: 'acc-1' } },
      { method: 'POST', path: '/v1/alerts/a1/responders', body: { id: 't1', type: 'team' } },
      { method: 'POST', path: '/v1/alerts/a1/escalate', body: { escalationId: 'esc-1' } },
      { method: 'PATCH', path: '/v1/alerts/a1/priority', body: { priority: 'P1' } },
      { method: 'POST', path: '/v1/alerts/a1/tags', body: { tags: ['x'] } },
      { method: 'DELETE', path: '/v1/alerts/a1/tags', body: { tags: ['x'] } },
      { method: 'POST', path: '/v1/alerts/a1/action', body: { actionName: 'Restart service' } },
    ]);
    // Every asynchronous action is followed by a status check.
    expect(calls.filter((c) => c.path === '/v1/alerts/requests/req-1')).toHaveLength(11);
  });

  it('waits while the request is not processed yet (404) and reports the outcome', async () => {
    const { client } = fakeWriteApi((call, n) => {
      if (!call.path.startsWith('/v1/alerts/requests/')) return accepted();
      return n < 4 ? json({ message: 'Request not found. It might not be processed, yet.' }, 404) : json({ isSuccess: true, status: 'Alert acknowledged' });
    });
    await expect(client.performAction('a1', { action: 'acknowledge' })).resolves.toEqual({ state: 'done', message: 'Alert acknowledged' });
  });

  it('keeps polling through 429s, turns a rejected request into an error and an unanswered one into "pending"', async () => {
    const rejected = fakeWriteApi((call) => (call.path.startsWith('/v1/alerts/requests/') ? json({ isSuccess: false, status: 'Alert is closed' }) : accepted()));
    await expect(rejected.client.performAction('a1', { action: 'acknowledge' })).rejects.toThrow('Jira did not apply the action: Alert is closed');

    const throttled = fakeWriteApi((call, n) => {
      if (!call.path.startsWith('/v1/alerts/requests/')) return accepted();
      return n < 6 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : json({ isSuccess: true, status: 'Unacknowledged alert' });
    });
    await expect(throttled.client.performAction('a1', { action: 'unacknowledge' })).resolves.toEqual({ state: 'done', message: 'Unacknowledged alert' });

    const silent = fakeWriteApi((call) => (call.path.startsWith('/v1/alerts/requests/') ? json({}, 404) : accepted()));
    await expect(silent.client.performAction('a1', { action: 'acknowledge' })).resolves.toEqual({ state: 'pending', message: null });
  });

  it('never repeats a write after a 5xx or network error, but does after a 429', async () => {
    const failing = fakeWriteApi(() => json({}, 500));
    await expect(failing.client.performAction('a1', { action: 'close' })).rejects.toBeInstanceOf(JiraApiError);
    expect(failing.calls).toHaveLength(1);

    const limited = fakeWriteApi((call, n) => {
      if (call.path.startsWith('/v1/alerts/requests/')) return json({ isSuccess: true });
      return n === 1 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : accepted();
    });
    await expect(limited.client.performAction('a1', { action: 'close' })).resolves.toMatchObject({ state: 'done' });
    expect(limited.calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  it('reads attachments in the documented and in the live field names', async () => {
    const { client } = fakeWriteApi(() =>
      json({
        values: [
          { id: '1', attachmentName: 'documented.txt', insertedAt: '2026-11-19T10:00:00Z' },
          { id: '2', name: 'live.txt', url: 'x/y/', createdAt: '2026-11-19T11:00:00Z', extension: 'txt' },
        ],
        links: {},
      }),
    );
    const page = await client.listAttachments('a1');
    expect(page.values).toEqual([
      { id: '1', name: 'documented.txt', insertedAt: Date.parse('2026-11-19T10:00:00Z') },
      { id: '2', name: 'live.txt', insertedAt: Date.parse('2026-11-19T11:00:00Z') },
    ]);
  });

  it('gives write failures their own messages', async () => {
    const forbidden = fakeWriteApi(() => json({}, 403));
    await expect(forbidden.client.performAction('a1', { action: 'close' })).rejects.toThrow(/refused this action/);
    const missing = fakeWriteApi(() => json({}, 404));
    await expect(missing.client.performAction('a1', { action: 'close' })).rejects.toThrow(/did not find/);
  });
});

// ---- The local HTTP API ---------------------------------------------------------

function demoConfig(writeActions = [...ACTION_IDS]): AppConfig {
  return { ...loadConfig({}), writeActions };
}

async function serve(config: AppConfig, extraAlerts = 0) {
  const demo = new DemoSource(config.extraction, extraAlerts, Date.now());
  demo.actionDelayMs = 0;
  const store = new AlertStore(demo, 30_000);
  const actions = new ActionService(demo, store, config.writeActions);
  const server = createApp(config, store, demo, actions).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const first = (await (await fetch(`${base}/api/alerts`)).json()) as { alerts: Array<{ id: string; status: string; acknowledged: boolean }> };
  return { base, server, alerts: first.alerts };
}

const servers: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function rawPost(url: string, headers: Record<string, string>, body: string): Promise<number> {
  const { hostname, port, pathname } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path: pathname, method: 'POST', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end(body);
  });
}

const actionHeaders = { 'content-type': 'application/json', 'x-alert-center-action': '1' };

describe('background history analysis API', () => {
  it('runs in read-only mode, guards requests, and returns all results in batches', async () => {
    const { base, server, alerts } = await serve(demoConfig([]), 2200);
    servers.push(server);
    const url = `${base}/api/history-analysis`;
    const today = new Date();
    const from = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to = today.toISOString().slice(0, 10);
    const body = JSON.stringify({ from, to });
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: { ...actionHeaders, origin: 'https://evil.example' }, body })).status).toBe(403);
    const response = await fetch(url, { method: 'POST', headers: actionHeaders, body });
    expect(response.status).toBe(200);
    const job = await response.json() as { id: string };
    await vi.waitFor(async () => {
      const state = await (await fetch(url)).json() as { state: string };
      expect(state.state).toBe('completed');
    }, { timeout: 15_000 });

    let total = 0;
    let pages = 0;
    for (let month = 0; ; month += 1) {
      let offset = 0;
      let page: { month: { alerts: unknown[] }; hasNextPage: boolean; hasNextMonth: boolean };
      do {
        const result = await fetch(`${url}/results?id=${job.id}&month=${month}&offset=${offset}`);
        expect(result.status).toBe(200);
        page = await result.json() as typeof page;
        total += page.month.alerts.length;
        pages += 1;
        offset += 1000;
      } while (page.hasNextPage);
      if (!page.hasNextMonth) break;
    }
    expect(pages).toBeGreaterThan(2);
    expect(total).toBe(alerts.length);
    expect((await fetch(`${url}/results?id=old&month=0&offset=0`)).status).toBe(409);
  });
});

describe('POST /api/alerts/:id/actions', () => {
  it('runs an action on demo data and returns the updated alert', async () => {
    const { base, server, alerts } = await serve(demoConfig());
    servers.push(server);
    const open = alerts.find((a) => a.status === 'open' && !a.acknowledged)!;
    const response = await fetch(`${base}/api/alerts/${open.id}/actions`, { method: 'POST', headers: actionHeaders, body: JSON.stringify({ action: 'acknowledge' }) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { state: string }; alert: { status: string; acknowledged: boolean } };
    expect(body.result.state).toBe('done');
    expect(body.alert).toMatchObject({ status: 'acked', acknowledged: true });
    // The cached list has the change too.
    const list = (await (await fetch(`${base}/api/alerts`)).json()) as { alerts: Array<{ id: string; status: string }> };
    expect(list.alerts.find((a) => a.id === open.id)?.status).toBe('acked');
    const logs = (await (await fetch(`${base}/api/alerts/${open.id}/logs`)).json()) as { values: Array<{ text: string }> };
    expect(logs.values[0]?.text).toBe('Alert acknowledged');
  });

  it('refuses requests that could come from another web page', async () => {
    const { base, server, alerts } = await serve(demoConfig());
    servers.push(server);
    const url = `${base}/api/alerts/${alerts[0]!.id}/actions`;
    const body = JSON.stringify({ action: 'close' });
    // No custom header: what a plain HTML form or a "simple" cross-site fetch would send.
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain', 'x-alert-center-action': '1' }, body })).status).toBe(415);
    expect((await fetch(url, { method: 'POST', headers: { ...actionHeaders, origin: 'https://evil.example' }, body })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: { ...actionHeaders, 'sec-fetch-site': 'cross-site' }, body })).status).toBe(403);
    // fetch() cannot set Host; a DNS-rebinding page would arrive with its own name.
    expect(await rawPost(url, { ...actionHeaders, host: 'evil.example' }, body)).toBe(403);
    // Other methods and paths stay closed.
    expect((await fetch(url, { method: 'PUT', headers: actionHeaders, body })).status).toBe(405);
    expect((await fetch(`${base}/api/alerts/${alerts[0]!.id}`, { method: 'POST', headers: actionHeaders, body })).status).toBe(405);
    // Malformed JSON is a clean 400.
    expect((await fetch(url, { method: 'POST', headers: actionHeaders, body: '{' })).status).toBe(400);
    // Nothing above changed the alert.
    const list = (await (await fetch(`${base}/api/alerts`)).json()) as { alerts: Array<{ id: string; status: string }> };
    expect(list.alerts[0]!.status).toBe(alerts[0]!.status);
  });

  it('answers 403 when writes are off or the action is not enabled', async () => {
    const off = await serve(demoConfig([]));
    servers.push(off.server);
    const status = (await (await fetch(`${off.base}/api/status`)).json()) as { readOnly: boolean; writes: { enabled: boolean } };
    expect(status).toMatchObject({ readOnly: true, writes: { enabled: false } });
    const refused = await fetch(`${off.base}/api/alerts/${off.alerts[0]!.id}/actions`, { method: 'POST', headers: actionHeaders, body: JSON.stringify({ action: 'close' }) });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toMatch(/JIRA_WRITE_ACTIONS/);

    const partial = await serve(demoConfig(['acknowledge']));
    servers.push(partial.server);
    const closeRefused = await fetch(`${partial.base}/api/alerts/${partial.alerts[0]!.id}/actions`, { method: 'POST', headers: actionHeaders, body: JSON.stringify({ action: 'close' }) });
    expect(closeRefused.status).toBe(403);
  });

  it('runs only custom actions the alert itself offers', async () => {
    const { base, server, alerts } = await serve(demoConfig());
    servers.push(server);
    const post = (id: string, actionName: string) =>
      fetch(`${base}/api/alerts/${id}/actions`, { method: 'POST', headers: actionHeaders, body: JSON.stringify({ action: 'customAction', actionName }) });
    const details = await Promise.all(alerts.slice(0, 6).map(async (a) => (await (await fetch(`${base}/api/alerts/${a.id}`)).json()) as { id: string; actions: string[]; status: string }));
    const offering = details.find((d) => d.actions.length > 0 && d.status !== 'closed')!;
    expect((await post(offering.id, offering.actions[0]!)).status).toBe(200);
    expect((await post(offering.id, 'rm -rf /')).status).toBe(400);
  });

  it('demo data follows Jira: a closed alert cannot be acknowledged', async () => {
    const { base, server, alerts } = await serve(demoConfig());
    servers.push(server);
    const closed = alerts.find((a) => a.status === 'closed')!;
    const response = await fetch(`${base}/api/alerts/${closed.id}/actions`, { method: 'POST', headers: actionHeaders, body: JSON.stringify({ action: 'acknowledge' }) });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toBe('Jira did not apply the action: Alert is closed');
  });
});

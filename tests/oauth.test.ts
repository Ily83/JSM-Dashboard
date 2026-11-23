import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../server/config';
import { JiraClient } from '../server/jira/client';
import { log } from '../server/logger';
import { createOAuthApp, oauthScopes, type DesktopAuth } from '../server/oauth';

const env = {
  JIRA_AUTH_MODE: 'oauth', JIRA_SITE_URL: 'https://test.atlassian.net',
  JIRA_OAUTH_CLIENT_ID: 'client', JIRA_OAUTH_CLIENT_SECRET: 'test-secret',
};
const siteId = '76831eb2-10ab-41df-a843-39a01f1e09e4';
const close: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(close.splice(0).map(fn => fn())); });

async function fixture({
  siteUrl = env.JIRA_SITE_URL, desktop, resources, writeActions, tokenScopes,
}: {
  siteUrl?: string;
  desktop?: DesktopAuth;
  resources?: Array<{ url: string; id: string; scopes: string[] }>;
  writeActions?: string;
  tokenScopes?: string[];
} = {}) {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  close.push(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config = loadConfig({ ...env, JIRA_WRITE_ACTIONS: writeActions, JIRA_OAUTH_REDIRECT_URI: local + '/api/auth/callback' });
  const grants: Record<string, string>[] = [];
  const upstream = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input).endsWith('/oauth/token')) {
      const body = JSON.parse(String(init?.body));
      grants.push(body);
      return Response.json({
        access_token: 'test-access', refresh_token: `refresh-${grants.length}`, expires_in: grants.length === 1 ? 1 : 3600,
        scope: tokenScopes?.join(' '),
      });
    }
    return Response.json(resources ?? [{ url: siteUrl, id: siteId, scopes: oauthScopes([]).filter(s => s !== 'offline_access') }]);
  });
  const app = createOAuthApp(config.oauth!, config.jira!, (cloudId) => (_req, res) => { res.json({ cloudId }); }, upstream, desktop);
  server.on('request', app);
  const origin = new URL(config.oauth!.redirectUri).origin;
  const get = (path: string, cookie = '', method = 'GET', requestOrigin = origin, window = false) =>
    fetch(local + path, { method, redirect: 'manual', headers: { cookie, origin: requestOrigin, ...(window ? { 'x-test-window': 'trusted' } : {}) } });
  async function start() {
    const res = await get('/api/auth/start');
    const url = new URL(res.headers.get('location')!);
    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(oauthScopes(config.writeActions));
    return { callback: `/api/auth/callback?code=test&state=${url.searchParams.get('state')}`, cookie: res.headers.getSetCookie()[0].split(';')[0] };
  }
  return { get, start, grants };
}

describe('local OAuth sign-in', () => {
  it('hands off desktop OAuth once and keeps the authenticated dashboard out of the work browser', async () => {
    const openBrowser = vi.fn(async (_url: string) => {});
    const onSignedIn = vi.fn();
    const { get, grants } = await fixture({ desktop: {
      isWindow: req => req.get('x-test-window') === 'trusted', openBrowser, onSignedIn,
    } });
    expect((await get('/api/auth/start')).status).toBe(403);
    expect((await get('/api/auth/start', '', 'GET', undefined, true)).status).toBe(200);
    const link = new URL(openBrowser.mock.calls[0][0]);
    const redirect = await get(link.pathname);
    expect(redirect.status).toBe(302);
    expect((await get(link.pathname)).status).toBe(403);
    const state = new URL(redirect.headers.get('location')!).searchParams.get('state');
    const callback = `/api/auth/callback?code=test&state=${state}`;
    expect((await get(callback)).status).toBe(400);
    const loginCookie = redirect.headers.getSetCookie()[0].split(';')[0];
    const complete = await get(callback, loginCookie);
    expect(complete.status).toBe(200);
    expect(await complete.text()).toContain('Return to the Alert Center window');
    expect(complete.headers.getSetCookie().every(c => !c.includes('_session='))).toBe(true);
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect((await get('/api/alerts', loginCookie)).status).toBe(403);
    expect(await (await get('/api/alerts', '', 'GET', undefined, true)).json()).toEqual({ cloudId: siteId });
    expect(grants).toHaveLength(2);
    expect((await get('/api/auth/logout', '', 'POST', undefined, true)).status).toBe(303);
    expect((await get('/api/status', '', 'GET', undefined, true)).status).toBe(401);
  });
  it('never falls back to basic or demo on incomplete OAuth configuration', () => {
    expect(() => loadConfig({ ...env, JIRA_OAUTH_CLIENT_SECRET: '' })).toThrow(/OAuth requires/);
    expect(() => loadConfig({ ...env, HOST: '0.0.0.0' })).toThrow(/loopback/);
    expect(() => loadConfig({ ...env, JIRA_OAUTH_REDIRECT_URI: 'https://example.org/api/auth/callback' })).toThrow(/callback/);
    expect(loadConfig({ ...env, DEMO_MODE: 'true' }).oauth).toBeUndefined();
    expect(loadConfig({ ...env, JIRA_API_TOKEN: 'unused' }).jira?.apiToken).toBe('');
  });

  it('binds the callback to one browser, rotates once during parallel requests, and invalidates the cookie on logout', async () => {
    const { get, start, grants } = await fixture();
    expect((await get('/api/alerts')).status).toBe(401);
    const login = await start();
    expect((await get(login.callback)).status).toBe(400);
    expect((await get(login.callback + 'wrong', login.cookie)).status).toBe(400);
    expect(grants).toHaveLength(0);
    const callback = await get(login.callback, login.cookie);
    expect(callback.status).toBe(303);
    const sessionCookie = callback.headers.getSetCookie().find(c => c.includes('_session='))!;
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).not.toMatch(/test-access|refresh-1|test-secret/);
    const sid = sessionCookie.split(';')[0];
    expect((await get(login.callback, login.cookie)).status).toBe(400);
    const debug = vi.spyOn(log, 'debug').mockImplementation(() => {});
    try {
      const results = await Promise.all([get('/api/status', sid), get('/api/alerts', sid)]);
      for (const response of results) expect(await response.json()).toEqual({ cloudId: siteId });
      expect(debug.mock.calls).toEqual([['Atlassian OAuth token refresh succeeded']]);
    } finally {
      debug.mockRestore();
    }
    expect(grants.map(g => g.grant_type)).toEqual(['authorization_code', 'refresh_token']);
    expect(grants[1].refresh_token).toBe('refresh-1');
    expect((await get('/api/auth/logout', sid, 'POST', 'https://other.example')).status).toBe(403);
    expect((await get('/api/auth/logout', sid, 'POST')).status).toBe(303);
    expect((await get('/api/status', sid)).status).toBe(401);
  });

  it('refuses a grant for a different Jira site', async () => {
    const { get, start } = await fixture({ siteUrl: 'https://other.atlassian.net' });
    const login = await start();
    expect((await get(login.callback, login.cookie)).status).toBe(403);
    expect((await get('/api/status')).status).toBe(401);
  });

  it('accepts Operations and Jira directory scopes returned in separate entries for the same site', async () => {
    const { get, start } = await fixture({ writeActions: 'assign,snooze', resources: [
      { url: env.JIRA_SITE_URL, id: siteId, scopes: oauthScopes(['snooze']).slice(1) },
      { url: `${env.JIRA_SITE_URL}/`, id: siteId, scopes: ['read:jira-user'] },
    ] });
    const login = await start();
    expect((await get(login.callback, login.cookie)).status).toBe(303);
  });

  it('does not borrow OAuth scopes from another URL or site ID', async () => {
    const { get, start } = await fixture({ writeActions: 'assign', resources: [
      { url: env.JIRA_SITE_URL, id: siteId, scopes: oauthScopes(['snooze']).slice(1) },
      { url: 'https://other.atlassian.net', id: siteId, scopes: ['read:jira-user'] },
      { url: env.JIRA_SITE_URL, id: '22222222-2222-4222-8222-222222222222', scopes: ['read:jira-user'] },
    ] });
    const login = await start();
    const response = await get(login.callback, login.cookie);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('read:jira-user');
    expect((await get('/api/status')).status).toBe(401);
  });

  it('uses the token grant for Operations scopes omitted from the matched site entry', async () => {
    const { get, start } = await fixture({
      writeActions: 'assign,snooze',
      resources: [{ url: env.JIRA_SITE_URL, id: siteId, scopes: ['read:jira-user'] }],
      tokenScopes: oauthScopes(['assign', 'snooze']),
    });
    const login = await start();
    expect((await get(login.callback, login.cookie)).status).toBe(303);
  });

  it('does not accept token scopes in place of the configured site', async () => {
    const { get, start } = await fixture({
      resources: [{ url: 'https://other.atlassian.net', id: siteId, scopes: [] }],
      tokenScopes: oauthScopes([]),
    });
    const login = await start();
    expect((await get(login.callback, login.cookie)).status).toBe(403);
  });

  it('still rejects missing Operations grants and directory permission not listed for the site', async () => {
    const { get, start } = await fixture({
      writeActions: 'assign',
      resources: [{ url: env.JIRA_SITE_URL, id: siteId, scopes: [] }],
      tokenScopes: [...oauthScopes([]), 'read:jira-user'],
    });
    const login = await start();
    const response = await get(login.callback, login.cookie);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('write:ops-alert:jira-service-management, read:jira-user');
  });

  it('replacing the active sign-in invalidates the previous browser session', async () => {
    const { get, start } = await fixture();
    async function signIn() {
      const login = await start();
      const callback = await get(login.callback, login.cookie);
      return callback.headers.getSetCookie().find(c => c.includes('_session='))!.split(';')[0];
    }
    const first = await signIn();
    const second = await signIn();
    expect((await get('/api/history-analysis/results', first)).status).toBe(401);
    expect((await get('/api/status', second)).status).toBe(200);
  });

  it('asks for write, directory and delete scopes only for the configured actions', () => {
    expect(oauthScopes([])).toEqual(['offline_access', 'read:ops-alert:jira-service-management', 'read:ops-config:jira-service-management']);
    expect(oauthScopes(['maintenance']).slice(3)).toEqual(['write:ops-config:jira-service-management']);
    expect(oauthScopes(['removeTags']).slice(3)).toEqual(['delete:ops-alert:jira-service-management']);
    expect(oauthScopes(['assign', 'snooze']).slice(3)).toEqual(['write:ops-alert:jira-service-management', 'read:jira-user']);
  });

  it('uses the OAuth gateway for both Jira APIs and invalidates a rejected bearer', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ values: [] }));
    const bearer = { token: async () => 'test-access', invalidate: vi.fn() };
    const client = new JiraClient({ ...loadConfig(env).jira!, cloudId: siteId }, 4, fetcher, bearer);
    await client.listAlerts({ offset: 0, size: 1 });
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(client.myself()).rejects.toThrow(/sign in again/i);
    expect(bearer.invalidate).toHaveBeenCalledOnce();
    const root = `https://api.atlassian.com/ex/jira/${siteId}`;
    expect(fetcher.mock.calls.map(([u]) => String(u).split('?')[0])).toEqual([`${root}/jsm/ops/api/v1/alerts`, `${root}/rest/api/3/myself`]);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer test-access' });
  });
});

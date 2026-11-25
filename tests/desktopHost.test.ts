import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopConfigResponse, DesktopConfigSaveResponse } from '../shared/desktopConfig';
import type { StatusResponse } from '../shared/types';
import { createDesktopHost, DESKTOP_HEADER } from '../server/desktopHost';
import { parseEnvText } from '../server/envFile';
import { setLogLevel } from '../server/logger';

setLogLevel('error');
const SECRET = 'window-secret-for-tests';
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

interface Answer<T> { status: number; headers: IncomingHttpHeaders; text: string; body: T }
interface CallOptions { window?: boolean; host?: string; origin?: string | null; action?: boolean; body?: unknown; raw?: string; type?: string; site?: string }

async function fixture(file = '', baseEnv: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'desktop-host-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const dist = path.join(dir, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title><div id="root"></div>');
  writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  const envFile = path.join(dir, '.env');
  if (file) writeFileSync(envFile, file);
  const opened: string[] = [];
  const host = createDesktopHost({
    envFile, baseEnv, distDir: dist, secret: SECRET, port: 0,
    openBrowser: async (url) => { opened.push(url); }, onSignedIn: vi.fn(),
  });
  const server = createServer(host.handler).listen(host.port, '127.0.0.1');
  await once(server, 'listening');
  cleanup.push(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const port = (server.address() as AddressInfo).port;
  host.listening(port);

  /** One request, as the window (with its secret, on the app's own address) unless told otherwise. */
  function call<T = unknown>(method: string, route: string, options: CallOptions = {}): Promise<Answer<T>> {
    const origin = host.origin();
    const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const headers: Record<string, string> = { host: options.host ?? new URL(origin).host };
    if (options.window !== false) headers[DESKTOP_HEADER] = SECRET;
    if (method !== 'GET' && options.origin !== null) headers.origin = options.origin ?? origin;
    if (options.action !== false && method !== 'GET') headers['x-alert-center-action'] = '1';
    if (options.site) headers['sec-fetch-site'] = options.site;
    if (payload !== undefined) headers['content-type'] = options.type ?? 'application/json';
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path: route, headers }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { text += chunk; });
        res.on('end', () => {
          let body: unknown = null;
          try { body = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, body: body as T });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  const save = (values: Record<string, string | null>, options: CallOptions = {}) =>
    call<DesktopConfigSaveResponse & { error?: string }>('POST', '/api/desktop/config', { ...options, body: { values } });
  const read = () => call<DesktopConfigResponse>('GET', '/api/desktop/config');
  const field = (config: DesktopConfigResponse, key: string) => config.fields.find((f) => f.key === key)!;
  const fileText = () => { try { return readFileSync(envFile, 'utf8'); } catch { return ''; } };
  return { host, port, call, save, read, field, fileText, envFile, opened };
}

const LIVE = { JIRA_SITE_URL: 'https://one.atlassian.net', JIRA_AUTH_MODE: 'basic', JIRA_EMAIL: 'ops@example.com', JIRA_API_TOKEN: 'not-a-real-token-1' };

describe('desktop host: who may use it', () => {
  it('serves the dashboard and its configuration to the window only', async () => {
    const { call, port } = await fixture();
    for (const route of ['/api/status', '/api/desktop/config', '/setup', '/assets/app.js', '/']) {
      expect((await call('GET', route, { window: false })).status, route).toBe(403);
      expect((await call('GET', route)).status, route).toBe(200);
    }
    // The secret alone is not enough: the request must be for the app's own address.
    expect((await call('GET', '/api/desktop/config', { host: `evil.example:${port}` })).status).toBe(403);
    expect((await call('POST', '/api/desktop/config', { window: false, body: { values: { DEMO_MODE: 'true' } } })).status).toBe(403);
  });

  it('refuses a save that does not come from the window’s own page', async () => {
    const { save, call, fileText } = await fixture();
    const values = { CUSTOMER_PROPERTY_KEYS: 'tenant' };
    expect((await save(values, { action: false })).status).toBe(403);
    expect((await save(values, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await save(values, { origin: null })).status).toBe(403);
    expect((await save(values, { site: 'cross-site' })).status).toBe(403);
    expect((await call('POST', '/api/desktop/config', { raw: 'values[CUSTOMER_PROPERTY_KEYS]=tenant', type: 'application/x-www-form-urlencoded' })).status).toBe(403);
    expect((await call('POST', '/api/desktop/config', { raw: '{not json' })).status).toBe(400);
    expect((await call('PUT', '/api/desktop/config', { body: { values } })).status).toBe(405);
    expect(fileText()).toBe('');
  });

  it('sends security headers with its own pages and never caches the configuration', async () => {
    const { call } = await fixture();
    const setup = await call('GET', '/setup');
    expect(setup.headers['content-type']).toContain('text/html');
    expect(setup.headers['content-security-policy']).toContain("default-src 'self'");
    expect(setup.headers['x-powered-by']).toBeUndefined();
    const config = await call('GET', '/api/desktop/config');
    expect(config.headers['cache-control']).toBe('no-store');
    expect(config.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('desktop host: reading the configuration', () => {
  it('lists the editable settings and never a secret', async () => {
    const { read, field, envFile } = await fixture(`${Object.entries(LIVE).map(([k, v]) => `${k}=${v}`).join('\n')}\nJIRA_WRITE_ACTIONS=acknowledge\n`);
    const { status, body, text } = await read();
    expect(status).toBe(200);
    expect(body.file).toBe(envFile);
    expect(body.mode).toBe('live');
    expect(field(body, 'JIRA_SITE_URL')).toEqual({ key: 'JIRA_SITE_URL', value: 'https://one.atlassian.net', set: true, locked: false });
    expect(field(body, 'JIRA_API_TOKEN')).toEqual({ key: 'JIRA_API_TOKEN', value: null, set: true, locked: false });
    expect(field(body, 'JIRA_OAUTH_CLIENT_SECRET')).toEqual({ key: 'JIRA_OAUTH_CLIENT_SECRET', value: null, set: false, locked: false });
    expect(body.fields.map((f) => f.key)).not.toContain('JIRA_WRITE_ACTIONS');
    expect(text).not.toContain('not-a-real-token-1');
  });

  it('marks what the computer’s environment sets as locked, and does not let the window change it', async () => {
    const { read, field, save, fileText } = await fixture('JIRA_ALERT_QUERY=from-file\n', { JIRA_ALERT_QUERY: 'from-environment', JIRA_API_TOKEN: 'environment-token' });
    const { body, text } = await read();
    expect(field(body, 'JIRA_ALERT_QUERY')).toEqual({ key: 'JIRA_ALERT_QUERY', value: 'from-environment', set: true, locked: true });
    expect(field(body, 'JIRA_API_TOKEN')).toEqual({ key: 'JIRA_API_TOKEN', value: null, set: true, locked: true });
    expect(text).not.toContain('environment-token');
    const refused = await save({ JIRA_ALERT_QUERY: 'changed' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('set by the computer');
    expect(fileText()).toBe('JIRA_ALERT_QUERY=from-file\n');
  });
});

describe('desktop host: saving', () => {
  it('writes the file, keeps its comments and applies the change without a restart', async () => {
    const { save, call, fileText } = await fixture('# my notes\nDEMO_ALERT_COUNT=5\n# CUSTOMER_PROPERTY_KEYS=customer,customers\n');
    const before = await call<StatusResponse>('GET', '/api/status');
    expect(before.body.configEditor).toBe(true);
    expect(before.body.extraction.customerPropertyKeys).toEqual(['customer', 'customers']);
    const saved = await save({ CUSTOMER_PROPERTY_KEYS: ' tenant, customer ', SERVICE_FALLBACK_TO_ENTITY: 'false' });
    expect(saved.status).toBe(200);
    expect(saved.body.origin).toBe(new URL(saved.body.origin).origin);
    expect(fileText()).toBe('# my notes\nDEMO_ALERT_COUNT=5\n# CUSTOMER_PROPERTY_KEYS=customer,customers\nCUSTOMER_PROPERTY_KEYS=tenant, customer\nSERVICE_FALLBACK_TO_ENTITY=false\n');
    const after = await call<StatusResponse>('GET', '/api/status');
    expect(after.body.extraction.customerPropertyKeys).toEqual(['tenant', 'customer']);
    expect(after.body.extraction.serviceFallbackToEntity).toBe(false);
    // An empty value removes the setting again.
    await save({ CUSTOMER_PROPERTY_KEYS: '' });
    expect(parseEnvText(fileText()).CUSTOMER_PROPERTY_KEYS).toBeUndefined();
  });

  it('starts the file when there is none and connects to Jira with an API token', async () => {
    const { save, read, field, fileText, call } = await fixture();
    const saved = await save(LIVE);
    expect(saved.status).toBe(200);
    expect(saved.body.mode).toBe('live');
    expect(saved.text).not.toContain(LIVE.JIRA_API_TOKEN);
    expect(fileText().startsWith('# Jira Operations')).toBe(true);
    expect(parseEnvText(fileText())).toMatchObject(LIVE);
    expect(field((await read()).body, 'JIRA_API_TOKEN').set).toBe(true);
    const status = await call<StatusResponse>('GET', '/api/status');
    expect(status.body.mode).toBe('live');
    expect(status.body.site).toBe('one.atlassian.net');
    // Writes stay off: the window cannot enable them.
    expect(status.body.readOnly).toBe(true);
  });

  it('only changes the settings meant for the window', async () => {
    const { save, fileText } = await fixture('JIRA_WRITE_ACTIONS=\n');
    for (const key of ['JIRA_WRITE_ACTIONS', 'PORT', 'HOST', 'ALLOWED_HOSTS', 'JIRA_OAUTH_REDIRECT_URI', 'JIRA_CLOUD_ID', 'NODE_OPTIONS']) {
      const refused = await save({ [key]: 'true' });
      expect(refused.status, key).toBe(400);
    }
    expect((await save({})).status).toBe(400);
    expect((await save({ JIRA_ALERT_QUERY: 'a\nJIRA_WRITE_ACTIONS=true' })).status).toBe(400);
    expect((await save({ JIRA_ALERT_QUERY: 'x'.repeat(2001) })).status).toBe(400);
    expect(fileText()).toBe('JIRA_WRITE_ACTIONS=\n');
  });

  it('refuses invalid settings, naming the setting, and keeps the running configuration', async () => {
    const { save, call, fileText } = await fixture('JIRA_MAX_ALERTS=100\n');
    const refused = await save({ JIRA_MAX_ALERTS: 'many' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('JIRA_MAX_ALERTS');
    const missingSecret = await save({ JIRA_SITE_URL: 'https://one.atlassian.net', JIRA_AUTH_MODE: 'oauth', JIRA_OAUTH_CLIENT_ID: 'client' });
    expect(missingSecret.status).toBe(400);
    expect(missingSecret.body.error).toContain('JIRA_OAUTH_CLIENT_SECRET');
    const badMap = await save({ CUSTOMER_MAP_FILE: 'missing-file.csv' });
    expect(badMap.status).toBe(400);
    expect(fileText()).toBe('JIRA_MAX_ALERTS=100\n');
    expect((await call<StatusResponse>('GET', '/api/status')).body.mode).toBe('demo');
  });

  it('reports an incomplete Jira connection as a warning and stays on sample data', async () => {
    const { save } = await fixture();
    const saved = await save({ JIRA_SITE_URL: 'https://one.atlassian.net' });
    expect(saved.status).toBe(200);
    expect(saved.body.mode).toBe('demo');
    expect(saved.body.warnings.join(' ')).toContain('incomplete');
  });

  it('wants the API token again before it is sent to another site, and forgets the old site’s cloud ID', async () => {
    const start = `${Object.entries(LIVE).map(([k, v]) => `${k}=${v}`).join('\n')}\nJIRA_CLOUD_ID=76831eb2-10ab-41df-a843-39a01f1e09e4\n`;
    const { save, fileText } = await fixture(start);
    const refused = await save({ JIRA_SITE_URL: 'https://two.atlassian.net' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('Enter the API token again to change the Jira site.');
    expect(fileText()).toBe(start);
    // The same site written another way is not a change.
    expect((await save({ JIRA_SITE_URL: 'one.atlassian.net/' })).status).toBe(200);
    expect(parseEnvText(fileText()).JIRA_CLOUD_ID).toBe('76831eb2-10ab-41df-a843-39a01f1e09e4');
    const moved = await save({ JIRA_SITE_URL: 'https://two.atlassian.net', JIRA_API_TOKEN: 'not-a-real-token-2' });
    expect(moved.status).toBe(200);
    const values = parseEnvText(fileText());
    expect(values.JIRA_API_TOKEN).toBe('not-a-real-token-2');
    expect(values.JIRA_CLOUD_ID).toBeUndefined();
  });

  it('refuses a new site for an API token that the environment sets', async () => {
    const { save } = await fixture('JIRA_SITE_URL=https://one.atlassian.net\nJIRA_EMAIL=ops@example.com\n', { JIRA_API_TOKEN: 'environment-token' });
    const refused = await save({ JIRA_SITE_URL: 'https://two.atlassian.net' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('environment');
  });
});

describe('desktop host: OAuth', () => {
  it('switches to Atlassian sign-in, moves to the callback address and keeps the settings page reachable while signed out', async () => {
    const { save, call, host, port, fileText } = await fixture(`PORT=1\n${Object.entries(LIVE).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
    // The callback follows PORT in the file (1 here), while the test server listens on a free port.
    const oauth = await save({ JIRA_AUTH_MODE: 'oauth', JIRA_OAUTH_CLIENT_ID: 'client', JIRA_OAUTH_CLIENT_SECRET: 'not-a-real-secret' });
    expect(oauth.status).toBe(200);
    expect(oauth.body.oauth).toBe(true);
    expect(oauth.body.callbackUrl).toBe('http://localhost:1/api/auth/callback');
    expect(oauth.body.origin).toBe('http://localhost:1');
    expect(host.origin()).toBe('http://localhost:1');
    expect(oauth.text).not.toContain('not-a-real-secret');
    expect(port).not.toBe(1);

    // Signed out: the dashboard asks for a sign-in, and the sign-in page links to the settings.
    const home = await call('GET', '/');
    expect(home.status).toBe(303);
    expect(home.headers.location).toBe('/api/auth/login');
    const login = await call('GET', '/api/auth/login');
    expect(login.text).toContain('<a href="/setup">Connection settings</a>');
    expect((await call('GET', '/api/status')).status).toBe(401);
    expect((await call('GET', '/setup')).status).toBe(200);
    expect((await call('GET', '/assets/app.js')).status).toBe(200);
    expect((await call('GET', '/api/desktop/config')).status).toBe(200);
    // Still nothing for a browser, apart from the two sign-in hand-off routes the OAuth layer allows.
    for (const route of ['/setup', '/assets/app.js', '/api/desktop/config', '/api/auth/login']) {
      expect((await call('GET', route, { window: false })).status, route).toBe(403);
    }

    // In OAuth mode the stored API token is not used: a new site drops it instead of asking for it.
    const moved = await save({ JIRA_SITE_URL: 'https://two.atlassian.net' });
    expect(moved.status).toBe(200);
    expect(parseEnvText(fileText()).JIRA_API_TOKEN).toBeUndefined();
    // Back to sample data: the app returns to its plain local address.
    const demo = await save({ DEMO_MODE: 'true' });
    expect(demo.body.oauth).toBe(false);
    expect(demo.body.origin).toBe(`http://localhost:${port}`);
    expect((await call('GET', '/api/status')).status).toBe(200);
  });
});

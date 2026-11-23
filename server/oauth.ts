import { randomBytes } from 'node:crypto';
import express, { type Request, type Response, type RequestHandler } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import type { ActionId } from '../shared/actions';
import type { JiraConfig, OAuthConfig } from './config';
import { log } from './logger';

const AUTH = '/api/auth';
const TTL = 8 * 60 * 60_000;
const random = () => randomBytes(32).toString('base64url');
const tokens = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});
const sites = z.array(z.object({ id: z.string().uuid(), url: z.string(), scopes: z.array(z.string()) }));

export function oauthScopes(actions: ActionId[]) {
  const scopes = ['offline_access', 'read:ops-alert:jira-service-management', 'read:ops-config:jira-service-management'];
  if (actions.some(a => a !== 'maintenance' && a !== 'removeTags' && a !== 'deleteNote')) scopes.push('write:ops-alert:jira-service-management');
  if (actions.includes('removeTags') || actions.includes('deleteNote')) scopes.push('delete:ops-alert:jira-service-management');
  if (actions.includes('maintenance')) scopes.push('write:ops-config:jira-service-management');
  if (actions.includes('assign') || actions.includes('addResponder')) scopes.push('read:jira-user');
  return scopes;
}

export interface Bearer {
  token(): Promise<string>;
  invalidate(): void;
}

/** Supplied only by the Electron main process. The browser never receives window credentials. */
export interface DesktopAuth {
  isWindow(req: Request): boolean;
  openBrowser(url: string): Promise<void>;
  onSignedIn(): void;
}

function cookie(req: Request, name: string) {
  return req.get('cookie')?.split(/;\s*/).find(c => c.startsWith(`${name}=`))?.slice(name.length + 1);
}

/** The local backend serves one operator at a time. Each completed login gets fresh services and caches. */
export function createOAuthApp(
  oauth: OAuthConfig, jira: JiraConfig, dashboard: (cloudId: string, bearer: Bearer) => RequestHandler,
  fetchImpl: typeof fetch = fetch,
  desktop?: DesktopAuth,
) {
  const app = express();
  const callback = new URL(oauth.redirectUri);
  const scopes = oauthScopes(jira.writeActions);
  const siteScopes = scopes.filter(scope => scope !== 'offline_access');
  const prefix = `jsm_${callback.port}_`;
  const options = { httpOnly: true, sameSite: 'lax' as const, path: '/' };
  let pending: { state: string; browser: string; until: number } | undefined;
  let launch: { key: string; until: number } | undefined;
  let desktopAttempt = 0;
  let session: { id: string; handler: RequestHandler; bearer: Bearer } | undefined;

  const exchange = async (grant: Record<string, string>) => {
    const response = await fetchImpl('https://auth.atlassian.com/oauth/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...grant, client_id: oauth.clientId, client_secret: oauth.clientSecret }),
    });
    if (!response.ok) throw new Error('Token exchange failed.');
    return tokens.parse(await response.json());
  };

  app.disable('x-powered-by');
  app.use(helmet({ strictTransportSecurity: false, contentSecurityPolicy: { directives: { upgradeInsecureRequests: null, styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } } }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('host') !== callback.host) {
      res.status(403).type('text').send(`Open the configured dashboard address: ${callback.origin}`);
    } else if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('origin') !== callback.origin) {
      res.sendStatus(403);
    } else if (desktop && !desktop.isWindow(req) &&
        !(req.method === 'GET' && (req.path === `${AUTH}/callback` || /^\/api\/auth\/desktop\/[A-Za-z0-9_-]{43}$/.test(req.path)))) {
      res.sendStatus(403);
    } else next();
  });

  const loginPage = (res: Response, message: string, retry = true) => res.type('html').send(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Alert Center sign-in</title><main><h1>Jira Operations – Alert Center</h1><p>${message}</p>${retry ? `<a href="${AUTH}/start">Sign in with Atlassian</a>` : ''}</main></html>`,
  );
  app.get(`${AUTH}/login`, (_req, res) => loginPage(res, 'Use the Atlassian account for your Jira site.'));
  const start = (res: Response) => {
    pending = { state: random(), browser: random(), until: Date.now() + 600_000 };
    res.cookie(prefix + 'login', pending.browser, { ...options, maxAge: 600_000 });
    const query = new URLSearchParams({
      audience: 'api.atlassian.com', client_id: oauth.clientId, scope: scopes.join(' '),
      redirect_uri: oauth.redirectUri, state: pending.state, response_type: 'code', prompt: 'consent',
    });
    res.redirect(`https://auth.atlassian.com/authorize?${query}`);
  };
  app.get(`${AUTH}/start`, async (req, res) => {
    if (req.get('sec-fetch-site') === 'cross-site') { res.sendStatus(403); return; }
    if (!desktop) { start(res); return; }
    pending = undefined;
    desktopAttempt++;
    const key = random();
    launch = { key, until: Date.now() + 60_000 };
    try {
      await desktop.openBrowser(`${callback.origin}${AUTH}/desktop/${key}`);
      loginPage(res, 'Finish signing in in your work browser. This window will open the dashboard when sign-in completes.');
    } catch {
      if (launch?.key === key) launch = undefined;
      loginPage(res.status(502), 'Could not open the work browser. Try again.');
    }
  });
  app.get(`${AUTH}/desktop/:key`, (req, res) => {
    if (!desktop || !launch || launch.until <= Date.now() || req.params.key !== launch.key) {
      res.sendStatus(403); return;
    }
    launch = undefined;
    start(res);
  });
  app.get(`${AUTH}/callback`, async (req, res) => {
    const callbackPage = (message: string, status: number) => loginPage(res.status(status), message, !desktop);
    if (!pending || pending.until <= Date.now() || req.query.state !== pending.state || cookie(req, prefix + 'login') !== pending.browser) {
      callbackPage('This sign-in link expired or belongs to another browser. Start again in Alert Center.', 400);
      return;
    }
    const attempt = desktopAttempt;
    pending = undefined;
    res.clearCookie(prefix + 'login', options);
    if (typeof req.query.code !== 'string' || req.query.error) {
      callbackPage('Sign-in was cancelled or refused.', 403);
      return;
    }
    try {
      let grant = await exchange({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: oauth.redirectUri });
      const response = await fetchImpl('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: { Authorization: `Bearer ${grant.access_token}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Site discovery failed.');
      const resources = sites.parse(await response.json());
      if (desktop && attempt !== desktopAttempt) {
        callbackPage('A newer sign-in attempt was started in Alert Center.', 409);
        return;
      }
      // Atlassian can list a site's products separately. Combine their scopes
      // only when both the configured URL and the resource ID match.
      const bySiteId = new Map<string, Set<string>>();
      for (const resource of resources) {
        if (resource.url.replace(/\/$/, '') !== jira.siteUrl || (jira.cloudId && resource.id !== jira.cloudId)) continue;
        const granted = bySiteId.get(resource.id) ?? new Set<string>();
        for (const scope of resource.scopes) granted.add(scope);
        bySiteId.set(resource.id, granted);
      }
      // The token response can include JSM Operations scopes omitted by
      // accessible-resources. It proves the grant, not the site: still require
      // an exact resource match and site-scoped Jira directory permissions.
      const tokenScopes = new Set(grant.scope?.split(/\s+/));
      const requiredForSite = siteScopes.filter(scope => !(
        scope.includes(':ops-') && scope.endsWith(':jira-service-management') && tokenScopes.has(scope)
      ));
      const siteId = [...bySiteId].find(([, granted]) => requiredForSite.every(scope => granted.has(scope)))?.[0];
      if (!siteId) {
        if (bySiteId.size === 0) {
          log.warn('Atlassian OAuth grant did not include configured Jira site', { resources: resources.length });
          callbackPage('Atlassian did not return access to the configured Jira site. Select that site when consenting.', 403);
          return;
        }
        const missing = [...bySiteId.values()]
          .map(granted => requiredForSite.filter(scope => !granted.has(scope)))
          .reduce((best, next) => next.length < best.length ? next : best);
        log.warn('Atlassian OAuth grant missing required Jira scopes', {
          missing: missing.join(', '),
          ...(grant.scope ? { tokenMissing: siteScopes.filter(scope => !tokenScopes.has(scope)).join(', ') } : {}),
        });
        callbackPage(`Atlassian did not report these required permissions for the configured Jira site: ${missing.join(', ')}.`, 403);
        return;
      }
      const id = random();
      let expires = Date.now() + grant.expires_in * 1000;
      let refresh: Promise<void> | undefined;
      const bearer: Bearer = {
        invalidate() {
          clearTimeout(timer);
          if (session?.id === id) session = undefined;
        },
        async token() {
          if (session?.id !== id) throw new Error('Signed out.');
          if (Date.now() >= expires - 30_000) {
            // Atlassian rotates refresh tokens. Parallel Jira reads must share one exchange.
            refresh ??= exchange({ grant_type: 'refresh_token', refresh_token: grant.refresh_token })
              .then(next => {
                grant = next;
                expires = Date.now() + next.expires_in * 1000;
                log.debug('Atlassian OAuth token refresh succeeded');
              })
              .catch(error => { bearer.invalidate(); throw error; })
              .finally(() => { refresh = undefined; });
            await refresh;
          }
          if (session?.id !== id) throw new Error('Signed out.');
          return grant.access_token;
        },
      };
      const timer = setTimeout(() => bearer.invalidate(), TTL).unref();
      const handler = dashboard(siteId, bearer);
      session?.bearer.invalidate();
      session = { id, bearer, handler };
      if (desktop) {
        callbackPage('Sign-in complete. Return to the Alert Center window. You can close this tab.', 200);
        desktop.onSignedIn();
      } else {
        res.cookie(prefix + 'session', id, { ...options, maxAge: TTL });
        res.redirect(303, '/');
      }
    } catch {
      callbackPage('Could not complete Atlassian sign-in. Check the app credentials, callback URL and connectivity.', 502);
    }
  });
  app.post(`${AUTH}/logout`, (req, res) => {
    if (session && (desktop || cookie(req, prefix + 'session') === session.id)) session.bearer.invalidate();
    if (desktop) { pending = undefined; launch = undefined; desktopAttempt++; }
    res.clearCookie(prefix + 'session', options).redirect(303, `${AUTH}/login`);
  });
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use(async (req, res, next) => {
    const current = session;
    if (current && (desktop || cookie(req, prefix + 'session') === current.id)) {
      try {
        await current.bearer.token();
        if (current === session) { current.handler(req, res, next); return; }
      } catch { /* A failed refresh requires a new sign-in. */ }
    }
    if (req.path === '/readyz') res.status(503).json({ status: 'signed-out' });
    else if (req.path.startsWith('/api/')) res.status(401).set('X-Alert-Center-Login', '1').json({ error: 'Sign in with Atlassian.' });
    else res.redirect(303, `${AUTH}/login`);
  });
  return app;
}

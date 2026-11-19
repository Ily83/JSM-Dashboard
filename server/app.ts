import path from 'node:path';
import { existsSync } from 'node:fs';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { DAY_MS, HISTORY_MAX_OFFSET, HISTORY_PAGE_SIZE, HISTORY_WINDOW_DAYS, historyDateLimits, parseUtcDate } from '../shared/history';
import type { ApiError, StatusResponse } from '../shared/types';
import type { AppConfig } from './config';
import { JiraApiError, type JiraErrorKind } from './jira/client';
import { log } from './logger';
import type { AlertStore } from './services/alertStore';
import { ActionRequestError, type ActionService, type AlertOperations } from './services/operations';

const ALERT_ID = /^[A-Za-z0-9._-]{1,128}$/;
const OTHER_ID = /^[A-Za-z0-9:._-]{1,128}$/;
const VERSION = /^[a-f0-9]{1,64}$/;
/** The only route that accepts a write. */
const ACTION_ROUTE = /^\/alerts\/[A-Za-z0-9._-]{1,128}\/actions$/;
/** Custom header that a page on another site cannot send without a CORS preflight, which is never granted. */
export const ACTION_HEADER = 'x-alert-center-action';

const STATUS_FOR_KIND: Record<JiraErrorKind, number> = {
  auth: 502,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  rate_limit: 503,
  server: 502,
  network: 502,
  schema: 502,
};

/**
 * HTTP API consumed by the frontend.
 *
 *   GET  /api/status                         mode, limits, extraction rules, sync state, write capabilities
 *   GET  /api/alerts                         alert list (?known=<version> &refresh=1)
 *   GET  /api/alerts/:id                     one alert with description and extra properties
 *   GET  /api/alerts/:id/notes               notes
 *   GET  /api/alerts/:id/logs                activity log
 *   GET  /api/alerts/:id/attachments         attachment list
 *   GET  /api/alerts/:id/attachments/:aid    temporary download link
 *   GET  /api/directory/me | users?query= | teams | schedules | teams/:teamId/escalations
 *   GET  /api/history                        one page of alerts within a UTC date window
 *   POST /api/alerts/:id/actions             one write action (only when enabled)
 *
 * Every other method and path is rejected. Writes additionally need a JSON
 * body and the ACTION_HEADER, and are refused from other origins.
 */
export function createApp(config: AppConfig, store: AlertStore, operations: AlertOperations, actions: ActionService) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      // The Vite dev server injects inline scripts; the strict policy applies to the production build.
      contentSecurityPolicy: config.isProduction
        ? { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } }
        : false,
    }),
  );
  app.use(compression());

  // The server listens on localhost. Checking the Host header stops a
  // malicious web page from reaching it through DNS rebinding.
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...config.allowedHosts.map((h) => h.toLowerCase())]);
  app.use((req, res, next) => {
    const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!allowedHosts.has(host)) {
      res.status(403).json({ error: 'Host not allowed. Add it to ALLOWED_HOSTS.' } satisfies ApiError);
      return;
    }
    next();
  });

  const api = express.Router();
  api.use((req, res, next) => {
    const read = req.method === 'GET' || req.method === 'HEAD';
    const write = req.method === 'POST' && ACTION_ROUTE.test(req.path);
    if (!read && !write) {
      res.setHeader('Allow', ACTION_ROUTE.test(req.path) ? 'POST' : 'GET, HEAD');
      res.status(405).json({ error: 'Method not allowed.' } satisfies ApiError);
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  api.get('/status', (_req, res) => {
    const body: StatusResponse = {
      mode: config.mode,
      readOnly: !actions.enabled,
      writes: { enabled: actions.enabled, actions: config.writeActions },
      site: config.jira?.siteHost ?? null,
      defaultRefreshSeconds: config.defaultRefreshSeconds,
      cacheTtlSeconds: config.cacheTtlSeconds,
      limits: {
        maxOpenAlerts: config.jira?.maxOpenAlerts ?? 0,
        maxClosedAlerts: config.jira?.maxClosedAlerts ?? 0,
        closedLookbackHours: config.jira?.closedLookbackHours ?? 0,
      },
      extraction: config.extraction,
      warnings: config.warnings,
      meta: store.meta(),
    };
    res.json(body);
  });

  api.get('/alerts', async (req, res) => {
    const known = typeof req.query.known === 'string' && VERSION.test(req.query.known) ? req.query.known : undefined;
    const force = req.query.refresh === '1';
    const body = await store.getAlerts({ force, knownVersion: known });
    if (body.meta.lastSyncAt === null && body.meta.error) {
      // Nothing cached yet and the first synchronisation failed.
      res.status(502).json({ error: body.meta.error } satisfies ApiError);
      return;
    }
    res.json(body);
  });

  api.get('/alerts/:id', async (req, res) => {
    const id = req.params.id;
    if (!ALERT_ID.test(id)) {
      res.status(400).json({ error: 'Invalid alert id.' } satisfies ApiError);
      return;
    }
    const detail = await store.getDetail(id);
    if (!detail) {
      res.status(404).json({ error: 'Alert not found. It may have been deleted in Jira.' } satisfies ApiError);
      return;
    }
    res.json(detail);
  });

  // ---- Notes, activity log, attachments ---------------------------------
  const alertId = (req: Request, res: Response): string | null => {
    const id = String(req.params.id);
    if (ALERT_ID.test(id)) return id;
    res.status(400).json({ error: 'Invalid alert id.' } satisfies ApiError);
    return null;
  };

  api.get('/alerts/:id/notes', async (req, res) => {
    const id = alertId(req, res);
    if (id) res.json(await operations.notes(id));
  });

  api.get('/alerts/:id/logs', async (req, res) => {
    const id = alertId(req, res);
    if (id) res.json(await operations.logs(id));
  });

  api.get('/alerts/:id/attachments', async (req, res) => {
    const id = alertId(req, res);
    if (id) res.json(await operations.attachments(id));
  });

  api.get('/alerts/:id/attachments/:attachmentId', async (req, res) => {
    const id = alertId(req, res);
    if (!id) return;
    const attachmentId = String(req.params.attachmentId);
    if (!OTHER_ID.test(attachmentId)) {
      res.status(400).json({ error: 'Invalid attachment id.' } satisfies ApiError);
      return;
    }
    const url = await operations.attachmentUrl(id, attachmentId);
    if (!url) {
      res.status(404).json({ error: 'No download available.' } satisfies ApiError);
      return;
    }
    res.json({ url });
  });

  // ---- Directory for the pickers ------------------------------------------
  api.get('/directory/me', async (_req, res) => {
    res.json(await operations.me());
  });

  api.get('/directory/users', async (req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (query.length < 2 || query.length > 100) {
      res.status(400).json({ error: 'Type at least two characters.' } satisfies ApiError);
      return;
    }
    res.json(await operations.searchUsers(query));
  });

  api.get('/directory/teams', async (_req, res) => {
    res.json(await operations.teams());
  });

  api.get('/directory/schedules', async (_req, res) => {
    res.json(await operations.schedules());
  });

  api.get('/directory/teams/:teamId/escalations', async (req, res) => {
    const teamId = String(req.params.teamId);
    if (!OTHER_ID.test(teamId)) {
      res.status(400).json({ error: 'Invalid team id.' } satisfies ApiError);
      return;
    }
    res.json(await operations.escalations(teamId));
  });

  // ---- Write actions ----------------------------------------------------
  const allowedOrigin = (origin: string): boolean => {
    try {
      const url = new URL(origin);
      return (url.protocol === 'http:' || url.protocol === 'https:') && allowedHosts.has(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  };

  api.post(
    '/alerts/:id/actions',
    (req, res, next) => {
      // Cross-site request forgery: a JSON body and a custom header force a
      // CORS preflight, which this server never answers with permission.
      // Origin and Sec-Fetch-Site are checked as a second line of defence.
      const origin = req.get('origin');
      const site = req.get('sec-fetch-site');
      if (req.get(ACTION_HEADER) !== '1' || (origin !== undefined && !allowedOrigin(origin)) || site === 'cross-site') {
        res.status(403).json({ error: 'Request refused.' } satisfies ApiError);
        return;
      }
      if (!req.is('application/json')) {
        res.status(415).json({ error: 'Send the action as JSON.' } satisfies ApiError);
        return;
      }
      next();
    },
    express.json({ limit: '128kb', strict: true }),
    async (req, res) => {
      const id = alertId(req, res);
      if (!id) return;
      res.json(await actions.run(id, req.body));
    },
  );

  api.get('/history', async (req, res) => {
    const from = parseUtcDate(req.query.from);
    const to = parseUtcDate(req.query.to);
    const { earliest, today } = historyDateLimits(Date.now());
    if (from === null || to === null || from > to || from < parseUtcDate(earliest)! || to > parseUtcDate(today)!) {
      res.status(400).json({ error: 'Choose valid dates within the past 12 months (UTC).' } satisfies ApiError);
      return;
    }
    const until = to + DAY_MS;
    if (until - from > HISTORY_WINDOW_DAYS * DAY_MS) {
      res.status(400).json({ error: `Each history window can contain at most ${HISTORY_WINDOW_DAYS} days.` } satisfies ApiError);
      return;
    }
    const rawOffset = req.query.offset ?? '0';
    const offset = typeof rawOffset === 'string' && /^\d+$/.test(rawOffset) ? Number(rawOffset) : NaN;
    if (offset > HISTORY_MAX_OFFSET || offset % HISTORY_PAGE_SIZE !== 0) {
      res.status(400).json({ error: 'Invalid history page.' } satisfies ApiError);
      return;
    }
    res.json(await store.getHistory({ from, until, offset }));
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'Unknown API endpoint.' } satisfies ApiError);
  });
  app.use('/api', api);

  // Production: serve the built frontend from the same origin.
  const dist = path.resolve('dist');
  if (config.isProduction && existsSync(path.join(dist, 'index.html'))) {
    app.use(
      express.static(dist, {
        index: 'index.html',
        setHeaders: (res, file) => {
          // Asset file names contain a content hash; the HTML that points to them must not be cached.
          res.setHeader('Cache-Control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
        },
      }),
    );
  }

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof JiraApiError) {
      res.status(STATUS_FOR_KIND[error.kind]).json({ error: error.publicMessage } satisfies ApiError);
      return;
    }
    if (error instanceof ActionRequestError) {
      res.status(error.status).json({ error: error.message } satisfies ApiError);
      return;
    }
    // Malformed or oversized JSON body (express.json).
    const status = typeof error === 'object' && error !== null && 'type' in error && 'status' in error ? error.status : null;
    if (typeof status === 'number') {
      if (status >= 400 && status < 500) {
        res.status(status).json({ error: status === 413 ? 'The request is too large.' : 'The request body is not valid JSON.' } satisfies ApiError);
        return;
      }
    }
    // Error name and route only: messages could carry upstream data.
    log.error('request failed', { route: req.route?.path ?? 'unknown', name: error instanceof Error ? error.name : 'unknown' });
    res.status(500).json({ error: 'Internal server error.' } satisfies ApiError);
  });

  return app;
}

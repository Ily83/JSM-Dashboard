import path from 'node:path';
import { existsSync } from 'node:fs';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { ApiError, StatusResponse } from '../shared/types';
import type { AppConfig } from './config';
import { JiraApiError } from './jira/client';
import { log } from './logger';
import type { AlertStore } from './services/alertStore';

const ALERT_ID = /^[A-Za-z0-9._-]{1,128}$/;
const VERSION = /^[a-f0-9]{1,64}$/;

/**
 * HTTP API consumed by the frontend. Read-only by construction: only GET
 * routes exist and every other method is rejected.
 *
 *   GET /api/status        mode, limits, extraction rules, sync state
 *   GET /api/alerts        alert list (?known=<version> &refresh=1)
 *   GET /api/alerts/:id    one alert with description and extra properties
 */
export function createApp(config: AppConfig, store: AlertStore) {
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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res.status(405).json({ error: 'This application is read-only.' } satisfies ApiError);
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  api.get('/status', (_req, res) => {
    const body: StatusResponse = {
      mode: config.mode,
      readOnly: true,
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
      const status = error.kind === 'rate_limit' ? 503 : 502;
      res.status(status).json({ error: error.publicMessage } satisfies ApiError);
      return;
    }
    // Error name and route only: messages could carry upstream data.
    log.error('request failed', { route: req.route?.path ?? 'unknown', name: error instanceof Error ? error.name : 'unknown' });
    res.status(500).json({ error: 'Internal server error.' } satisfies ApiError);
  });

  return app;
}

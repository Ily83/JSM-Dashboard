import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import {
  AUTH_MODE_KEY, CONFIG_FIELDS, DESKTOP_CONFIG_API, SETUP_PATH, SITE_URL_KEY,
  type ConfigFieldState, type DesktopConfigResponse, type DesktopConfigSaveResponse,
} from '../shared/desktopConfig';
import { ACTION_HEADER, frontendFiles, securityHeaders } from './app';
import { bodyErrorMessage, bodyErrorStatus } from './bodyErrors';
import { loadConfig, normaliseSiteUrl, type AppConfig } from './config';
import { EnvFileError, parseEnvText, readEnvText, updateEnvText, writeEnvText, type EnvValues } from './envFile';
import { log } from './logger';
import { createDashboard } from './runtime';

/**
 * The desktop app's server: the dashboard, plus a way for the app's own
 * window (and nothing else) to edit the configuration file and apply it
 * without a restart. Each saved change builds a fresh dashboard, so an OAuth
 * sign-in starts again.
 *
 * Only the settings in shared/desktopConfig.ts can be changed. Write actions,
 * the port and the OAuth callback stay a hand edit of the file.
 */

export const DESKTOP_HEADER = 'x-alert-center-desktop';
const API_TOKEN_KEY = 'JIRA_API_TOKEN';
const CLOUD_ID_KEY = 'JIRA_CLOUD_ID';
const MAX_VALUE_LENGTH = 2000;
const NEW_FILE_HEADER = '# Jira Operations – Alert Center configuration. Every setting is described in .env.example.\n';

export interface DesktopHostOptions {
  /** The configuration file the window may edit. It need not exist yet. */
  envFile: string;
  /** The computer's environment. Its values win over the file and cannot be changed from the window. */
  baseEnv: NodeJS.ProcessEnv;
  /** Folder of the built frontend. */
  distDir: string;
  /** Sent by the window with every request; no browser has it. */
  secret: string;
  openBrowser(url: string): Promise<void>;
  onSignedIn(): void;
  /** Listen on this port instead of the configured one (0: any free port). */
  port?: number;
}

export interface DesktopHost {
  /** The request listener for the app's HTTP server. */
  handler: Express;
  /** The port to listen on. */
  port: number;
  /** Tell the host which port the server got. */
  listening(port: number): void;
  /** The address the window opens; it changes with the sign-in method. */
  origin(): string;
  config(): AppConfig;
}

class SettingsError extends Error {}

interface Built {
  config: AppConfig;
  dashboard: RequestHandler;
  headers: RequestHandler;
  /** Origin of the OAuth callback, which the window must use in OAuth mode. */
  callbackOrigin: string | null;
  file: EnvValues;
}

const FIELDS = new Map(CONFIG_FIELDS.map((field) => [field.key, field]));
const siteOf = (raw: string | undefined) => (raw ? normaliseSiteUrl(raw)?.siteUrl ?? raw.trim().toLowerCase() : null);

export function createDesktopHost(options: DesktopHostOptions): DesktopHost {
  const base: EnvValues = {};
  for (const [key, value] of Object.entries(options.baseEnv)) {
    if (value !== undefined && value.trim() !== '') base[key] = value;
  }
  const secret = Buffer.from(options.secret);
  let actualPort: number | null = null;
  let current: Built;

  const origin = () => current.callbackOrigin ?? `http://localhost:${actualPort ?? current.config.port}`;
  const isWindow = (req: Request) => {
    const sent = Buffer.from(req.get(DESKTOP_HEADER) ?? '');
    return sent.length === secret.length && timingSafeEqual(sent, secret) && req.get('host') === new URL(origin()).host;
  };

  function build(file: EnvValues, configuredPort: number | null): Built {
    const config = loadConfig({ ...file, ...base });
    if (configuredPort !== null && config.port !== configuredPort) {
      throw new SettingsError('PORT changed in the configuration file. Restart Alert Center to apply it.');
    }
    config.host = '127.0.0.1';
    config.isProduction = true;
    config.distDir = options.distDir;
    config.allowedHosts = [];
    config.configEditor = true;
    const callback = config.oauth ? new URL(config.oauth.redirectUri) : null;
    if (callback && Number(callback.port || 80) !== config.port) {
      throw new SettingsError('The OAuth callback must use the same PORT as the desktop app.');
    }
    const dashboard = createDashboard(config, {
      isWindow, openBrowser: options.openBrowser, onSignedIn: options.onSignedIn, settingsPath: SETUP_PATH,
    });
    return { config, dashboard, headers: securityHeaders(config), callbackOrigin: callback?.origin ?? null, file };
  }

  current = build(parseEnvText(readEnvText(options.envFile)), null);
  const configuredPort = current.config.port;

  function describe(): DesktopConfigResponse {
    const fields: ConfigFieldState[] = CONFIG_FIELDS.map((field) => {
      const locked = base[field.key] !== undefined;
      const value = locked ? base[field.key] : current.file[field.key];
      const set = value !== undefined && value.trim() !== '';
      return { key: field.key, value: field.kind === 'secret' || !set ? null : value, set, locked };
    });
    const { config } = current;
    return {
      file: path.resolve(options.envFile),
      editable: true,
      mode: config.mode,
      oauth: Boolean(config.oauth),
      callbackUrl: config.oauth?.redirectUri ?? base.JIRA_OAUTH_REDIRECT_URI ?? current.file.JIRA_OAUTH_REDIRECT_URI ?? `http://localhost:${config.port}/api/auth/callback`,
      fields,
      warnings: config.warnings,
    };
  }

  /** One requested value as it goes into the file: null removes the setting. Values are never echoed in an error. */
  function requestedValue(key: string, raw: unknown): string | null {
    const field = FIELDS.get(key);
    if (!field) throw new SettingsError('This setting cannot be changed here.');
    if (base[key] !== undefined) throw new SettingsError(`${field.label} is set by the computer's environment and cannot be changed here.`);
    if (raw === null) return null;
    if (typeof raw !== 'string' || raw.length > MAX_VALUE_LENGTH || /[\r\n\0]/.test(raw)) throw new SettingsError(`${field.label} is not valid.`);
    return raw.trim() === '' ? null : raw.trim();
  }

  /** The changes to make to the file, validated. */
  function requestedChanges(body: unknown): Record<string, string | null> {
    const values = typeof body === 'object' && body !== null && 'values' in body ? body.values : null;
    if (typeof values !== 'object' || values === null || Array.isArray(values)) throw new SettingsError('The request is not valid.');
    const changes: Record<string, string | null> = {};
    for (const [key, raw] of Object.entries(values)) changes[key] = requestedValue(key, raw);
    if (Object.keys(changes).length === 0) throw new SettingsError('Nothing to save.');
    return changes;
  }

  /**
   * A saved API token belongs to the site it was saved with: it is sent there
   * on every request. When the site changes, the token must be entered again
   * (or is dropped when OAuth is used), and the old site's cloud ID is removed.
   */
  function bindSecretsToSite(changes: Record<string, string | null>): void {
    if (!(SITE_URL_KEY in changes) || siteOf(changes[SITE_URL_KEY] ?? undefined) === siteOf(current.file[SITE_URL_KEY])) return;
    if (current.file[CLOUD_ID_KEY] !== undefined) changes[CLOUD_ID_KEY] = null;
    if (typeof changes[API_TOKEN_KEY] === 'string') return;
    const mode = AUTH_MODE_KEY in changes ? changes[AUTH_MODE_KEY] : base[AUTH_MODE_KEY] ?? current.file[AUTH_MODE_KEY];
    if (mode === 'oauth') {
      if (current.file[API_TOKEN_KEY] !== undefined) changes[API_TOKEN_KEY] = null;
      return;
    }
    if (base[API_TOKEN_KEY] !== undefined) throw new SettingsError('The API token is set by the computer\'s environment. Change the Jira site there too.');
    if (current.file[API_TOKEN_KEY] !== undefined) throw new SettingsError('Enter the API token again to change the Jira site.');
  }

  function save(body: unknown): DesktopConfigSaveResponse {
    const changes = requestedChanges(body);
    bindSecretsToSite(changes);
    const text = readEnvText(options.envFile);
    const nextText = updateEnvText(text === '' ? NEW_FILE_HEADER : text, changes);
    let next: Built;
    try {
      next = build(parseEnvText(nextText), configuredPort);
    } catch (error) {
      // Messages name settings, never their values.
      throw new SettingsError(error instanceof Error ? error.message : 'These settings are not valid.');
    }
    writeEnvText(options.envFile, nextText);
    current = next;
    log.info('configuration file updated from the desktop window', { settings: Object.keys(changes).join(','), mode: next.config.mode });
    return { ...describe(), origin: origin() };
  }

  const outer = express();
  outer.disable('x-powered-by');
  const windowOnly: RequestHandler = (req, res, next) => {
    if (isWindow(req)) next();
    else res.sendStatus(403);
  };
  const headers: RequestHandler = (req, res, next) => current.headers(req, res, next);

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.get('/', (_req, res) => {
    res.json(describe());
  });
  api.post(
    '/',
    (req, res, next) => {
      // The same rules as the dashboard's write routes, and the request must come from the window's own page.
      if (req.get(ACTION_HEADER) !== '1' || req.get('origin') !== origin() || req.get('sec-fetch-site') === 'cross-site' || !req.is('application/json')) {
        res.status(403).json({ error: 'This request is not allowed.' });
        return;
      }
      next();
    },
    express.json({ limit: '32kb', strict: true }),
    (req, res) => {
      try {
        res.json(save(req.body));
      } catch (error) {
        if (error instanceof SettingsError) res.status(400).json({ error: error.message });
        else if (error instanceof EnvFileError) res.status(error.io ? 500 : 400).json({ error: error.message });
        else throw error;
      }
    },
  );
  api.use((_req, res) => {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed.' });
  });
  outer.use(DESKTOP_CONFIG_API, windowOnly, headers, api);

  // The configuration page and its files, also while signed out: the dashboard
  // behind an OAuth sign-in serves nothing then.
  const files = frontendFiles(options.distDir, false);
  outer.get(SETUP_PATH, windowOnly, headers, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root: options.distDir });
  });
  outer.use((req, res, next) => {
    const asset = req.method === 'GET' && (req.path.startsWith('/assets/') || req.path === '/theme-init.js' || req.path === '/favicon.svg');
    if (!asset || !isWindow(req)) next();
    else headers(req, res, () => files(req, res, next));
  });
  outer.use((req, res, next) => current.dashboard(req, res, next));
  outer.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status = bodyErrorStatus(error);
    if (status !== null) {
      res.status(status).json({ error: bodyErrorMessage(status) });
      return;
    }
    // Error name only: messages could carry configuration values.
    log.error('desktop request failed', { name: error instanceof Error ? error.name : 'unknown' });
    res.status(500).json({ error: 'Internal server error.' });
  });

  return {
    handler: outer,
    port: options.port ?? configuredPort,
    listening(port) { actualPort = port; },
    origin,
    config: () => current.config,
  };
}

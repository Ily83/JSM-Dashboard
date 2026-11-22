import { z } from 'zod';
import { ACTION_IDS, type ActionId } from '../shared/actions';
import type { ExtractionRules } from '../shared/types';

/**
 * All configuration comes from environment variables (optionally a local
 * .env file). Credentials are read here and nowhere else, and are only ever
 * handed to the Jira client.
 */

function localEnv(): NodeJS.ProcessEnv {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile('.env');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not read .env.');
    }
  } else {
    console.error('This Node.js version cannot read .env files. Use Node.js 20.12 or newer.');
  }
  return process.env;
}

const text = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const bool = (fallback: boolean) =>
  text.transform((v) => (v === undefined ? fallback : /^(1|true|yes|on)$/i.test(v)));

const int = (fallback: number, min: number, max: number) =>
  text.transform((v, ctx) => {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: 'custom', message: `must be an integer between ${min} and ${max}` });
      return z.NEVER;
    }
    return n;
  });

const list = (fallback: string[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined
        ? fallback
        : v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );

const EnvSchema = z.object({
  NODE_ENV: text,
  HOST: text,
  PORT: int(8787, 1, 65535),
  ALLOWED_HOSTS: list([]),
  LOG_LEVEL: text.pipe(z.enum(['debug', 'info', 'warn', 'error']).optional()),

  DEMO_MODE: text,
  DEMO_ALERT_COUNT: int(0, 0, 50_000),

  JIRA_SITE_URL: text,
  JIRA_AUTH_MODE: text.pipe(z.enum(['basic', 'oauth']).optional()),
  JIRA_OAUTH_CLIENT_ID: text,
  JIRA_OAUTH_CLIENT_SECRET: text,
  JIRA_OAUTH_REDIRECT_URI: text,
  JIRA_CLOUD_ID: text,
  JIRA_EMAIL: text,
  JIRA_API_TOKEN: text,
  JIRA_ALERT_QUERY: text,
  JIRA_OPEN_QUERY: text,
  JIRA_CLOSED_QUERY: text,
  JIRA_ALERT_URL_TEMPLATE: text,
  JIRA_MAX_ALERTS: int(2000, 1, 19_900),
  JIRA_MAX_CLOSED_ALERTS: int(500, 0, 19_900),
  JIRA_CLOSED_LOOKBACK_HOURS: int(72, 0, 24 * 90),
  JIRA_CACHE_TTL_SECONDS: int(30, 5, 3600),
  JIRA_FULL_SYNC_MINUTES: int(15, 1, 24 * 60),
  JIRA_REQUEST_TIMEOUT_MS: int(15_000, 1000, 120_000),
  JIRA_ENRICH_DETAILS: text.pipe(z.enum(['auto', 'always', 'never']).optional()),
  JIRA_ENRICH_MAX_PER_SYNC: int(50, 0, 1000),
  JIRA_WRITE_ACTIONS: text,

  REFRESH_INTERVAL_SECONDS: int(60, 10, 3600),

  CUSTOMER_TAG_PREFIXES: list(['customer:', 'customer=', 'cust:']),
  CUSTOMER_COMPANY_TAG_PREFIXES: list([]),
  CUSTOMER_PROPERTY_KEYS: list(['customer', 'customers']),
  SERVICE_TAG_PREFIXES: list(['service:', 'service=']),
  SERVICE_PROPERTY_KEYS: list(['service']),
  SERVICE_FALLBACK_TO_ENTITY: bool(true),
  CUSTOMER_MAP_FILE: text,
});

export interface JiraConfig {
  siteUrl: string;
  siteHost: string;
  cloudId: string | null;
  email: string;
  apiToken: string;
  /** Optional restriction applied to every request. */
  alertQuery: string | null;
  /** Search query selecting the alerts that are still being worked on. */
  openQuery: string;
  /** Search query selecting finished alerts; combined with the lookback window. */
  closedQuery: string;
  alertUrlTemplate: string;
  maxOpenAlerts: number;
  maxClosedAlerts: number;
  closedLookbackHours: number;
  fullSyncMinutes: number;
  requestTimeoutMs: number;
  enrichDetails: 'auto' | 'always' | 'never';
  enrichMaxPerSync: number;
  /** Write actions allowed against Jira. Empty means read-only (the default). */
  writeActions: ActionId[];
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AppConfig {
  distDir?: string;
  oauth?: OAuthConfig;
  isProduction: boolean;
  host: string;
  port: number;
  allowedHosts: string[];
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  mode: 'demo' | 'live';
  demoAlertCount: number;
  /** Present only in live mode. */
  jira: JiraConfig | null;
  /** Write actions the API accepts: JIRA_WRITE_ACTIONS in live mode, all of them on demo data. */
  writeActions: ActionId[];
  cacheTtlSeconds: number;
  defaultRefreshSeconds: number;
  extraction: ExtractionRules;
  /** Path of the optional entity -> customer mapping file (loaded and validated at start-up). */
  customerMapFile: string | null;
  /** Rules loaded from that file; set at start-up, shown in Settings. */
  customerMapRules?: number;
  /** Non-fatal configuration problems, shown in Settings. Never contain secrets. */
  warnings: string[];
}

/**
 * JIRA_WRITE_ACTIONS: empty, "false", "off" or "none" = read-only (default);
 * "true", "on" or "all" = every action; otherwise a comma-separated list of
 * action ids, e.g. "acknowledge,unacknowledge,addNote".
 */
export function parseWriteActions(raw: string | undefined): { actions: ActionId[]; unknown: string[] } {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || /^(0|false|no|off|none)$/.test(value)) return { actions: [], unknown: [] };
  if (/^(1|true|yes|on|all)$/.test(value)) return { actions: [...ACTION_IDS], unknown: [] };
  const byLower = new Map(ACTION_IDS.map((id) => [id.toLowerCase(), id]));
  const actions = new Set<ActionId>();
  const unknown: string[] = [];
  for (const part of value.split(',').map((p) => p.trim()).filter(Boolean)) {
    const id = byLower.get(part);
    if (id) actions.add(id);
    else unknown.push(part);
  }
  return { actions: ACTION_IDS.filter((id) => actions.has(id)), unknown };
}

function normaliseSiteUrl(raw: string): { siteUrl: string; siteHost: string } | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'https:') return null;
    return { siteUrl: url.origin, siteHost: url.host };
  } catch {
    return null;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = localEnv()): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    // Only variable names and messages are printed, never values.
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  const e = parsed.data;
  const warnings: string[] = [];

  const demoForced = e.DEMO_MODE !== undefined && /^(1|true|yes|on)$/i.test(e.DEMO_MODE);
  const provided = {
    JIRA_SITE_URL: e.JIRA_SITE_URL,
    JIRA_EMAIL: e.JIRA_EMAIL,
    JIRA_API_TOKEN: e.JIRA_API_TOKEN,
  };
  const missing = Object.entries(provided)
    .filter(([, v]) => v === undefined)
    .map(([k]) => k);

  const writes = parseWriteActions(e.JIRA_WRITE_ACTIONS);
  if (writes.unknown.length > 0) {
    // The names come from the variable itself, not from a secret.
    warnings.push(`JIRA_WRITE_ACTIONS contains unknown actions (${writes.unknown.join(', ')}). They are ignored.`);
  }

  let jira: JiraConfig | null = null;
  let oauth: OAuthConfig | undefined;
  if (!demoForced && e.JIRA_AUTH_MODE === 'oauth') {
    if (!e.JIRA_SITE_URL || !normaliseSiteUrl(e.JIRA_SITE_URL) || !e.JIRA_OAUTH_CLIENT_ID || !e.JIRA_OAUTH_CLIENT_SECRET)
      throw new Error('OAuth requires JIRA_SITE_URL, JIRA_OAUTH_CLIENT_ID and JIRA_OAUTH_CLIENT_SECRET.');
    if (e.HOST && !['localhost', '127.0.0.1'].includes(e.HOST)) throw new Error('OAuth mode requires a loopback HOST.');
    const redirectUri = e.JIRA_OAUTH_REDIRECT_URI ?? `http://localhost:${e.PORT}/api/auth/callback`;
    if (!/^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}\/api\/auth\/callback$/.test(redirectUri) || !URL.canParse(redirectUri))
      throw new Error('JIRA_OAUTH_REDIRECT_URI must be a local HTTP callback with an explicit port and path /api/auth/callback.');
    oauth = { clientId: e.JIRA_OAUTH_CLIENT_ID, clientSecret: e.JIRA_OAUTH_CLIENT_SECRET, redirectUri };
  }
  if (!demoForced && (oauth || missing.length === 0)) {
    const site = normaliseSiteUrl(e.JIRA_SITE_URL!);
    if (site) {
      jira = {
        ...site,
        cloudId: e.JIRA_CLOUD_ID ?? null,
        email: oauth ? '' : e.JIRA_EMAIL!,
        apiToken: oauth ? '' : e.JIRA_API_TOKEN!,
        alertQuery: e.JIRA_ALERT_QUERY ?? null,
        openQuery: e.JIRA_OPEN_QUERY ?? 'status: open',
        closedQuery: e.JIRA_CLOSED_QUERY ?? 'NOT status: open',
        alertUrlTemplate: e.JIRA_ALERT_URL_TEMPLATE ?? '{siteUrl}/jira/ops/alerts/{id}',
        maxOpenAlerts: e.JIRA_MAX_ALERTS,
        maxClosedAlerts: e.JIRA_MAX_CLOSED_ALERTS,
        closedLookbackHours: e.JIRA_CLOSED_LOOKBACK_HOURS,
        fullSyncMinutes: e.JIRA_FULL_SYNC_MINUTES,
        requestTimeoutMs: e.JIRA_REQUEST_TIMEOUT_MS,
        enrichDetails: e.JIRA_ENRICH_DETAILS ?? 'auto',
        enrichMaxPerSync: e.JIRA_ENRICH_MAX_PER_SYNC,
        writeActions: writes.actions,
      };
    } else {
      warnings.push('JIRA_SITE_URL is not a valid https URL. Running in demo mode.');
    }
  } else if (!demoForced && missing.length < 3) {
    warnings.push(
      `Jira configuration is incomplete (missing ${missing.join(', ')}). Running in demo mode.`,
    );
  }

  return {
    oauth,
    // `npm start` passes --production, which works the same in every shell and operating system.
    isProduction: e.NODE_ENV === 'production' || process.argv.includes('--production'),
    host: e.HOST ?? '127.0.0.1',
    port: e.PORT,
    allowedHosts: e.ALLOWED_HOSTS,
    logLevel: e.LOG_LEVEL ?? 'info',
    mode: jira ? 'live' : 'demo',
    demoAlertCount: e.DEMO_ALERT_COUNT,
    jira,
    // Demo data lives in memory only, so every action can be tried there.
    writeActions: jira ? jira.writeActions : [...ACTION_IDS],
    cacheTtlSeconds: e.JIRA_CACHE_TTL_SECONDS,
    defaultRefreshSeconds: e.REFRESH_INTERVAL_SECONDS,
    extraction: {
      customerTagPrefixes: e.CUSTOMER_TAG_PREFIXES,
      customerCompanyTagPrefixes: e.CUSTOMER_COMPANY_TAG_PREFIXES,
      customerPropertyKeys: e.CUSTOMER_PROPERTY_KEYS,
      serviceTagPrefixes: e.SERVICE_TAG_PREFIXES,
      servicePropertyKeys: e.SERVICE_PROPERTY_KEYS,
      serviceFallbackToEntity: e.SERVICE_FALLBACK_TO_ENTITY,
    },
    customerMapFile: e.CUSTOMER_MAP_FILE ?? null,
    warnings,
  };
}

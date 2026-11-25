import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Where the OAuth live tests find the signed-in Alert Center and the saved
 * sign-in. Shared by playwright.config.ts, e2e/live/oauth.spec.ts and
 * scripts/e2e-live-login.ts.
 *
 * The saved file is a Playwright storageState holding only the instance's
 * session cookie. It is a live sign-in: git-ignored, mode 0600, never
 * printed, and to be deleted after the run.
 */

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SESSION_FILE = path.join(ROOT, 'e2e', '.auth', 'oauth-session.json');
/** As shown in messages: relative to the repository. */
export const SESSION_FILE_LABEL = 'e2e/.auth/oauth-session.json';
/** Session lifetime set by server/oauth.ts (README: "session expiry after eight hours"). */
export const SESSION_TTL_MS = 8 * 60 * 60_000;

type Env = Record<string, string | undefined>;

/**
 * process.env over the values in .env, read with the parser that
 * process.loadEnvFile uses, without changing process.env (which the
 * test servers and workers inherit).
 */
export function localEnv(): Env {
  const file = path.join(ROOT, '.env');
  const values = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  return { ...values, ...process.env };
}

const set = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

/**
 * The signed-in instance: E2E_LIVE_URL, else the origin of
 * JIRA_OAUTH_REDIRECT_URI, else the server's default callback origin.
 * It must be exactly the address the OAuth app was registered with: the
 * backend refuses any other Host.
 */
export function liveUrl(env: Env): string {
  const raw = set(env.E2E_LIVE_URL) ?? set(env.JIRA_OAUTH_REDIRECT_URI) ?? `http://localhost:${set(env.PORT) ?? '8787'}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('E2E_LIVE_URL (or JIRA_OAUTH_REDIRECT_URI) is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('E2E_LIVE_URL must be an http(s) address.');
  return url.origin;
}

/** The backend names its session cookie after the callback port (server/oauth.ts). */
export function sessionCookieName(origin: string): string {
  return `jsm_${new URL(origin).port}_session`;
}

interface SavedState {
  cookies: Array<{ name: string; domain: string; expires: number }>;
}

/**
 * Minutes since the saved sign-in, from the session cookie's expiry (set to
 * sign-in time + 8 h by the backend). Null when the file has no such cookie.
 * Reads names and times only, never the cookie value.
 */
export function sessionAgeMinutes(origin: string, now = Date.now()): number | null {
  if (!existsSync(SESSION_FILE)) return null;
  let state: SavedState;
  try {
    state = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as SavedState;
  } catch {
    return null;
  }
  const name = sessionCookieName(origin);
  const cookie = state.cookies?.find((c) => c.name === name);
  if (!cookie || !(cookie.expires > 0)) return null;
  return Math.floor((now - (cookie.expires * 1000 - SESSION_TTL_MS)) / 60_000);
}

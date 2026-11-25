import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, request, type Browser } from '@playwright/test';
import type { StatusResponse } from '../shared/types';
import { ROOT, SESSION_FILE, SESSION_FILE_LABEL, liveUrl, sessionCookieName } from '../e2e/live/oauthSession';

/**
 * npm run e2e:live:login
 *
 * Signs in to a running Alert Center in OAuth mode (JIRA_AUTH_MODE=oauth)
 * in a visible Chromium window and saves that sign-in for
 * `npm run e2e:live:oauth`. The instance is E2E_LIVE_URL, else the origin of
 * JIRA_OAUTH_REDIRECT_URI in .env.
 *
 * Only the instance's own session cookie is saved (no Atlassian cookies), to
 * e2e/.auth/oauth-session.json with mode 0600. Nothing secret is printed.
 * The backend keeps one session: signing in here signs out any other browser.
 */

const WAIT_MS = 10 * 60_000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Ends the run with a message once the browser is open, so it is closed first. */
class Stop extends Error {}

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('Could not read .env.');
}

let base = '';
try {
  base = liveUrl(process.env);
} catch (error) {
  fail((error as Error).message);
}

// Is an OAuth instance answering at that address?
const probe = await request.newContext();
try {
  const answer = await probe.get(`${base}/api/status`, { maxRedirects: 0, failOnStatusCode: false, timeout: 10_000 }).catch(() => null);
  if (!answer) fail(`No Alert Center answers at ${base}. Start it first (npm run build, then npm start, with JIRA_AUTH_MODE=oauth), or set E2E_LIVE_URL to its address.`);
  if (answer.status() === 403) fail(`${base} refused the request: ${(await answer.text()).slice(0, 200)}\nSet E2E_LIVE_URL to the address in JIRA_OAUTH_REDIRECT_URI.`);
  if (answer.status() === 200) {
    const status = (await answer.json().catch(() => null)) as StatusResponse | null;
    if (!status?.oauth) fail(`${base} does not sign in with Atlassian (JIRA_AUTH_MODE=oauth is not set there). Nothing to save.`);
  } else if (answer.status() !== 401 || !answer.headers()['x-alert-center-login']) {
    fail(`Unexpected answer from ${base}/api/status: HTTP ${answer.status()}.`);
  }
} finally {
  await probe.dispose();
}

let browser: Browser;
try {
  browser = await chromium.launch({ headless: false });
} catch {
  fail('Could not start Chromium. Install it once with: npx playwright install chromium');
}
let closed = false;
browser.on('disconnected', () => {
  closed = true;
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/api/auth/login`);
  console.log(`A browser window opened at ${base}/api/auth/login.`);
  console.log('Select "Sign in with Atlassian", sign in, and grant access to the TEST site. This replaces any other sign-in on that instance.');
  console.log('Waiting up to 10 minutes; the window closes by itself when the sign-in is complete.');

  let signedIn = false;
  const deadline = Date.now() + WAIT_MS;
  while (!closed && Date.now() < deadline) {
    // Shares the window's cookies, so this answers 200 once the sign-in completed.
    const answer = await context.request.get(`${base}/api/status`, { maxRedirects: 0, failOnStatusCode: false, timeout: 10_000 }).catch(() => null);
    if (answer?.status() === 200) {
      const status = (await answer.json().catch(() => null)) as StatusResponse | null;
      if (status?.oauth && status.mode === 'live') {
        signedIn = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!signedIn) throw new Stop(closed ? 'The browser was closed before the sign-in completed. Nothing was saved.' : 'No sign-in within 10 minutes. Nothing was saved.');

  // Only the instance's session cookie: Atlassian's own sign-in cookies stay out of the file.
  const name = sessionCookieName(base);
  const { hostname } = new URL(base);
  const cookies = (await context.storageState()).cookies.filter((c) => c.name === name && c.domain.replace(/^\./, '') === hostname);
  if (cookies.length !== 1) throw new Stop(`Signed in, but the session cookie ${name} for ${hostname} was not found. Nothing was saved.`);

  const dir = path.dirname(SESSION_FILE);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const temporary = `${SESSION_FILE}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    renameSync(temporary, SESSION_FILE);
  } catch {
    rmSync(temporary, { force: true });
    throw new Stop(`Could not write ${SESSION_FILE_LABEL}.`);
  }
  console.log(`Saved the sign-in for ${base} to ${SESSION_FILE_LABEL} (readable by you only).`);
  console.log('It is a live session for that instance: keep it private, and delete it after the run:');
  console.log(`  rm ${SESSION_FILE_LABEL}`);
  console.log('Run the checks with: npm run e2e:live:oauth');
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => undefined);
}

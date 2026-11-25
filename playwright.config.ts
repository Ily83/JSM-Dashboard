import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { SESSION_FILE, liveUrl, localEnv } from './e2e/live/oauthSession';

/**
 * End-to-end tests in a real browser.
 *
 *   npm run e2e               demo mode: safe anywhere, no Jira needed
 *   npm run e2e:live          API-token round trip against the Jira site in .env (a TEST
 *                             site only): starts its own backend, creates, changes and
 *                             closes its own tagged alerts
 *   npm run e2e:live:login    signs in to a running OAuth instance in a visible browser
 *                             and saves that sign-in for the next command
 *   npm run e2e:live:oauth    OAuth checks against that signed-in instance; changes only
 *                             one open alert tagged alert-center-e2e
 *
 * First time on a computer: npx playwright install chromium
 */

// Requested projects (`--project=x` or `--project x`, repeatable). None means all.
const projects = process.argv.flatMap((arg, i, all) =>
  arg.startsWith('--project=') ? [arg.slice('--project='.length)] : arg === '--project' && all[i + 1] ? [all[i + 1]] : [],
);
const wants = (name: string) => projects.length === 0 || projects.includes(name);
// The API-token backend is started only when the live project is asked for
// (`--project=live`, as `npm run e2e:live` does): it needs the Jira values in .env.
const live = process.env.E2E_LIVE === '1' || projects.includes('live');
// Ports can be moved (E2E_DEMO_PORT, E2E_LIVE_PORT) to run several copies side by side.
const DEMO_PORT = Number(process.env.E2E_DEMO_PORT ?? 8790);
const LIVE_PORT = Number(process.env.E2E_LIVE_PORT ?? 8791);
// OAuth sessions exist only in the memory of the server the operator signed in to,
// so the live-oauth project never starts a server: it uses that instance and the
// sign-in saved by `npm run e2e:live:login`.
let OAUTH_URL: string | undefined;
try {
  OAUTH_URL = liveUrl(localEnv());
} catch {
  // oauth.spec.ts reports the problem; the other projects still run.
}
const oauthSession = existsSync(SESSION_FILE) ? { storageState: SESSION_FILE } : {};

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One browser at a time: the tests share one backend whose data they change.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    viewport: { width: 1600, height: 950 },
    permissions: ['notifications', 'clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'demo', testDir: 'e2e/demo', use: { baseURL: `http://127.0.0.1:${DEMO_PORT}` } },
    { name: 'live', testDir: 'e2e/live', testMatch: 'roundtrip.spec.ts', use: { baseURL: `http://127.0.0.1:${LIVE_PORT}` } },
    // Traces would hold the session cookie, so none are kept for this project.
    { name: 'live-oauth', testDir: 'e2e/live', testMatch: 'oauth.spec.ts', use: { baseURL: OAUTH_URL, ...oauthSession, trace: 'off' } },
  ],
  // The production build is served by the backend; `npm run e2e` builds it first.
  webServer: [
    ...(wants('demo')
      ? [
          {
            command: 'npx tsx server/index.ts --production',
            url: `http://127.0.0.1:${DEMO_PORT}/readyz`,
            env: { DEMO_MODE: 'true', DEMO_ALERT_COUNT: '300', PORT: String(DEMO_PORT), LOG_LEVEL: 'warn' },
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ]
      : []),
    ...(live
      ? [
          {
            command: 'npx tsx server/index.ts --production',
            // Ready once the first synchronisation with Jira succeeded.
            url: `http://127.0.0.1:${LIVE_PORT}/readyz`,
            // API-token mode even when .env selects OAuth: a server started here can never be signed in.
            env: { PORT: String(LIVE_PORT), JIRA_AUTH_MODE: 'basic', JIRA_WRITE_ACTIONS: 'true', JIRA_CACHE_TTL_SECONDS: '5', LOG_LEVEL: 'warn' },
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});

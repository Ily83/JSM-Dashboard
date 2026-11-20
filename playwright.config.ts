import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests in a real browser.
 *
 *   npm run e2e         demo mode: safe anywhere, no Jira needed
 *   npm run e2e:live    against the Jira site in .env (a TEST site only): creates,
 *                       changes and closes its own tagged alerts
 *
 * First time on a computer: npx playwright install chromium
 */

// The live backend is started only when the live project is asked for
// (`--project=live`, as `npm run e2e:live` does): it needs the Jira values in .env.
const live = process.env.E2E_LIVE === '1' || process.argv.some((arg, i, all) => arg === '--project=live' || (arg === '--project' && all[i + 1] === 'live'));
// Ports can be moved (E2E_DEMO_PORT, E2E_LIVE_PORT) to run several copies side by side.
const DEMO_PORT = Number(process.env.E2E_DEMO_PORT ?? 8790);
const LIVE_PORT = Number(process.env.E2E_LIVE_PORT ?? 8791);

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
    { name: 'live', testDir: 'e2e/live', use: { baseURL: `http://127.0.0.1:${LIVE_PORT}` } },
  ],
  // The production build is served by the backend; `npm run e2e` builds it first.
  webServer: [
    {
      command: 'npx tsx server/index.ts --production',
      url: `http://127.0.0.1:${DEMO_PORT}/readyz`,
      env: { DEMO_MODE: 'true', DEMO_ALERT_COUNT: '300', PORT: String(DEMO_PORT), LOG_LEVEL: 'warn' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    ...(live
      ? [
          {
            command: 'npx tsx server/index.ts --production',
            // Ready once the first synchronisation with Jira succeeded.
            url: `http://127.0.0.1:${LIVE_PORT}/readyz`,
            env: { PORT: String(LIVE_PORT), JIRA_WRITE_ACTIONS: 'true', JIRA_CACHE_TTL_SECONDS: '5', LOG_LEVEL: 'warn' },
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});

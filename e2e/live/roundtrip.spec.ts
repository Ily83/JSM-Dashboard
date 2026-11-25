import type { Page } from '@playwright/test';
import { loadConfig } from '../../server/config';
import { JiraClient } from '../../server/jira/client';
import { alarms, expect, panel, recordAlarms, test } from '../fixtures';
import { localEnv } from './oauthSession';

/**
 * Round trip with a real Jira Service Management site (a TEST site):
 * an alert created in Jira reaches the app, actions taken in the app reach
 * Jira, and a change made in Jira reaches the app. Everything this test
 * creates carries TAG and is closed at the end.
 */

const TAG = 'alert-center-e2e';
const run = Date.now().toString(36);
const summary = `E2E ${run}: storage latency above 200 ms`;
// API-token mode, like the backend playwright.config.ts starts for this project,
// even when .env selects OAuth for the operator's own instance.
const jira = loadConfig({ ...localEnv(), JIRA_AUTH_MODE: 'basic' }).jira;
const client = jira ? new JiraClient(jira, 2) : null;

/** Asks the backend for fresh data until the check passes (the backend caches for 5 s). */
async function refreshUntil(page: Page, check: () => Promise<boolean>, timeout = 60_000): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.getByRole('button', { name: 'Refresh now' }).click();
        await page.waitForTimeout(1500);
        return check();
      },
      { timeout, intervals: [2000] },
    )
    .toBe(true);
}

test.describe.serial('live round trip', () => {
  test.beforeAll(() => {
    if (client) return;
    const reason = 'needs JIRA_SITE_URL, JIRA_EMAIL and JIRA_API_TOKEN in .env (this round trip uses the API token; for OAuth run npm run e2e:live:oauth)';
    // The list reporter hides skip reasons.
    console.log(`live skipped: ${reason}`);
    test.skip(true, reason);
  });
  let alertId = '';

  test.afterAll(async () => {
    if (!client) return;
    const page = await client.listAlerts({ query: `tag: ${TAG} AND status: open`, offset: 0, size: 100 });
    for (const alert of page.alerts) await client.performAction(alert.id, { action: 'close' }).catch(() => undefined);
  });

  test('a P1 created in Jira appears in the app and rings the P1 alarm', async ({ page }) => {
    await recordAlarms(page);
    await page.goto('/#/active');
    await expect(page.locator('.at-row').first()).toBeVisible();
    await page.getByRole('button', { name: 'P1 alarm' }).click();
    await page.waitForTimeout(1000);

    const created = await client!.createAlert({
      message: summary,
      alias: `${TAG}-${run}`,
      priority: 'P1',
      entity: 'st-e2e-01',
      source: 'Alert Center e2e',
      tags: [TAG, 'customer:E2E Test Co'],
      extraProperties: { service: 'Storage', runbook: 'https://wiki.example.com/runbooks/storage-latency' },
      actions: ['Run diagnostics'],
    });
    expect(created.alertId, 'Jira confirmed the new alert').toBeTruthy();
    alertId = created.alertId!;

    await refreshUntil(page, async () => (await page.locator('.at-row', { hasText: summary }).count()) > 0);
    await expect.poll(async () => (await alarms(page)).titles.some((t) => t.startsWith('P1'))).toBe(true);
    await expect(page.locator('.at-row', { hasText: summary })).toContainText('E2E Test Co');
  });

  test('acknowledge, note and tag from the app arrive in Jira', async ({ page }) => {
    await page.goto(`/#/active?alert=${encodeURIComponent(alertId)}`);
    const p = panel(page);
    await expect(p.locator('h2')).toHaveText(summary);

    await p.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(p.getByRole('status')).toContainText(/acknowledged/i, { timeout: 30_000 });
    expect((await client!.getAlert(alertId)).acknowledged).toBe(true);

    const note = `Note from the e2e run ${run}`;
    await p.getByRole('textbox', { name: 'New note' }).fill(note);
    await p.getByRole('button', { name: 'Add note' }).click();
    await expect(p.locator('li', { hasText: note })).toBeVisible({ timeout: 30_000 });
    expect((await client!.listNotes(alertId)).values.map((n) => n.note)).toContain(note);

    await p.getByRole('button', { name: 'Add tags' }).click();
    await p.getByRole('textbox', { name: /New tags/ }).fill('e2e-tag');
    await p.getByRole('textbox', { name: /New tags/ }).press('Enter');
    await expect(p.getByRole('button', { name: 'Remove tag e2e-tag' })).toBeVisible({ timeout: 30_000 });
    expect((await client!.getAlert(alertId)).tags).toContain('e2e-tag');
  });

  test('a custom action gets an answer from Jira', async ({ page }) => {
    await page.goto(`/#/active?alert=${encodeURIComponent(alertId)}`);
    const p = panel(page);
    await expect(p.getByRole('link', { name: 'Open runbook' })).toBeVisible();
    await p.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('dialog', { name: 'More actions' });
    await menu.getByRole('button', { name: 'Run diagnostics' }).click();
    await menu.getByRole('button', { name: 'Run', exact: true }).click();
    // Jira either runs it or explains why not (the action needs an integration behind it).
    const outcome = p.locator('[role=status], [role=alert]').filter({ hasNotText: '…' });
    await expect(outcome.first()).toBeVisible({ timeout: 30_000 });
    test.info().annotations.push({ type: 'custom action outcome', description: await outcome.first().innerText() });
  });

  test('closing in Jira shows up in the app', async ({ page }) => {
    await page.goto(`/#/active?alert=${encodeURIComponent(alertId)}`);
    await expect(panel(page).locator('h2')).toHaveText(summary);
    await client!.performAction(alertId, { action: 'close' });
    await refreshUntil(page, async () => (await panel(page).locator('header').getByText('Closed', { exact: true }).count()) > 0);
  });
});

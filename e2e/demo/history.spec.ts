import { expect, test } from '../fixtures';

test('History: every breakdown, drill-down and a saved investigation', async ({ page }) => {
  await page.goto('/#/history');
  const now = new Date();
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const previousMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  await expect(page.getByLabel('From')).toHaveValue(previousMonth);
  await expect(page.getByLabel('To', { exact: true })).toHaveValue(previousMonthEnd);
  await page.getByRole('button', { name: 'Past 12 months' }).click();
  await page.getByRole('button', { name: 'Last month' }).click();
  await expect(page.getByLabel('From')).toHaveValue(previousMonth);
  await expect(page.getByLabel('To', { exact: true })).toHaveValue(previousMonthEnd);
  await page.getByRole('button', { name: 'Past 12 months' }).click();
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recurring' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Recurring' }).click();
  await expect(page.locator('table th', { hasText: '24 h' })).toBeVisible();
  await expect(page.locator('tbody .activity-strip').first()).toBeVisible();

  await page.getByRole('button', { name: 'Response' }).click();
  await expect(page.locator('table th', { hasText: 'MTTA' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toContainText(/^All/);
  await page.locator('tbody tr').nth(1).click();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();

  for (const name of ['P1 hotspots', 'Per customer', 'Per month']) {
    const button = page.getByRole('button', { name, exact: true });
    if ((await button.count()) > 0) await button.click();
  }

  await page.getByRole('button', { name: 'Investigations' }).click();
  const nameBox = page.getByRole('dialog', { name: 'Saved investigations' }).getByRole('textbox', { name: 'Investigation name' });
  await nameBox.fill('E2E investigation');
  await nameBox.press('Enter');
  // Saved: the menu button now carries its name.
  await expect(page.getByRole('button', { name: 'E2E investigation' })).toBeVisible();
});

test('History: finished results stay when another analysis takes over, and polling stops', async ({ page }) => {
  let polls = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && /\/api\/history-analysis$/.test(request.url())) polls += 1;
  });
  await page.goto('/#/history');
  await page.getByRole('button', { name: 'Past 12 months' }).click();
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  const title = page.getByRole('heading', { name: /^Alerts created per month/ });
  await expect(title).toBeVisible({ timeout: 30_000 });

  // The explanations sit behind the ⓘ beside the range.
  await page.locator('#history-analysis-title + p [role="img"]').hover();
  await expect(page.getByRole('tooltip')).toContainText('not a snapshot of the past');

  // Finished: no more status polls (they ran every 2 s).
  const settled = polls;
  await page.waitForTimeout(2_500);
  expect(polls).toBe(settled);

  // Another tab analyzes last month: the server now keeps only that job.
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const status = await page.evaluate(async (range) => (await fetch('/api/history-analysis', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-alert-center-action': '1' },
    body: JSON.stringify(range),
  })).status, { from, to });
  expect(status).toBe(200);

  // Back on this tab: the results stay, with a quiet note instead of an error.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('Another analysis is now current')).toBeVisible();
  await expect(title).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open it' }).click();
  await expect(page.getByLabel('From')).toHaveValue(from);
  await expect(page.getByLabel('To', { exact: true })).toHaveValue(to);
  await expect(title).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Another analysis is now current')).toHaveCount(0);
});

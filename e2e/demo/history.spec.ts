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

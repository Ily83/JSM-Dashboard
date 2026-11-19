import { expect, rows, search, test } from '../fixtures';

test.describe('alert list', () => {
  test('loads KPIs and the table', async ({ page }) => {
    await page.goto('/#/active');
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByText('Demo mode')).toBeVisible();
    await expect(page.locator('[data-widget=kpiActive]')).toContainText(/\d+/);
  });

  test('search queries filter, and an invalid one shows an error without breaking the list', async ({ page }) => {
    await page.goto('/#/active');
    await search(page).fill('priority:P1 AND customer:Contoso');
    await expect.poll(async () => rows(page).count()).toBeGreaterThan(0);
    for (const text of await rows(page).allInnerTexts()) {
      expect(text).toContain('P1');
      expect(text).toContain('Contoso');
    }
    await expect(page).toHaveURL(/[?&]q=priority/);

    await search(page).fill('priority:P9');
    await expect(page.locator('#search-error')).toContainText(/priority/i);
    await expect(page.getByRole('grid', { name: 'Alerts' })).toBeVisible();

    await search(page).fill('(status:acked OR status:snoozed) -tag:prod');
    await expect.poll(async () => rows(page).count()).toBeGreaterThan(0);
    for (const text of await rows(page).allInnerTexts()) expect(text).toMatch(/Acked|Snoozed/);
  });

  test('a copied link opens the same view elsewhere', async ({ page, browser }) => {
    await page.goto('/#/active');
    await search(page).fill('customer:Con* priority<=P2');
    await page.getByRole('radio', { name: /^Unacknowledged/ }).click();
    const shown = await rows(page).count();
    await page.getByRole('button', { name: 'Copy link to this view' }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/quick=unacked/);

    const other = await browser.newContext({ viewport: { width: 1600, height: 950 } });
    const page2 = await other.newPage();
    await page2.goto(link);
    await expect(page2.getByRole('searchbox').first()).toHaveValue('customer:Con* priority<=P2');
    await expect.poll(async () => page2.locator('.at-row:not([data-group]):not([data-lane])').count()).toBe(shown);
    await other.close();
  });

  test('group repeats and lanes combine', async ({ page }) => {
    await page.goto('/#/active');
    await page.getByRole('button', { name: 'Group repeats' }).click();
    const group = page.locator('.at-row[data-group]').first();
    await expect(group).toContainText(/\d+ alerts/);
    await expect(group.locator('.activity-strip')).toBeVisible();
    await group.click();
    await expect(page.locator('.at-row[data-child]').first()).toBeVisible();

    await page.getByRole('button', { name: 'Lanes' }).click();
    await page.getByRole('dialog', { name: 'Lanes' }).getByRole('radio', { name: 'Customer', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.at-row[data-lane]').first()).toBeVisible();
    await expect(page.locator('[aria-label^="Also in:"]').first()).toBeVisible();

    // Back to plain rows for the other tests.
    await page.getByRole('button', { name: 'Lanes' }).click();
    await page.getByRole('dialog', { name: 'Lanes' }).getByRole('radio', { name: 'No lanes', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Group repeats' }).click();
    await expect(page.locator('.at-row[data-lane]')).toHaveCount(0);
  });
});

import { expect, rows, test } from '../fixtures';

test('customer scope limits KPIs and the table without touching saved views', async ({ page }) => {
  await page.goto('/#/all');
  await expect(rows(page).first()).toBeVisible();
  const scope = page.getByRole('button', { name: /Customer scope/ });
  await expect(scope).toContainText('All customers');
  const kpi = page.locator('[data-widget=kpiActive]');
  const before = await kpi.innerText();
  const views = await page.evaluate(() => localStorage.getItem('jsm-alert-center:views:v1'));

  await scope.click();
  const dialog = page.getByRole('dialog', { name: 'Customer scope' });
  await dialog.getByRole('checkbox').first().check();
  const name = (await dialog.locator('li').first().locator('.customer-badge').innerText()).trim();
  await page.keyboard.press('Escape');
  await expect(scope).toContainText(name);
  await expect.poll(() => kpi.innerText()).not.toBe(before);
  for (const text of (await rows(page).allInnerTexts()).slice(0, 20)) expect(text).toContain(name);
  expect(await page.evaluate(() => localStorage.getItem('jsm-alert-center:views:v1'))).toBe(views);

  await scope.click();
  await page.getByRole('dialog', { name: 'Customer scope' }).getByRole('button', { name: 'All customers' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => kpi.innerText()).toBe(before);
});

test('settings show the connection, write actions and a preferences backup', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.locator('section[aria-labelledby="settings-connection"]')).toContainText(/Write actions\s*All · sample data only/);
  const download = page.waitForEvent('download');
  await page.locator('section[aria-labelledby="settings-backup"]').getByRole('button', { name: /Export/ }).first().click();
  const file = await download;
  const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks as Buffer[]).toString('utf8'));
  const backup = JSON.parse(text) as { format: string; data: Record<string, unknown> };
  expect(backup.format).toBe('jsm-alert-center-preferences');
  expect(Object.keys(backup.data)).toEqual(expect.arrayContaining(['prefs:v1', 'views:v1']));
  expect(text).not.toMatch(/apiToken|JIRA_|ATATT/);
});

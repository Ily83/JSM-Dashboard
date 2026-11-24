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
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.locator('section[aria-labelledby="settings-backup"]').getByRole('button', { name: /Export/ }).first().click();
  const file = await download;
  const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks as Buffer[]).toString('utf8'));
  const backup = JSON.parse(text) as { format: string; data: Record<string, unknown> };
  expect(backup.format).toBe('jsm-alert-center-preferences');
  expect(Object.keys(backup.data)).toEqual(expect.arrayContaining(['prefs:v1', 'views:v1']));
  expect(text).not.toMatch(/apiToken|JIRA_|ATATT/);
});

test('OAuth sign-out is visible in the header and requires explicit confirmation', async ({ page }) => {
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), oauth: true } });
  });
  const logoutMethods: string[] = [];
  await page.route('**/api/auth/logout', async (route) => {
    logoutMethods.push(route.request().method());
    await route.fulfill({
      contentType: 'text/html', body: '<a href="/api/auth/start">Sign in with Atlassian</a>',
    });
  });

  await page.goto('/#/all');
  const headerButton = page.getByRole('banner').getByRole('button', { name: 'Sign out' });
  const dialog = page.getByRole('dialog', { name: 'Sign out of Alert Center?' });
  await headerButton.click();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(headerButton).toBeFocused();
  expect(logoutMethods).toEqual([]);

  await page.goto('/#/settings');
  const settingsButton = page.locator('section[aria-labelledby="settings-connection"]').getByRole('button', { name: 'Sign out' });
  await settingsButton.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(settingsButton).toBeFocused();
  expect(logoutMethods).toEqual([]);

  await headerButton.click();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in with Atlassian' })).toBeVisible();
  expect(logoutMethods).toEqual(['POST']);
});

test('Save settings stays visible while scrolling and persists preferences', async ({ page }) => {
  await page.goto('/#/settings');
  const save = page.getByRole('button', { name: 'Save settings' });
  await expect(save).toBeDisabled();
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await expect(save).toBeEnabled();
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await expect(save).toBeDisabled();
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await page.getByRole('heading', { name: 'Reset', exact: true }).scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await save.click();
  await expect(page.getByText('Settings saved in this browser.')).toBeVisible();
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(save).toBeDisabled();
});

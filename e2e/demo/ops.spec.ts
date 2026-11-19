import { expect, test } from '../fixtures';

test('Operations widgets: maintenance windows (create and end), heartbeats, on call', async ({ page }) => {
  const opsCalls: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/ops') || path.startsWith('/api/maintenances')) opsCalls.push(path);
  });
  await page.goto('/#/active');
  await expect(page.locator('.at-row').first()).toBeVisible();
  await page.waitForTimeout(800);
  expect(opsCalls, 'no Operations requests while the widgets are off').toEqual([]);

  await page.getByRole('button', { name: 'Customize dashboard' }).click();
  for (const title of ['Maintenance windows', 'Heartbeats', 'On call now']) {
    const add = page.getByRole('button', { name: new RegExp(title) });
    if ((await add.count()) > 0) await add.first().click();
  }
  await page.getByRole('button', { name: 'Done' }).click();

  const maintenance = page.locator('section', { has: page.locator('h3', { hasText: /^Maintenance$/ }) }).first();
  await expect(maintenance).toContainText('Zabbix proxy upgrade');
  await expect(page.locator('section', { has: page.locator('h3', { hasText: 'Heartbeats' }) }).first()).toContainText('backup-proxy-litware-02');
  await expect(page.locator('section', { has: page.locator('h3', { hasText: 'On call now' }) }).first()).toContainText('Cloud Operations on-call');

  await maintenance.getByRole('button', { name: 'New maintenance' }).click();
  const dialog = page.getByRole('dialog', { name: 'New maintenance' });
  await dialog.getByRole('textbox', { name: 'Description' }).fill('E2E agent rollout');
  await dialog.getByRole('button', { name: '30 min' }).click();
  await dialog.getByRole('checkbox', { name: 'Datadog' }).check();
  await dialog.getByRole('button', { name: 'Start maintenance' }).click();
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(maintenance.getByText('E2E agent rollout')).toBeVisible();

  await maintenance.getByRole('button', { name: 'End maintenance E2E agent rollout' }).click();
  await maintenance.getByRole('button', { name: 'End now' }).click();
  await expect(maintenance.getByText('E2E agent rollout')).toHaveCount(0);

  // Leave the dashboard as it was.
  await page.getByRole('button', { name: 'Customize dashboard' }).click();
  for (const title of ['Maintenance', 'Heartbeats', 'On call now']) {
    const hide = page.getByRole('button', { name: new RegExp(`^Hide ${title}`) });
    if ((await hide.count()) > 0) await hide.first().click();
  }
  await page.getByRole('button', { name: 'Done' }).click();
});

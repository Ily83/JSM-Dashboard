import { apiAction, expect, listAlerts, panel, rows, test } from '../fixtures';

test.describe('actions', () => {
  test('every action from the detail panel', async ({ page }) => {
    await page.goto('/#/active');
    const target = (await listAlerts(page)).find((a) => a.status === 'open' && !a.acknowledged && a.priority === 'P3');
    expect(target).toBeTruthy();
    await page.goto(`/#/active?alert=${encodeURIComponent(target!.id)}`);
    const p = panel(page);
    await expect(p.locator('h2')).toHaveText(target!.summary);

    await p.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(p.getByRole('status')).toContainText('Alert acknowledged');
    await p.getByRole('button', { name: 'Unacknowledge' }).click();
    await expect(p.getByRole('status')).toContainText('Alert unacknowledged');

    await p.getByRole('textbox', { name: 'New note' }).fill('Checked by the end-to-end test.');
    await p.getByRole('button', { name: 'Add note' }).click();
    await expect(p.locator('li', { hasText: 'Checked by the end-to-end test.' })).toBeVisible();

    await p.getByRole('button', { name: 'Add tags' }).click();
    await p.getByRole('textbox', { name: /New tags/ }).fill('customer:Litware, e2e');
    await p.getByRole('textbox', { name: /New tags/ }).press('Enter');
    await expect(p.locator('.customer-badge', { hasText: 'Litware' })).toBeVisible();
    await p.getByRole('button', { name: 'Remove tag e2e' }).click();
    await expect(p.getByRole('button', { name: 'Remove tag e2e' })).toHaveCount(0);

    await p.getByRole('button', { name: 'Assign', exact: true }).click();
    await page.getByRole('dialog', { name: 'Assign' }).getByRole('button', { name: /Assign to me/ }).click();
    await expect(p.locator('dd', { hasText: 'Demo Operator' }).first()).toBeVisible();

    await p.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('dialog', { name: 'More actions' }).getByRole('button', { name: 'Change priority…' }).click();
    await page.getByRole('dialog', { name: 'More actions' }).getByRole('button', { name: 'Priority P4' }).click();
    await expect(p.locator('header').getByText('P4', { exact: true })).toBeVisible();

    await p.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('dialog', { name: 'More actions' }).getByRole('button', { name: 'Add responder…' }).click();
    await page.getByRole('dialog', { name: 'More actions' }).getByRole('button', { name: 'Database Team' }).click();
    await expect(p.locator('dd', { hasText: 'Database Team' })).toBeVisible();

    await p.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('dialog', { name: 'More actions' }).getByRole('button', { name: 'Escalate to next…' }).click();
    await page.getByRole('dialog', { name: 'More actions' }).locator('ul button').first().click();
    await expect(p.getByRole('status')).toContainText('Escalated to next level');

    await p.getByRole('button', { name: 'Snooze' }).click();
    await page.getByRole('dialog', { name: 'Snooze' }).getByRole('button', { name: '1 h' }).click();
    await expect(p.locator('header').getByText('Snoozed', { exact: true })).toBeVisible();

    await p.getByRole('button', { name: 'Close', exact: true }).click();
    await p.getByRole('button', { name: 'Confirm close' }).click();
    await expect(p.locator('header').getByText('Closed', { exact: true })).toBeVisible();

    await p.locator('button', { hasText: 'Activity' }).click();
    await expect.poll(async () => p.locator('ol li').count()).toBeGreaterThanOrEqual(9);
  });

  test('keyboard: A, U, C with confirmation, W; custom action and runbook', async ({ page }) => {
    await page.goto('/#/active');
    const all = await listAlerts(page);
    // Demo alerts offer custom actions and a runbook on every third sample.
    const details = await Promise.all(
      all
        .filter((a) => a.status === 'open' && !a.acknowledged)
        .slice(0, 12)
        .map(async (a) => page.evaluate(async (id) => (await (await fetch(`/api/alerts/${id}`)).json()) as { id: string; actions: string[]; summary: string }, a.id)),
    );
    const target = details.find((d) => d.actions.length > 0);
    expect(target).toBeTruthy();
    await page.goto(`/#/active?alert=${encodeURIComponent(target!.id)}`);
    const p = panel(page);
    await expect(p.locator('h2')).toHaveText(target!.summary);
    await page.locator('body').click({ position: { x: 900, y: 20 } });

    await page.keyboard.press('a');
    await expect(p.getByRole('status')).toContainText('Alert acknowledged');
    await page.keyboard.press('u');
    await expect(p.getByRole('status')).toContainText('Alert unacknowledged');
    await page.keyboard.press('c');
    await expect(p.getByRole('button', { name: 'Confirm close' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(p.getByRole('button', { name: 'Confirm close' })).toHaveCount(0);
    await expect(p).toBeVisible();
    await page.keyboard.press('w');
    await expect(p.getByRole('button', { name: 'Stop watching' })).toBeVisible();

    await expect(p.getByRole('link', { name: 'Open runbook' })).toHaveAttribute('href', /^https:\/\/wiki\.example\.com\//);
    await p.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('dialog', { name: 'More actions' });
    await menu.getByRole('button', { name: target!.actions[0] }).click();
    await menu.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(p.getByRole('status')).toContainText(`Custom action "${target!.actions[0]}" executed`);

    await p.getByRole('button', { name: 'Close details' }).click();
    await page.getByRole('radio', { name: /^Watching/ }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator('[aria-label="Watching"]')).toBeVisible();
  });

  test('bulk acknowledge reports each alert and skips the ones it does not fit', async ({ page }) => {
    await page.goto('/#/active');
    const boxes = page.locator('.at-row:not([data-group]):not([data-lane]) .at-select input');
    await boxes.nth(0).click();
    await boxes.nth(5).click({ modifiers: ['Shift'] });
    const bar = page.locator('[aria-label="Bulk actions"]');
    await expect(bar).toContainText('6 selected');
    const button = bar.getByRole('button', { name: /^Acknowledge/ });
    const fits = Number((await button.innerText()).replace(/\D/g, ''));
    test.skip(fits === 0, 'all selected alerts were already acknowledged');
    await button.click();
    await bar.getByRole('button', { name: 'Confirm' }).click();
    await expect(bar).toContainText(`${fits} acknowledged`);
    if (fits < 6) await expect(bar).toContainText(`${6 - fits} skipped`);
  });

  test.describe('refusals', () => {
    // The browser logs the deliberate 403 and 400 answers.
    test.use({ allowConsole: [/Failed to load resource: the server responded with a status of 40[03]/] });
  test('the backend refuses a write without the action header', async ({ page }) => {
    await page.goto('/#/active');
    const [first] = await listAlerts(page);
    const status = await page.evaluate(
      async (id) => (await fetch(`/api/alerts/${id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"close"}' })).status,
      first!.id,
    );
    expect(status).toBe(403);
    expect(await apiAction(page, first!.id, { action: 'nonsense' })).toBe(400);
  });
  });
});

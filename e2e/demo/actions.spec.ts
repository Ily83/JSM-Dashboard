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
    // One alert is acknowledged at once; more than one asks first.
    if (fits > 1) {
      await expect(bar).toContainText(`Acknowledge ${fits} alerts?`);
      await bar.getByRole('button', { name: 'Confirm' }).click();
    }
    await expect(bar).toContainText(`${fits} alert${fits === 1 ? '' : 's'} acknowledged`);
    if (fits < 6) await expect(bar).toContainText(`${6 - fits} skipped`);
    // Focus stays on the button that started it.
    await expect(button).toBeFocused();
  });

  test('the bar keeps the table in place, asks before a bulk close and Esc cancels', async ({ page }) => {
    await page.goto('/#/active');
    const grid = page.getByRole('grid', { name: 'Alerts' });
    const bar = page.locator('[aria-label="Bulk actions"]');
    const top = (await grid.boundingBox())!.y;
    await rows(page).nth(0).locator('input').click();
    await expect(bar).toContainText('1 selected');
    expect((await grid.boundingBox())!.y).toBe(top);
    await rows(page).nth(1).locator('input').click();
    await bar.getByRole('button', { name: /^Close/ }).click();
    await expect(bar).toContainText('Close 2 alerts?');
    const confirm = bar.getByRole('button', { name: 'Confirm' });
    await expect(confirm).toBeFocused();
    await expect(confirm).toHaveAccessibleDescription('Close 2 alerts?');
    await page.keyboard.press('Escape');
    await expect(bar).not.toContainText('Close 2 alerts?');
    await expect(bar.getByRole('button', { name: /^Close/ })).toBeFocused();
    expect((await grid.boundingBox())!.y).toBe(top);
  });

  test('More actions opens the alert menu from the bar', async ({ page }) => {
    await page.goto('/#/active');
    const bar = page.locator('[aria-label="Bulk actions"]');
    const more = bar.getByRole('button', { name: 'More actions' });
    await rows(page).nth(0).locator('input').click();
    await rows(page).nth(1).locator('input').click();
    await more.click();
    const menu = page.getByRole('menu', { name: 'Alert actions' });
    await expect(menu).toContainText('2 selected');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const box = (await page.locator('[data-context-menu]').boundingBox())!;
    const button = (await more.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(button.y + button.height - 1);
    await expect(menu.getByRole('menuitem', { name: /^Snooze…/ })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
    // Pressing the button again closes the menu it opened.
    await more.click();
    await expect(menu).toBeVisible();
    await more.click();
    await expect(menu).toHaveCount(0);
  });

  test('keyboard opens the alert menu against the row and returns focus to it', async ({ page }) => {
    await page.goto('/#/active');
    let writes = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/actions')) writes += 1;
    });
    const row = rows(page).nth(2);
    await expect(row).toHaveAttribute('aria-haspopup', 'menu');
    await row.focus();
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'Alert actions' });
    const items = menu.getByRole('menuitem');
    await expect(items.first()).toBeFocused();
    const rowBox = (await row.boundingBox())!;
    const menuBox = (await page.locator('[data-context-menu]').boundingBox())!;
    expect(menuBox.y >= rowBox.y + rowBox.height - 1 || menuBox.y + menuBox.height <= rowBox.y + 1).toBe(true);
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(row).toBeFocused();

    await page.keyboard.press('ContextMenu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(row).toBeFocused();

    // Close asks in the menu; Esc cancels the question, a second Esc closes the menu.
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('c');
    const question = page.locator('[data-context-menu]').getByRole('dialog');
    await expect(question).toContainText('Close 1 alert?');
    await expect(question.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu.getByRole('menuitem', { name: /^Close/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(row).toBeFocused();

    // A picker focuses its first control.
    await page.keyboard.press('Shift+F10');
    await menu.getByRole('menuitem', { name: 'Add tags…' }).click();
    await expect(page.locator('[data-context-menu]').getByRole('textbox', { name: 'Tags' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu.getByRole('menuitem', { name: 'Add tags…' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(row).toBeFocused();
    expect(writes).toBe(0);
  });

  test('a sideways drag in a row selects text; Esc cancels a rectangle drag', async ({ page }) => {
    await page.goto('/#/active');
    const row = rows(page).nth(1);
    const box = (await row.boundingBox())!;
    const summary = (await row.locator('[role="gridcell"]').nth(2).boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(summary.x + 6, y);
    await page.mouse.down();
    await page.mouse.move(summary.x + 160, y + 1, { steps: 6 });
    await page.mouse.up();
    expect((await page.evaluate(() => globalThis.getSelection()?.toString() ?? '')).length).toBeGreaterThan(3);
    await expect(page.locator('.at-row[data-checked]')).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('[data-selection-box]')).toHaveCount(0);

    await rows(page).nth(0).locator('input').click();
    const third = (await rows(page).nth(2).boundingBox())!;
    const seventh = (await rows(page).nth(6).boundingBox())!;
    await page.mouse.move(third.x + 120, third.y + third.height / 2);
    await page.mouse.down();
    await page.mouse.move(third.x + 140, seventh.y + seventh.height / 2, { steps: 5 });
    await expect(page.locator('[data-selection-box]')).toBeVisible();
    await expect.poll(async () => page.locator('.at-row[data-checked]').count()).toBeGreaterThan(3);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-selection-box]')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('.at-row[data-checked]')).toHaveCount(1);
    await expect(rows(page).nth(0)).toHaveAttribute('data-checked', 'true');
    await expect(panel(page)).toHaveCount(0);
  });

  test('drag selects alerts; the context menu asks before bulk actions and acts on one alert at once', async ({ page }) => {
    await page.goto('/#/active');
    await page.getByRole('radio', { name: /^Unacknowledged/ }).click();
    const first = rows(page).nth(0);
    const fifth = rows(page).nth(4);
    await expect(fifth).toBeVisible();
    const start = (await first.boundingBox())!;
    const end = (await fifth.boundingBox())!;
    let writes = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/actions')) writes += 1;
    });

    await page.mouse.move(start.x + 120, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + 200, end.y + end.height / 2, { steps: 4 });
    await expect(page.locator('[data-selection-box]')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('[data-selection-box]')).toHaveCount(0);
    const bar = page.locator('[aria-label="Bulk actions"]');
    await expect.poll(async () => page.locator('.at-row[data-checked]').count()).toBeGreaterThan(1);
    const selected = await page.locator('.at-row[data-checked]').count();
    await expect(bar).toContainText(`${selected} selected`);
    await expect(panel(page)).toHaveCount(0);

    await page.locator('.at-row[data-checked]').first().click({ button: 'right' });
    const popup = page.locator('[data-context-menu]');
    const menu = page.getByRole('menu', { name: 'Alert actions' });
    await expect(menu).toContainText(`${selected} selected`);
    await menu.getByRole('menuitem', { name: /^Acknowledge/ }).click();
    // The question is asked in the menu, at the pointer.
    await expect(popup).toContainText(`Acknowledge ${selected} alerts?`);
    expect(writes).toBe(0);
    await popup.getByRole('button', { name: 'Cancel' }).click();
    await expect(menu.getByRole('menuitem', { name: /^Acknowledge/ })).toBeFocused();

    await rows(page).nth(8).click({ button: 'right' });
    await expect(menu).toContainText('1 selected');
    await expect(bar).toContainText('1 selected');
    await menu.getByRole('menuitem', { name: /^Acknowledge/ }).click();
    // One alert: acknowledged at once.
    await expect(bar).toContainText('1 alert acknowledged');
    expect(writes).toBe(1);
    await expect(popup).toHaveCount(0);

    // The next menu works without dismissing the outcome first.
    await rows(page).first().click({ button: 'right' });
    await expect(menu.getByRole('menuitem', { name: /^Acknowledge/ })).toBeEnabled();
    await menu.getByRole('menuitem', { name: 'Open alert details' }).click();
    await expect(panel(page)).toBeVisible();
    await expect(rows(page).first()).toBeFocused();
    expect(writes).toBe(1);
  });

  test('context menu assigns one alert at once and asks before assigning several', async ({ page }) => {
    await page.goto('/#/active');
    const writes: Array<{ action: string; accountId?: string }> = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/actions')) writes.push(request.postDataJSON());
    });
    const menu = page.locator('[data-context-menu]');
    const bar = page.locator('[aria-label="Bulk actions"]');

    await rows(page).first().click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Assign…' }).click();
    await menu.getByRole('button', { name: /Assign to me/ }).click();
    await expect(bar).toContainText('1 alert assigned to Demo Operator');
    expect(writes).toEqual([{ action: 'assign', accountId: 'demo-user-operator' }]);

    await rows(page).nth(0).locator('input').click();
    await rows(page).nth(1).locator('input').click();
    await rows(page).first().click({ button: 'right' });
    await menu.getByRole('menuitem', { name: /^Assign…/ }).click();
    await menu.getByRole('textbox', { name: 'Search people' }).fill('Priya');
    await menu.getByRole('button', { name: 'Priya Nair' }).click();
    await expect(menu).toContainText('Assign 2 alerts to Priya Nair?');
    expect(writes).toHaveLength(1);
    await menu.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(bar).toContainText('2 alerts assigned to Priya Nair');
    expect(writes.slice(1)).toEqual([
      { action: 'assign', accountId: 'demo-user-priya' },
      { action: 'assign', accountId: 'demo-user-priya' },
    ]);
  });

  test('context menu runs picker actions on one alert at once', async ({ page }) => {
    await page.goto('/#/active');
    const writes: Array<Record<string, unknown>> = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/actions')) writes.push(request.postDataJSON());
    });
    const menu = page.locator('[data-context-menu]');
    const status = page.locator('[aria-label="Bulk actions"]').getByRole('status');
    const open = async (label: string) => {
      await rows(page).first().click({ button: 'right' });
      await menu.getByRole('menuitem', { name: label, exact: true }).click();
    };
    const done = async (count: number, outcome: string) => {
      await expect(status).toContainText(outcome);
      await expect(menu).toHaveCount(0);
      expect(writes).toHaveLength(count);
      await expect(status).not.toContainText('failed');
    };

    await open('Change priority…');
    await menu.getByRole('button', { name: 'Priority P4' }).click();
    await done(1, '1 alert set to P4');
    expect(writes[0]).toEqual({ action: 'priority', priority: 'P4' });

    await open('Snooze…');
    await menu.getByRole('button', { name: '1 h' }).click();
    await done(2, '1 alert snoozed until');
    expect(writes[1]).toMatchObject({ action: 'snooze' });

    // Tags take one line: Enter adds them.
    await open('Add tags…');
    await menu.getByRole('textbox', { name: 'Tags' }).fill('menu-test, ops');
    await menu.getByRole('textbox', { name: 'Tags' }).press('Enter');
    await done(3, '1 alert tagged menu-test, ops');
    expect(writes[2]).toEqual({ action: 'addTags', tags: ['menu-test', 'ops'] });

    await open('Remove tags…');
    await menu.getByRole('textbox', { name: 'Tags' }).fill('menu-test');
    await menu.getByRole('textbox', { name: 'Tags' }).press('Enter');
    await done(4, 'Tag menu-test removed from 1 alert');
    expect(writes[3]).toEqual({ action: 'removeTags', tags: ['menu-test'] });

    // A note may take several lines: Ctrl+Enter adds it.
    await open('Add note…');
    await menu.getByRole('textbox', { name: 'Note' }).fill('Investigating from the menu');
    await menu.getByRole('textbox', { name: 'Note' }).press('Control+Enter');
    await done(5, 'Note added to 1 alert');
    expect(writes[4]).toEqual({ action: 'addNote', note: 'Investigating from the menu' });

    await open('Add responder…');
    await menu.getByRole('button', { name: 'Database Team' }).click();
    await done(6, 'Database Team added to 1 alert');
    expect(writes[5]).toEqual({ action: 'addResponder', responder: { type: 'team', id: 'team-dba' } });

    await open('Escalate to next…');
    const escalation = menu.locator('ul button').first();
    await expect(escalation).toBeVisible();
    const escalationName = await escalation.innerText();
    await escalation.click();
    await done(7, `1 alert escalated via ${escalationName}`);
    expect(writes[6]).toMatchObject({ action: 'escalate' });
  });

  test('context menu applies a note to multiple alerts and respects individual permissions', async ({ page }) => {
    await page.route('**/api/status', async (route) => {
      const response = await route.fetch();
      const status = await response.json();
      await route.fulfill({ response, json: { ...status, readOnly: false, writes: { enabled: true, actions: ['addNote'] } } });
    });
    await page.goto('/#/active');
    const writes: Array<Record<string, unknown>> = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/actions')) writes.push(request.postDataJSON());
    });
    await rows(page).nth(0).locator('input').click();
    await rows(page).nth(1).locator('input').click();
    await rows(page).first().click({ button: 'right' });
    const menu = page.locator('[data-context-menu]');
    await expect(menu.getByRole('menuitem', { name: /^Add note…/ })).toBeEnabled();
    await expect(menu.getByRole('menuitem', { name: /^Assign…/ })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: /^Run action…/ })).toBeDisabled();
    await menu.getByRole('menuitem', { name: /^Add note…/ }).click();
    await menu.getByRole('textbox', { name: 'Note' }).fill('Bulk handover');
    await menu.getByRole('button', { name: 'Add note' }).click();
    const bar = page.locator('[aria-label="Bulk actions"]');
    await expect(menu).toContainText('Add note to 2 alerts?');
    expect(writes).toHaveLength(0);
    await menu.getByRole('button', { name: 'Add note' }).click();
    await expect(bar).toContainText('Note added to 2 alerts');
    expect(writes).toEqual([
      { action: 'addNote', note: 'Bulk handover' },
      { action: 'addNote', note: 'Bulk handover' },
    ]);
  });

  test('context menu only offers the selected alert’s custom actions', async ({ page }) => {
    await page.goto('/#/active');
    const all = await listAlerts(page);
    const details = await Promise.all(all.filter((a) => a.status !== 'closed').slice(0, 15).map(async (a) =>
      page.evaluate(async (id) => (await (await fetch(`/api/alerts/${id}`)).json()) as { id: string; actions: string[]; summary: string }, a.id),
    ));
    const target = details.find((detail) => detail.actions.length > 0)!;
    expect(target).toBeTruthy();
    await page.getByRole('searchbox', { name: 'Search alerts' }).fill(`"${target.id}"`);
    await expect(rows(page).first()).toContainText(target.summary);
    await rows(page).first().click({ button: 'right' });
    const menu = page.locator('[data-context-menu]');
    await menu.getByRole('menuitem', { name: 'Run action…' }).click();
    await menu.getByRole('button', { name: target.actions[0], exact: true }).click();
    // A custom action can do anything: it always asks, even for one alert.
    await expect(menu).toContainText(`Run “${target.actions[0]}” on 1 alert?`);
    await menu.getByRole('button', { name: 'Run', exact: true }).click();
    const bar = page.locator('[aria-label="Bulk actions"]');
    await expect(bar).toContainText(`“${target.actions[0]}” run on 1 alert`);
  });

  test('rectangle selection adds with Control and scrolls at the table edge', async ({ page }) => {
    await page.goto('/#/active');
    const grid = page.getByRole('grid', { name: 'Alerts' });
    await rows(page).nth(0).locator('input').click();
    const third = (await rows(page).nth(2).boundingBox())!;
    const sixth = (await rows(page).nth(5).boundingBox())!;
    await page.keyboard.down('Control');
    await page.mouse.move(third.x + 120, third.y + third.height / 2);
    await page.mouse.down();
    await page.mouse.move(sixth.x + 200, sixth.y + sixth.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await expect(rows(page).nth(0)).toHaveAttribute('data-checked', 'true');
    await expect.poll(async () => page.locator('.at-row[data-checked]').count()).toBeGreaterThan(2);

    const gridBox = (await grid.boundingBox())!;
    const first = (await rows(page).first().boundingBox())!;
    await page.mouse.move(first.x + 120, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 200, gridBox.y + gridBox.height - 4, { steps: 5 });
    await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(40);
    await page.mouse.up();
    await expect(page.locator('[aria-label="Bulk actions"]')).toContainText(/selected/);
    await expect(panel(page)).toHaveCount(0);
  });

  test('selection and details remain available in read-only mode', async ({ page }) => {
    await page.route('**/api/status', async (route) => {
      const response = await route.fetch();
      const status = await response.json();
      await route.fulfill({ response, json: { ...status, readOnly: true, writes: { enabled: false, actions: [] } } });
    });
    await page.goto('/#/active');
    await rows(page).first().click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Alert actions' });
    await expect(menu).toContainText('Disabled actions must be enabled in the backend');
    await expect(menu.getByRole('menuitem', { name: /^Acknowledge/ })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: 'Assign…' })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: 'Snooze…' })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: 'Add note…' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(rows(page).first()).toBeFocused();
    await expect(page.locator('[aria-label="Bulk actions"]')).toContainText('1 selected');
    await rows(page).first().click();
    await expect(panel(page)).toBeVisible();
  });

  test('right-clicking a repeated group selects its alerts', async ({ page }) => {
    await page.goto('/#/active');
    await page.getByRole('button', { name: 'Group repeats' }).click();
    const group = page.locator('.at-row[data-group]').first();
    await expect(group).toBeVisible();
    const label = await group.locator('input').getAttribute('aria-label');
    const count = Number(label?.match(/Select (\d+) alerts/)?.[1]);
    expect(count).toBeGreaterThan(1);
    await group.click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'Alert actions' })).toContainText(`${count} selected`);
    await expect(page.locator('[aria-label="Bulk actions"]')).toContainText(`${count} selected`);
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

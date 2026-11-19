import { alarms, apiAction, expect, listAlerts, panel, recordAlarms, test } from '../fixtures';

test('P1 alarm: only a P1 arrival rings, and the notification opens the alert', async ({ page }) => {
  await recordAlarms(page);
  await page.goto('/#/active');
  await page.getByRole('button', { name: 'P1 alarm' }).click();
  await expect(page.getByRole('button', { name: 'P1 alarm' })).toHaveAttribute('aria-pressed', 'true');

  const all = await listAlerts(page);
  const p4 = all.find((a) => a.priority === 'P4' && a.status === 'open')!;
  expect(await apiAction(page, p4.id, { action: 'priority', priority: 'P2' })).toBe(200);
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.waitForTimeout(1500);
  expect((await alarms(page)).titles).toEqual([]);

  const p3 = all.find((a) => a.priority === 'P3' && a.status === 'open' && a.id !== p4.id)!;
  expect(await apiAction(page, p3.id, { action: 'priority', priority: 'P1' })).toBe(200);
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await expect.poll(async () => (await alarms(page)).titles).toEqual([`P1 #${p3.tinyId}`]);
  expect((await alarms(page)).tones).toBeGreaterThanOrEqual(4);

  await page.evaluate(() => (window as unknown as { __notes: Array<{ onclick: () => void }> }).__notes[0]!.onclick());
  await expect(page).toHaveURL(new RegExp(`#/critical\\?.*alert=${encodeURIComponent(p3.id)}`));
  await expect(panel(page).locator('h2')).toHaveText(p3.summary);

  await page.goto('/#/settings');
  const card = page.locator('section[aria-labelledby="settings-p1-alarm"]');
  await card.getByRole('button', { name: 'Play test' }).click();
  await expect(card).toContainText(/Sound played|Sound unavailable/);
  await page.goto('/#/active');
  await page.getByRole('button', { name: 'P1 alarm' }).click();
  await expect(page.getByRole('button', { name: 'P1 alarm' })).toHaveAttribute('aria-pressed', 'false');
});

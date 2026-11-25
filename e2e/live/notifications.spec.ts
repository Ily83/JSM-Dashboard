import type { Page } from '@playwright/test';
import type { NotificationRule, NotificationsResponse } from '../../shared/notifications';
import { apiWrite, expect, test } from '../fixtures';

/**
 * The signed-in user's notification settings on a real Jira site (a TEST site),
 * through the app. Everything happens on one rule this test creates, switches
 * off before it gets a notification method, and deletes at the end, so nobody
 * is notified. Contacts are only read: adding one sends a real message, and
 * Jira refuses example addresses.
 */

const NAME = `alert-center-e2e-${Date.now().toString(36)}`;

// The deliberately refused change at the end is logged by the browser.
test.use({ allowConsole: [/Failed to load resource: the server responded with a status of 4\d\d/] });

async function settings(page: Page): Promise<NotificationsResponse> {
  const response = await page.request.get('/api/notifications');
  expect(response.status()).toBe(200);
  return (await response.json()) as NotificationsResponse;
}

async function change(page: Page, body: Record<string, unknown>): Promise<NotificationsResponse> {
  const { status, body: answer } = await apiWrite<NotificationsResponse & { error?: string }>(page, '/api/notifications', body);
  expect(status, `${String(body.op)}: ${answer?.error ?? ''}`).toBe(200);
  return answer;
}

const ours = (data: NotificationsResponse) => data.rules.filter((r) => r.name === NAME);

test.describe.serial('live notification settings', () => {
  test.afterAll(async ({ browser }) => {
    // Whatever happened above, no test rule is left behind.
    const page = await browser.newPage();
    await page.goto('/#/notifications');
    for (const rule of ours(await settings(page))) await apiWrite(page, '/api/notifications', { op: 'deleteRule', id: rule.id });
    await page.close();
  });

  test('a disabled rule: notification method, query, daily window, then the window removed and the rule deleted', async ({ page }) => {
    await page.goto('/#/notifications');
    await expect(page.getByRole('heading', { name: 'Contact methods' })).toBeVisible();
    const before = await settings(page);
    expect(before.writable, 'JIRA_WRITE_ACTIONS must enable notifications for this test').toBe(true);
    const email = before.contacts.find((c) => c.method === 'email' && c.enabled);
    expect(email, 'the account needs an email contact').toBeTruthy();

    let data = await change(page, { op: 'addRule', event: 'add-note', name: NAME });
    let rule: NotificationRule = ours(data)[0];
    expect(rule).toBeTruthy();
    // Off before it can notify anyone.
    data = await change(page, { op: 'updateRule', id: rule.id, enabled: false });
    expect(ours(data)[0].enabled).toBe(false);

    data = await change(page, { op: 'addStep', ruleId: rule.id, contactId: email!.id, sendAfter: 0 });
    rule = ours(data)[0];
    expect(rule.steps.map((s) => s.to)).toEqual([email!.to]);
    data = await change(page, { op: 'updateStep', ruleId: rule.id, id: rule.steps[0].id, enabled: false });
    expect(ours(data)[0].steps[0].enabled).toBe(false);

    data = await change(page, {
      op: 'updateRule', id: rule.id, criteria: { type: 'advanced-query', query: 'priority:P1 AND tags:alert-center-e2e' },
      timeRestriction: { type: 'time-of-day', restriction: { startHour: 8, startMin: 0, endHour: 18, endMin: 30 } },
    });
    rule = ours(data)[0];
    expect(rule.criteria).toEqual({ type: 'advanced-query', query: 'priority:P1 AND tags:alert-center-e2e' });
    expect(rule.timeRestriction).toEqual({ type: 'time-of-day', restriction: { startHour: 8, startMin: 0, endHour: 18, endMin: 30 } });
    expect(rule.enabled).toBe(false);

    // The page shows it.
    await page.reload();
    const item = page.getByRole('list', { name: 'Add note rules' }).getByRole('listitem').filter({ hasText: NAME }).first();
    await expect(item.getByText('priority:P1 AND tags:alert-center-e2e · 08:00–18:30 every day')).toBeVisible();

    // Jira cannot drop a time limit in place: the app replaces the rule, keeping its settings and steps (at the end of the list).
    data = await change(page, { op: 'updateRule', id: rule.id, timeRestriction: null });
    const [copy, ...others] = ours(data);
    expect(others).toEqual([]);
    expect(copy.id).not.toBe(rule.id);
    expect(copy.timeRestriction).toBeNull();
    expect(copy.enabled).toBe(false);
    expect(copy.criteria).toEqual(rule.criteria);
    expect(copy.steps.map((s) => [s.to, s.enabled])).toEqual([[email!.to, false]]);

    data = await change(page, { op: 'deleteRule', id: copy.id });
    expect(ours(data)).toEqual([]);
    expect(data.rules.length).toBe(before.rules.length);
  });

  test('Jira’s refusal reaches the operator', async ({ page }) => {
    await page.goto('/#/notifications');
    const { status, body } = await apiWrite<{ error?: string }>(page, '/api/notifications', { op: 'addRule', event: 'schedule-start', name: `${NAME}-x` });
    // The app always sends a notification time for schedule rules, so Jira accepts it; remove it again.
    expect(status).toBe(200);
    const created = (body as unknown as NotificationsResponse).rules.find((r) => r.name === `${NAME}-x`)!;
    expect(created.notificationTime).toEqual(['just-before']);
    await change(page, { op: 'deleteRule', id: created.id });
    const refused = await apiWrite<{ error?: string }>(page, '/api/notifications', { op: 'updateStep', ruleId: created.id, id: 'missing', enabled: false });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.body?.error).toBeTruthy();
  });
});

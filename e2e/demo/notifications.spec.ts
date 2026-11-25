import { expect, test } from '../fixtures';

// The refused delete at the end answers 422, which the browser logs.
test.use({ allowConsole: [/Failed to load resource: the server responded with a status of 422/] });

test('Alert notifications: contacts, steps and rule settings on sample data', async ({ page }) => {
  await page.goto('/#/active');
  await page.getByRole('link', { name: 'Alert notifications' }).click();
  await expect(page).toHaveURL(/#\/notifications$/);
  await expect(page.getByRole('heading', { name: 'Contact methods' })).toBeVisible();

  // A new voice number, then switch the SMS number on.
  await page.getByRole('button', { name: 'Add voice number' }).click();
  await page.getByRole('textbox', { name: 'New Voice contact' }).fill('+44 20 7946 0000');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Voice contacts' })).toContainText('+44 20 7946 0000');
  await page.getByRole('switch', { name: 'Use SMS +1 555 0100' }).click();
  await expect(page.getByRole('switch', { name: 'Use SMS +1 555 0100' })).toHaveAttribute('aria-checked', 'true');

  // The new number becomes a notification method of the "New Alert" rule, five minutes after the alert.
  const rule = page.getByRole('list', { name: 'New alert rules' }).getByRole('listitem').filter({ hasText: 'New Alert' }).first();
  await rule.getByRole('button', { name: 'Add notification method' }).click();
  await rule.getByRole('combobox', { name: 'Contact to add to New Alert' }).selectOption({ label: 'Voice · +44 20 7946 0000' });
  await rule.getByRole('button', { name: 'Add', exact: true }).click();
  const voice = rule.getByRole('combobox', { name: 'When to notify Voice +44 20 7946 0000' });
  await voice.selectOption('5');
  await expect(voice).toHaveValue('5');

  // The weekend rule loses its time limit (Jira replaces the rule) and gets a query instead of its condition.
  const weekend = page.getByRole('listitem').filter({ has: page.getByText('P1 by SMS at the weekend', { exact: true }) });
  await expect(weekend.getByText('priority:P1 · Fri 18:00 – Mon 08:00')).toBeVisible();
  await weekend.getByRole('button', { name: 'Edit rule P1 by SMS at the weekend' }).click();
  const form = page.getByRole('form', { name: 'Edit P1 by SMS at the weekend' });
  await form.getByRole('textbox', { name: 'Alert query' }).fill('priority:P1 AND tags:prod');
  await form.getByRole('radio', { name: 'Any time' }).check();
  await form.getByRole('button', { name: 'Save rule' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText('priority:P1 AND tags:prod', { exact: true })).toBeVisible();

  // A rule for the end of an on-call shift, removed again.
  await page.getByRole('button', { name: 'Add a Schedule end rule' }).click();
  await page.getByRole('textbox', { name: 'Name of the new Schedule end rule' }).fill('Shift over');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const shift = page.getByRole('list', { name: 'Schedule end rules' }).getByRole('listitem').filter({ hasText: 'Shift over' }).first();
  await expect(shift.getByText('Just before the end')).toBeVisible();
  await shift.getByRole('button', { name: 'Delete rule Shift over' }).click();
  await shift.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Shift over')).toHaveCount(0);

  // A refusal is shown, and the settings stay as they are.
  await page.getByRole('button', { name: 'Delete Email operator@example.com' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('primary email address cannot be deleted');
  await expect(page.getByRole('list', { name: 'Email contacts' })).toContainText('operator@example.com');
});

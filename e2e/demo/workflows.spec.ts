import { expect, listAlerts, test } from '../fixtures';

test('operator drafts, previews, copies, and removes a workflow without any writes', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('/');
  await page.getByRole('link', { name: 'Workflows' }).click();
  const matching = (await listAlerts(page)).filter(a => a.priority === 'P1');
  expect(matching.length).toBeGreaterThan(0);
  await expect(page.getByText(new RegExp(`${matching.length} of .* loaded alerts match`))).toBeVisible();

  await page.getByRole('textbox', { name: 'Workflow name' }).fill('P1 incident channel');
  await page.getByRole('combobox', { name: 'Trigger', exact: true }).selectOption('updated');
  await page.getByRole('combobox', { name: 'Action in Jira' }).selectOption('slack');
  await page.getByRole('textbox', { name: 'Message contains' }).fill('nonexistent workflow message 174237');
  await expect(page.getByText(/0 of .* loaded alerts match/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Message contains' }).clear();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved in this browser.')).toBeVisible();
  await page.reload();
  await page.getByRole('combobox', { name: 'Saved drafts' }).selectOption({ label: 'P1 incident channel' });
  await expect(page.getByRole('combobox', { name: 'Action in Jira' })).toHaveValue('slack');
  await expect(page.getByLabel('Jira setup checklist')).toHaveValue(/Alert updated[\s\S]+Send Slack message/);
  await page.getByRole('button', { name: 'Copy checklist' }).click();
  await expect(page.getByText('Checklist copied')).toBeVisible();
  await page.getByRole('button', { name: 'Delete draft' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('Draft deleted. Jira rules were not changed.')).toBeVisible();
  expect(writes).toEqual([]);
});

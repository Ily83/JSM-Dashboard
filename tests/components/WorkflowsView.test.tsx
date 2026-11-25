// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowsView } from '../../src/components/WorkflowsView';
import { newWorkflow, type WorkflowDraft } from '../../src/lib/workflows';
import { workflowStore } from '../../src/state/workflows';
import { makeAlert } from '../fixtures';
import { jsonResponse, mockApi, renderWithClient } from './helpers';

const DAY = 86_400_000;
const ALERTS = [
  makeAlert({ id: 'a1', priority: 'P1', status: 'open', summary: 'Disk full on db-1', rawSource: 'azure', createdAt: 4 * DAY, responders: [{ id: 'team-a', type: 'team', name: 'Team A' }] }),
  makeAlert({ id: 'a2', priority: 'P1', status: 'acked', summary: 'CPU high on web-2', rawSource: 'nagios', createdAt: 3 * DAY }),
  makeAlert({ id: 'a3', priority: 'P2', status: 'open', summary: 'Disk full on db-2', rawSource: 'azure', createdAt: 2 * DAY }),
  makeAlert({ id: 'a4', priority: 'P3', status: 'closed', summary: 'Backup finished late', rawSource: 'azure', createdAt: DAY }),
];
const TEAMS = [
  { id: 'team-a', name: 'Team A' },
  { id: 'team-b', name: 'Team B' },
];

function renderView(props: Partial<Parameters<typeof WorkflowsView>[0]> = {}) {
  const user = userEvent.setup();
  renderWithClient(<WorkflowsView alerts={ALERTS} site="example.atlassian.net" ready limited={false} {...props} />);
  return { user };
}

const checklist = () => (screen.getByRole('textbox', { name: 'Jira setup checklist' }) as HTMLTextAreaElement).value;
const draft = (name: string, overrides: Partial<WorkflowDraft> = {}): WorkflowDraft => ({ ...newWorkflow(`wf-${name.replaceAll(' ', '-')}`), name, ...overrides });

beforeEach(() => {
  workflowStore.set([]);
  mockApi({ 'GET /api/directory/teams': TEAMS });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WorkflowsView', () => {
  it('previews the loaded alerts that match the draft', async () => {
    const { user } = renderView();
    // The new draft matches P1 alerts.
    expect(screen.getByText(/2 of 4 loaded alerts match/)).toBeTruthy();
    const preview = screen.getByRole('region', { name: 'Preview matching alerts' });
    expect(within(preview).getByText('Disk full on db-1')).toBeTruthy();
    expect(within(preview).queryByText('Disk full on db-2')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Priority'), '');
    expect(screen.getByText(/4 of 4 loaded alerts match/)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Status'), 'open');
    expect(screen.getByText(/2 of 4 loaded alerts match/)).toBeTruthy();

    await user.type(screen.getByLabelText('Jira source (exact)'), 'azure');
    await user.type(screen.getByLabelText('Message contains (case-sensitive)'), 'Disk');
    expect(screen.getByText(/2 of 4 loaded alerts match/)).toBeTruthy();
    expect(checklist()).toContain('{{alert.status}} equals "open"');
    expect(checklist()).toContain('{{alert.source}} equals "azure"');
    expect(checklist()).toContain('{{alert.message}} contains "Disk"');

    await user.type(screen.getByLabelText('Message contains (case-sensitive)'), ' nothing');
    expect(screen.getByText(/0 of 4 loaded alerts match/)).toBeTruthy();
    expect(within(preview).queryByRole('table')).toBeNull();
  });

  it('says when no list is loaded or the list is incomplete', () => {
    renderView({ ready: false, limited: true });
    expect(screen.getByText('No alert list loaded yet.')).toBeTruthy();
    expect(screen.getByText(/limited or stale/)).toBeTruthy();
  });

  it('shows the newest 30 matches only', () => {
    const many = Array.from({ length: 35 }, (_, i) => makeAlert({ id: `p${i}`, priority: 'P1', createdAt: i * 1000, summary: `Alert ${i}` }));
    renderView({ alerts: many });
    expect(screen.getByText(/35 of 35 loaded alerts match/).textContent).toContain('showing newest 30');
    expect(screen.getByText('Alert 34')).toBeTruthy();
    expect(screen.queryByText('Alert 4')).toBeNull();
  });

  it('scopes the draft to a Jira team', async () => {
    const { user } = renderView();
    const teamSelect = screen.getByLabelText('Team scope');
    await within(teamSelect).findByRole('option', { name: 'Team B' });
    await user.selectOptions(teamSelect, 'team-a');
    expect(checklist()).toMatch(/^1\. Open Team A → Operations → Automation\./);
    expect(screen.getByText(/1 of 4 loaded alerts match/)).toBeTruthy();

    await user.selectOptions(teamSelect, '');
    expect(checklist()).toMatch(/^1\. Open Jira Settings → System → Global automation\./);
  });

  it('warns when the Jira teams cannot be loaded', async () => {
    mockApi({ 'GET /api/directory/teams': () => jsonResponse({ error: 'Jira is down' }, 503) });
    renderView();
    expect(await screen.findByText('Could not load Jira teams.')).toBeTruthy();
  });

  it('describes the chosen trigger and action in the checklist', async () => {
    const { user } = renderView();
    await user.type(screen.getByLabelText('Workflow name'), 'Page the team');
    await user.selectOptions(screen.getByLabelText('Trigger'), 'statusChanged');
    await user.selectOptions(screen.getByLabelText('Action in Jira'), 'slack');
    expect(checklist()).toContain('Create a flow named "Page the team" and choose the “Alert status changed” trigger.');
    expect(checklist()).toContain('Add “Send Slack message”. Choose an approved connection');
  });

  it('saves, updates and deletes a draft in the browser', async () => {
    const { user } = renderView();
    const save = screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.type(screen.getByLabelText('Workflow name'), 'P1 escalation');
    expect(save.disabled).toBe(false);
    await user.click(save);
    expect(screen.getByText('Draft saved in this browser.')).toBeTruthy();
    expect(workflowStore.get().map((d) => d.name)).toEqual(['P1 escalation']);
    const saved = screen.getByLabelText('Saved drafts') as HTMLSelectElement;
    expect(saved.selectedOptions[0].textContent).toBe('P1 escalation');
    // Nothing changed since the save.
    expect(save.disabled).toBe(true);

    await user.type(screen.getByLabelText('Workflow name'), ' v2');
    expect(screen.queryByText('Draft saved in this browser.')).toBeNull();
    await user.click(save);
    expect(workflowStore.get().map((d) => d.name)).toEqual(['P1 escalation v2']);

    await user.click(screen.getByRole('button', { name: 'Delete draft' }));
    expect(screen.getByText('Delete this local draft?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete this local draft?')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Delete draft' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(screen.getByText('Draft deleted. Jira rules were not changed.')).toBeTruthy();
    expect(workflowStore.get()).toEqual([]);
    expect((screen.getByLabelText('Workflow name') as HTMLInputElement).value).toBe('');
  });

  it('opens a saved draft and starts a new one', async () => {
    workflowStore.set([draft('Old team flow', { teamId: 'team-x', teamName: 'Old team', priority: 'P2' }), draft('Second')]);
    const { user } = renderView();
    await user.selectOptions(screen.getByLabelText('Saved drafts'), 'wf-Old-team-flow');
    expect((screen.getByLabelText('Workflow name') as HTMLInputElement).value).toBe('Old team flow');
    // A team that is no longer listed by Jira stays selectable under its saved name.
    expect(within(screen.getByLabelText('Team scope')).getByRole('option', { name: 'Old team' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'New draft' }));
    expect((screen.getByLabelText('Workflow name') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Delete draft' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Saved drafts'), 'wf-Second');
    await user.selectOptions(screen.getByLabelText('Saved drafts'), '');
    expect((screen.getByLabelText('Workflow name') as HTMLInputElement).value).toBe('');
  });

  it('refuses a new draft once the limit is reached', async () => {
    workflowStore.set(Array.from({ length: 50 }, (_, i) => draft(`Flow ${i}`)));
    const { user } = renderView();
    expect(screen.getByText('Delete an existing draft to save a new one.')).toBeTruthy();
    await user.type(screen.getByLabelText('Workflow name'), 'One more');
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says when the browser cannot store the draft', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { user } = renderView();
    await user.type(screen.getByLabelText('Workflow name'), 'Unsaved');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText('Browser storage unavailable. Your change is not saved after reload.')).toBeTruthy();
  });

  it('copies the checklist and links to Jira', async () => {
    const { user } = renderView();
    expect(screen.getByRole('link', { name: 'Open Jira' }).getAttribute('href')).toBe('https://example.atlassian.net');
    await user.click(screen.getByRole('button', { name: 'Copy checklist' }));
    expect(await screen.findByText('Checklist copied')).toBeTruthy();
    expect(await navigator.clipboard.readText()).toBe(checklist());
  });

  it('asks to copy by hand when the clipboard is blocked', async () => {
    const { user } = renderView({ site: null });
    expect(screen.queryByRole('link', { name: 'Open Jira' })).toBeNull();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy checklist' }));
    await waitFor(() => expect(screen.getByText('Select and copy the checklist above.')).toBeTruthy());
  });
});

// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionId } from '../../shared/actions';
import type { Alert, AlertDetail } from '../../shared/types';
import { DetailPanel } from '../../src/components/DetailPanel';
import { DEFAULT_PREFS, prefsStore } from '../../src/state/prefs';
import { makeAlert } from '../fixtures';
import { jsonResponse, makeStatus, mockApi, never, renderWithClient, type ApiRoute } from './helpers';

const T = Date.UTC(2026, 10, 20, 8, 0);
const ROW: Alert = makeAlert({
  id: 'a1',
  tinyId: '101',
  priority: 'P1',
  summary: 'Disk full on db-1',
  customers: ['Acme'],
  service: 'Storage',
  responders: [
    { id: 'team-a', type: 'team', name: 'Ops' },
    { id: 'me-1', type: 'user' },
  ],
  source: 'Azure Monitor',
  rawSource: 'azure',
  entity: 'db-1',
  alias: 'disk-db1',
  integrationType: 'AzureMonitor',
  createdAt: T,
  updatedAt: T + 60_000,
  lastOccurredAt: T + 120_000,
  count: 7,
  url: 'https://example.atlassian.net/jira/ops/alerts/a1',
});
const DETAIL: AlertDetail = {
  ...ROW,
  description: 'The data disk is full.\nRunbook: https://wiki.example.com/disk-full',
  rawTags: ['disk', 'customer:Acme'],
  extraProperties: { Region: 'eu-west' },
  actions: ['Restart service'],
  seen: true,
  detailLoaded: true,
};
const WRITES: ActionId[] = ['acknowledge', 'unacknowledge', 'close', 'addNote', 'addTags', 'removeTags'];

function routes(overrides: Record<string, ApiRoute> = {}, actions: ActionId[] = []): Record<string, ApiRoute> {
  return {
    'GET /api/status': makeStatus({}, actions),
    'GET /api/alerts/a1': DETAIL,
    'GET /api/alerts/a1/notes': { values: [], hasMore: false },
    'GET /api/directory/me': { accountId: 'me-1', displayName: 'Priya Nair' },
    ...overrides,
  };
}

function renderPanel(alert: Alert | null = ROW) {
  const user = userEvent.setup();
  const onClose = vi.fn();
  renderWithClient(<DetailPanel alert={alert} alertId="a1" onClose={onClose} />);
  return { user, onClose, panel: screen.getByRole('complementary', { name: 'Alert details' }) };
}

/** The value next to a label in one of the definition lists. */
const field = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;

beforeEach(() => {
  prefsStore.set(DEFAULT_PREFS());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DetailPanel', () => {
  it('shows the alert from its row, then the description and properties from its detail', async () => {
    mockApi(routes());
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Disk full on db-1' })).toBeTruthy();
    expect(screen.getByText('#101')).toBeTruthy();
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(field('Service').textContent).toBe('Storage');
    expect(field('Assignee').textContent).toBe('Unassigned');
    expect(field('Responders').textContent).toBe('Ops, user me-1');
    expect(field('Source').textContent).toBe('Azure Monitor · azure');
    expect(field('Occurrences').textContent).toBe('7');
    expect(screen.getByText('Last occurred')).toBeTruthy();

    expect(await screen.findByText(/The data disk is full\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open runbook' }).getAttribute('href')).toBe('https://wiki.example.com/disk-full');
    expect(field('Region').textContent).toBe('eu-west');
    expect(field('Entity').textContent).toBe('db-1');
    expect(field('Alias').textContent).toBe('disk-db1');
    expect(field('Integration type').textContent).toBe('AzureMonitor');
    expect(field('Actions').textContent).toBe('Restart service');
    expect(screen.getByText('customer:Acme')).toBeTruthy();
  });

  it('links to Jira and offers no write action when the backend is read-only', async () => {
    mockApi(routes());
    renderPanel();
    expect(screen.getByRole('link', { name: 'Open in Jira' }).getAttribute('href')).toBe(ROW.url);
    expect(screen.getByRole('link', { name: 'Open in Jira' }).textContent).toBe('Open in Jira');
    await screen.findByText(/The data disk is full\./);
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'New note' })).toBeNull();
  });

  it('disables the Jira link without a URL (demo mode)', () => {
    mockApi(routes({ 'GET /api/alerts/a1': never }));
    renderPanel({ ...ROW, url: null });
    expect((screen.getByRole('button', { name: 'Open in Jira' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows placeholders while the detail loads', () => {
    mockApi(routes({ 'GET /api/alerts/a1': never }));
    const { panel } = renderPanel();
    expect(panel.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
  });

  it('loads an alert that is not in the list', async () => {
    mockApi(routes());
    renderPanel(null);
    expect(screen.getByText('Loading alert…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Disk full on db-1' })).toBeTruthy();
  });

  it('says when the alert cannot be found', async () => {
    mockApi(routes({ 'GET /api/alerts/a1': () => jsonResponse({ error: 'Alert a1 was not found.' }, 404) }));
    const { user, onClose } = renderPanel(null);
    expect(await screen.findByText('Alert a1 was not found.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the list data with the reason when the detail request failed', async () => {
    mockApi(routes({ 'GET /api/alerts/a1': { ...DETAIL, description: null, detailError: 'Jira did not answer in time.' } }));
    renderPanel({ ...ROW, ackTime: T + 1000, closeTime: T + 2000, snoozedUntil: T + 3000, status: 'closed' });
    expect(await screen.findByText('Jira did not answer in time.')).toBeTruthy();
    for (const label of ['Acknowledged', 'Closed', 'Snoozed until']) expect(screen.getByText(label, { selector: 'dt' })).toBeTruthy();
  });

  it('offers the allowed actions, names the current user and reports the outcome', async () => {
    const api = mockApi(
      routes(
        {
          'POST /api/alerts/a1/actions': { result: { state: 'done', message: 'Alert acknowledged' }, alert: null },
        },
        WRITES,
      ),
    );
    const { user } = renderPanel();
    const acknowledge = await screen.findByRole('button', { name: 'Acknowledge' });
    expect(screen.getByRole('link', { name: 'Open in Jira' }).textContent).toBe('Jira');
    await waitFor(() => expect(field('Responders').textContent).toBe('Ops, Priya Nair'));

    await user.click(acknowledge);
    expect((await screen.findByRole('status')).textContent).toContain('Alert acknowledged');
    expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual({ action: 'acknowledge' });

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Alert acknowledged')).toBeNull();
  });

  it('shows the error when Jira refuses an action', async () => {
    mockApi(routes({ 'POST /api/alerts/a1/actions': () => jsonResponse({ error: 'Jira refused the request' }, 502) }, WRITES));
    const { user } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Jira refused the request');
  });

  it('adds a note', async () => {
    const api = mockApi(routes({ 'POST /api/alerts/a1/actions': { result: { state: 'pending', message: null }, alert: null } }, WRITES));
    const { user } = renderPanel();
    const note = await screen.findByRole('textbox', { name: 'New note' });
    await user.type(note, 'Looking into it');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect((await screen.findByRole('status')).textContent).toContain('Add note: sent, not confirmed by Jira yet');
    expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual({ action: 'addNote', note: 'Looking into it' });
  });

  it('answers its keyboard shortcuts', async () => {
    mockApi(routes({}, WRITES));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user, onClose } = renderPanel();
    const note = await screen.findByRole('textbox', { name: 'New note' });

    await user.keyboard('w');
    expect(screen.getByRole('button', { name: 'Stop watching' }).getAttribute('aria-pressed')).toBe('true');
    expect(prefsStore.get().watchList).toEqual(['a1']);

    await user.keyboard('o');
    expect(open).toHaveBeenCalledWith(ROW.url, '_blank', 'noopener,noreferrer');

    await user.keyboard('n');
    expect(document.activeElement).toBe(note);
    // Typing in the note does not trigger the shortcuts.
    await user.keyboard('w');
    expect(prefsStore.get().watchList).toEqual(['a1']);

    note.blur();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('watches and copies with its buttons', async () => {
    mockApi(routes());
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Watch' }));
    expect(prefsStore.get().watchList).toEqual(['a1']);
    await user.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(prefsStore.get().watchList).toEqual([]);

    const copy = screen.getByRole('button', { name: 'Copy alert ID' });
    await user.click(copy);
    await waitFor(() => expect(copy.getAttribute('data-tip')).toBe('Copied'));
    expect(await navigator.clipboard.readText()).toBe('a1');
  });

  it('loads the activity log only when it is opened', async () => {
    const api = mockApi(
      routes({
        'GET /api/alerts/a1/logs': { values: [{ time: T, type: 'system', text: 'Alert created', owner: 'Jira' }], hasMore: false },
        'GET /api/alerts/a1/attachments': { values: [{ id: 'f1', name: 'trace.log', insertedAt: T }], hasMore: false },
      }),
    );
    const { user } = renderPanel();
    await screen.findByText(/The data disk is full\./);
    expect(api.calls.some((call) => call.path.endsWith('/logs'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('Alert created')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Attachments' }));
    const attachments = screen.getByRole('button', { name: 'Attachments' }).closest('section')!;
    expect(await within(attachments).findByText('trace.log')).toBeTruthy();
  });
});

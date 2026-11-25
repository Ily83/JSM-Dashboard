// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION_IDS, type ActionId } from '../../shared/actions';
import type { Alert, AlertDetail } from '../../shared/types';
import { AlertMenu, type AlertContextMenu } from '../../src/components/actions/AlertMenu';
import { makeAlert } from '../fixtures';
import { jsonResponse, mockApi, never, renderWithClient } from './helpers';

const OPEN = makeAlert({ id: 'o1', tinyId: '101', priority: 'P2', status: 'open', responders: [{ id: 'team-a', type: 'team', name: 'Team A' }] });
const ACKED = makeAlert({ id: 'k1', tinyId: '102', status: 'acked', acknowledged: true });
const CLOSED = makeAlert({ id: 'c1', tinyId: '103', status: 'closed', acknowledged: true });
const ALL: ReadonlySet<ActionId> = new Set(ACTION_IDS);

function detail(alert: Alert, actions: string[]): AlertDetail {
  return { ...alert, description: null, rawTags: [], extraProperties: {}, actions, seen: null, detailLoaded: true };
}

function renderMenu(selected: Alert[], options: { allowed?: ReadonlySet<ActionId>; busy?: boolean; alertId?: string | null } = {}) {
  const user = userEvent.setup();
  const menu: AlertContextMenu = {
    anchor: { kind: 'point', x: 40, y: 60 },
    alertId: options.alertId === undefined ? (selected[0]?.id ?? null) : options.alertId,
    restoreFocus: vi.fn(),
  };
  const props = { menu, selected, allowed: options.allowed ?? ALL, busy: options.busy ?? false, onRun: vi.fn(), onOpenAlert: vi.fn(), onClose: vi.fn() };
  renderWithClient(<AlertMenu {...props} />);
  return { user, ...props, restoreFocus: menu.restoreFocus as ReturnType<typeof vi.fn> };
}

const item = (name: RegExp | string) => screen.getByRole('menuitem', { name });
const reason = (name: RegExp | string) => item(name).getAttribute('data-tip');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlertMenu', () => {
  it('lists the actions at the anchor and focuses the first one', () => {
    renderMenu([OPEN]);
    const menu = screen.getByRole('menu', { name: 'Alert actions' });
    expect(menu.closest<HTMLElement>('[data-context-menu]')?.style.left).toBe('40px');
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(document.activeElement).toBe(item('Open alert details'));
    expect(within(menu).getAllByRole('separator')).toHaveLength(3);
  });

  it('explains why actions are unavailable', () => {
    renderMenu([ACKED, CLOSED], { allowed: new Set<ActionId>(['acknowledge', 'unacknowledge', 'close', 'customAction', 'addNote']), alertId: null });
    expect(screen.queryByRole('menuitem', { name: 'Open alert details' })).toBeNull();
    expect(reason(/^Acknowledge/)).toBe('Already acknowledged');
    expect(item(/^Unacknowledge/).getAttribute('aria-disabled')).toBeNull();
    expect(reason(/^Assign/)).toBe('Turned off in the backend');
    expect(reason(/^Run action/)).toBe('Custom actions are specific to one alert');
    expect(screen.getByText('Disabled actions must be enabled in the backend.')).toBeTruthy();
    // Counts are shown when several alerts are selected.
    expect(item(/^Close/).textContent).toContain('1');
  });

  it('disables the actions while another action runs', () => {
    renderMenu([CLOSED], { busy: true });
    expect(reason(/^Close/)).toBe('Another action is running');
  });

  it('disables actions that closed alerts do not accept', () => {
    renderMenu([CLOSED]);
    expect(reason(/^Close/)).toBe('Not available on closed alerts');
    expect(item(/^Add note/).getAttribute('aria-disabled')).toBeNull();
    expect(reason(/^Snooze/)).toBe('Not available on closed alerts');
  });

  it('moves focus with the arrow keys, Home and End', async () => {
    const { user } = renderMenu([OPEN]);
    const items = screen.getAllByRole('menuitem');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(items[items.length - 1]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(items[items.length - 1]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(items[0]);
  });

  it('closes on Escape and gives focus back', async () => {
    const { user, onClose, restoreFocus } = renderMenu([OPEN]);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it('closes on Tab', async () => {
    const { user, onClose } = renderMenu([OPEN]);
    await user.keyboard('{Tab}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without moving focus on a pointer press elsewhere', () => {
    const { onClose, restoreFocus } = renderMenu([OPEN]);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it('closes when the page is scrolled by hand', () => {
    const { onClose } = renderMenu([OPEN]);
    fireEvent.wheel(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when focus leaves it', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const { onClose } = renderMenu([OPEN]);
    fireEvent.blur(item('Open alert details'), { relatedTarget: outside });
    expect(onClose).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  it('opens the alert details', async () => {
    const { user, onOpenAlert, onClose } = renderMenu([OPEN]);
    await user.click(item('Open alert details'));
    expect(onOpenAlert).toHaveBeenCalledWith('o1');
    expect(onClose).toHaveBeenCalled();
  });

  it('runs a one-alert action straight from its key', async () => {
    const { user, onRun, onClose } = renderMenu([OPEN]);
    await user.keyboard('a');
    expect(onRun).toHaveBeenCalledWith({ action: 'acknowledge' }, undefined, [OPEN], 0);
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores a disabled action', async () => {
    const { user, onRun } = renderMenu([ACKED]);
    await user.keyboard('a');
    await user.click(item(/^Acknowledge/));
    expect(onRun).not.toHaveBeenCalled();
  });

  it('asks before closing, and Cancel or Escape go back to the list', async () => {
    const { user, onRun, onClose } = renderMenu([OPEN, ACKED, CLOSED], { alertId: null });
    await user.keyboard('c');
    const question = screen.getByRole('dialog', { name: 'Close 2 alerts?' });
    expect(within(question).getByText('1 skipped')).toBeTruthy();

    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(item(/^Close/));

    await user.click(item(/^Close/));
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(item(/^Close/));

    await user.click(item(/^Close/));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onRun).toHaveBeenCalledWith({ action: 'close' }, undefined, [OPEN, ACKED], 1);
    expect(onClose).toHaveBeenCalled();
  });

  it('sets the priority from its picker', async () => {
    const { user, onRun } = renderMenu([OPEN]);
    await user.click(item('Change priority…'));
    const picker = screen.getByRole('dialog', { name: 'Change priority' });
    expect((within(picker).getByRole('button', { name: 'Priority P2' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(picker).getByRole('button', { name: 'Back' }));
    expect(document.activeElement).toBe(item('Change priority…'));

    await user.click(item('Change priority…'));
    await user.click(screen.getByRole('button', { name: 'Priority P1' }));
    expect(onRun).toHaveBeenCalledWith({ action: 'priority', priority: 'P1' }, undefined, [OPEN], 0);
  });

  it('keeps Tab inside a picker', async () => {
    const { user } = renderMenu([OPEN]);
    await user.click(item('Change priority…'));
    const picker = screen.getByRole('dialog', { name: 'Change priority' });
    const controls = within(picker).getAllByRole('button').filter((button) => !(button as HTMLButtonElement).disabled);
    controls.at(-1)!.focus();
    await user.tab();
    expect(document.activeElement).toBe(controls[0]);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(controls.at(-1));
  });

  it('adds a note, with Ctrl+Enter, after asking when several alerts are selected', async () => {
    const { user, onRun } = renderMenu([OPEN, ACKED], { alertId: null });
    await user.click(item(/^Add note/));
    const note = screen.getByRole('textbox', { name: 'Note' });
    expect(document.activeElement).toBe(note);
    expect((screen.getByRole('button', { name: 'Add note' }) as HTMLButtonElement).disabled).toBe(true);

    await user.type(note, 'Investigating');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByRole('dialog', { name: 'Add note to 2 alerts?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(onRun).toHaveBeenCalledWith({ action: 'addNote', note: 'Investigating' }, undefined, [OPEN, ACKED], 0);
  });

  it('validates tags before adding them', async () => {
    const { user, onRun } = renderMenu([OPEN]);
    await user.click(item(/^Add tags/));
    const tags = screen.getByRole('textbox', { name: 'Tags' });
    await user.type(tags, Array.from({ length: 21 }, (_, i) => `t${i}`).join(','));
    expect(screen.getByRole('alert').textContent).toBe('Up to 20 tags, 100 characters each');
    expect(tags.getAttribute('aria-invalid')).toBe('true');

    await user.clear(tags);
    await user.type(tags, 'db, customer:Acme, db{Enter}');
    expect(onRun).toHaveBeenCalledWith({ action: 'addTags', tags: ['db', 'customer:Acme'] }, undefined, [OPEN], 0);
  });

  it('removes tags', async () => {
    const { user, onRun } = renderMenu([OPEN]);
    await user.click(item(/^Remove tags/));
    await user.type(screen.getByRole('textbox', { name: 'Tags' }), 'old');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRun).toHaveBeenCalledWith({ action: 'removeTags', tags: ['old'] }, undefined, [OPEN], 0);
  });

  it('runs one of the alert’s custom actions after asking', async () => {
    mockApi({ 'GET /api/alerts/o1': detail(OPEN, ['Restart service']) });
    const { user, onRun } = renderMenu([OPEN]);
    await user.click(item(/^Run action/));
    await user.click(await screen.findByRole('button', { name: 'Restart service' }));
    expect(screen.getByRole('dialog', { name: 'Run “Restart service” on 1 alert?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(onRun).toHaveBeenCalledWith({ action: 'customAction', actionName: 'Restart service' }, undefined, [OPEN], 0);
  });

  it('waits for the custom actions of the alert', async () => {
    mockApi({ 'GET /api/alerts/o1': never });
    const { user } = renderMenu([OPEN]);
    await user.click(item(/^Run action/));
    expect(screen.getByText('Loading actions…')).toBeTruthy();
  });

  it('says when an alert has no custom actions', async () => {
    mockApi({ 'GET /api/alerts/o1': detail(OPEN, []) });
    const { user } = renderMenu([OPEN]);
    await user.click(item(/^Run action/));
    expect(await screen.findByText('No custom actions')).toBeTruthy();
  });

  it('shows the error when custom actions cannot be loaded', async () => {
    mockApi({ 'GET /api/alerts/o1': () => jsonResponse({ error: 'Alert not found' }, 404) });
    const { user } = renderMenu([OPEN]);
    await user.click(item(/^Run action/));
    expect((await screen.findByRole('alert')).textContent).toBe('Alert not found');
  });

  it('assigns to the current user or to someone found by name', async () => {
    mockApi({
      'GET /api/directory/me': { accountId: 'me-1', displayName: 'Priya Nair' },
      'GET /api/directory/users': ({ search }: { search: URLSearchParams }) => (search.get('query') === 'jo' ? [{ accountId: 'u-2', displayName: 'Jo Smith' }] : []),
    });
    const { user, onRun } = renderMenu([OPEN]);
    await user.click(item(/^Assign/));
    await user.type(screen.getByRole('textbox', { name: 'Search people' }), 'jo');
    await user.click(await screen.findByRole('button', { name: 'Jo Smith' }));
    expect(onRun).toHaveBeenCalledWith({ action: 'assign', accountId: 'u-2' }, 'Jo Smith', [OPEN], 0);
  });

  it('offers Assign to me', async () => {
    mockApi({ 'GET /api/directory/me': { accountId: 'me-1', displayName: 'Priya Nair' } });
    const { user, onRun } = renderMenu([OPEN, ACKED], { alertId: null });
    await user.click(item(/^Assign/));
    await user.click(await screen.findByRole('button', { name: 'Assign to me (Priya Nair)' }));
    expect(screen.getByRole('dialog', { name: 'Assign 2 alerts to Priya Nair?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(onRun).toHaveBeenCalledWith({ action: 'assign', accountId: 'me-1' }, 'Priya Nair', [OPEN, ACKED], 0);
  });

  it('snoozes for a preset duration', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 20, 12, 0));
    try {
      const { user, onRun } = renderMenu([OPEN]);
      await user.click(item(/^Snooze/));
      await user.click(screen.getByRole('button', { name: '1 h' }));
      expect(onRun).toHaveBeenCalledWith({ action: 'snooze', endTime: '2026-11-20T13:00:00.000Z' }, expect.any(String), [OPEN], 0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds a team as responder', async () => {
    mockApi({
      'GET /api/directory/teams': [{ id: 'team-b', name: 'Team B' }],
      'GET /api/directory/teams/team-a/escalations': [{ id: 'esc-1', name: 'Night escalation' }],
    });
    const { user, onRun } = renderMenu([OPEN]);
    await user.click(item(/^Add responder/));
    await user.click(await screen.findByRole('button', { name: 'Team B' }));
    expect(onRun).toHaveBeenCalledWith({ action: 'addResponder', responder: { type: 'team', id: 'team-b' } }, 'Team B', [OPEN], 0);
  });

  it('escalates through one of the alert’s team escalations', async () => {
    mockApi({ 'GET /api/directory/teams/team-a/escalations': [{ id: 'esc-1', name: 'Night escalation' }] });
    const { user, onRun } = renderMenu([OPEN]);
    await user.click(item(/^Escalate to next/));
    await user.click(await screen.findByRole('button', { name: 'Night escalation' }));
    expect(onRun).toHaveBeenCalledWith({ action: 'escalate', escalationId: 'esc-1' }, 'Night escalation', [OPEN], 0);
  });

  it('stays open while the directory is still loading', async () => {
    mockApi({ 'GET /api/directory/teams': never });
    const { user, onClose } = renderMenu([OPEN]);
    await user.click(item(/^Add responder/));
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

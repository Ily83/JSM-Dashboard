// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionId } from '../../shared/actions';
import type { Alert } from '../../shared/types';
import { BulkActionBar, type AlertContextMenu } from '../../src/components/actions/BulkActions';
import { makeAlert } from '../fixtures';
import { jsonResponse, mockApi, never, renderWithClient, type ApiRoute } from './helpers';

const OPEN = makeAlert({ id: 'o1', tinyId: '101', summary: 'Disk full', status: 'open', acknowledged: false });
const ACKED = makeAlert({ id: 'k1', tinyId: '102', summary: 'CPU high', status: 'acked', acknowledged: true });
const CLOSED = makeAlert({ id: 'c1', tinyId: '103', summary: 'Backup late', status: 'closed', acknowledged: true });
const BULK: ReadonlySet<ActionId> = new Set<ActionId>(['acknowledge', 'unacknowledge', 'close', 'assign', 'addNote']);

const done = { result: { state: 'done', message: null }, alert: null };
const pending = { result: { state: 'pending', message: null }, alert: null };
const refused = () => jsonResponse({ error: 'Jira refused the request' }, 502);

function actionRoutes(answers: Record<string, ApiRoute>): Record<string, ApiRoute> {
  return Object.fromEntries(Object.entries(answers).map(([id, answer]) => [`POST /api/alerts/${id}/actions`, answer]));
}

function renderBar(selected: Alert[], options: { allowed?: ReadonlySet<ActionId>; contextMenu?: AlertContextMenu | null } = {}) {
  const user = userEvent.setup();
  const props = {
    selected,
    allowed: options.allowed ?? BULK,
    onClear: vi.fn(),
    contextMenu: options.contextMenu ?? null,
    onOpenMenu: vi.fn(),
    onCloseMenu: vi.fn(),
    onOpenAlert: vi.fn(),
  };
  const view = renderWithClient(<BulkActionBar {...props} />);
  const rerender = (next: Partial<typeof props>) => {
    Object.assign(props, next);
    view.rerender(<BulkActionBar {...props} />);
  };
  return { user, props, rerender, bar: screen.getByRole('group', { name: 'Bulk actions' }) };
}

const status = () => screen.getByRole('status');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BulkActionBar', () => {
  it('is inert while nothing is selected', () => {
    const { bar } = renderBar([]);
    expect(bar.textContent).toContain('0 selected');
    for (const name of ['Acknowledge', 'Unacknowledge', 'Close', 'More actions']) {
      expect(within(bar).getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByRole('button', { name: 'Clear selection' })).toBeNull();
  });

  it('counts the selected alerts each action applies to', () => {
    renderBar([OPEN, ACKED, CLOSED]);
    expect(screen.getByRole('button', { name: 'Acknowledge 1' }).getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unacknowledge 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close 2' })).toBeTruthy();
  });

  it('shows only the actions the backend allows, and disables those that apply to none', () => {
    renderBar([CLOSED], { allowed: new Set<ActionId>(['acknowledge', 'close']) });
    expect(screen.queryByRole('button', { name: /^Unacknowledge/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Acknowledge 0' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Close 0' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('acknowledges a single alert at once and reports skipped ones', async () => {
    const api = mockApi(actionRoutes({ o1: done }));
    const { user, props } = renderBar([OPEN, ACKED, CLOSED]);
    await user.click(screen.getByRole('button', { name: 'Acknowledge 1' }));

    await waitFor(() => expect(status().textContent).toContain('1 alert acknowledged'));
    expect(status().textContent).toContain('2 skipped');
    expect(api.calls).toEqual([expect.objectContaining({ method: 'POST', path: '/api/alerts/o1/actions', body: { action: 'acknowledge' } })]);
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('asks before closing, and Cancel or Escape return to the buttons', async () => {
    const api = mockApi(actionRoutes({ o1: done, k1: done }));
    const { user } = renderBar([OPEN, ACKED, CLOSED]);

    await user.click(screen.getByRole('button', { name: 'Close 2' }));
    expect(screen.getByText('Close 2 alerts?')).toBeTruthy();
    expect(screen.getByText('1 skipped')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm' }));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Close 2 alerts?')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close 2' }));

    await user.click(screen.getByRole('button', { name: 'Close 2' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Close 2 alerts?')).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  it('closes the confirmed alerts and clears the selection', async () => {
    const api = mockApi(actionRoutes({ o1: done, k1: done }));
    const { user, props } = renderBar([OPEN, ACKED, CLOSED]);
    await user.click(screen.getByRole('button', { name: 'Close 2' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(status().textContent).toContain('2 alerts closed'));
    expect(api.calls.map((call) => call.path).sort()).toEqual(['/api/alerts/k1/actions', '/api/alerts/o1/actions']);
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('confirms a bulk acknowledge of several alerts', async () => {
    const many = Array.from({ length: 5 }, (_, i) => makeAlert({ id: `m${i}` }));
    const api = mockApi(actionRoutes(Object.fromEntries(many.map((a) => [a.id, done]))));
    const { user } = renderBar(many);
    await user.click(screen.getByRole('button', { name: 'Acknowledge 5' }));
    expect(screen.getByText('Acknowledge 5 alerts?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(status().textContent).toContain('5 alerts acknowledged'));
    expect(api.calls).toHaveLength(5);
  });

  it('lists failed alerts and keeps the selection', async () => {
    mockApi(actionRoutes({ o1: refused, k1: pending }));
    const { user, props } = renderBar([OPEN, ACKED]);
    await user.click(screen.getByRole('button', { name: 'Close 2' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    const failed = await screen.findByRole('button', { name: '1 failed' });
    expect(status().textContent).toContain('1 pending');
    expect(status().textContent).toContain('1 failed');
    expect(props.onClear).not.toHaveBeenCalled();

    await user.click(failed);
    const list = screen.getByRole('dialog', { name: 'Failed alerts' });
    expect(within(list).getByText('#101')).toBeTruthy();
    expect(within(list).getByText('Jira refused the request')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(status().textContent).toBe('');
    expect(screen.queryByRole('button', { name: '1 failed' })).toBeNull();
  });

  it('shows progress while an action runs and blocks a second one', async () => {
    mockApi(actionRoutes({ o1: never }));
    const { user, bar } = renderBar([OPEN, ACKED]);
    await user.click(screen.getByRole('button', { name: 'Acknowledge 1' }));

    expect(await within(bar).findByText('0 / 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unacknowledge 1' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Clear selection' })).toBeNull();
  });

  it('clears the selection on request', async () => {
    const { user, props } = renderBar([OPEN]);
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('opens the alert menu from More actions, by click or arrow key', async () => {
    const { user, props, rerender } = renderBar([OPEN]);
    const more = screen.getByRole('button', { name: 'More actions' });
    await user.click(more);
    expect(props.onOpenMenu).toHaveBeenCalledWith(expect.objectContaining({ alertId: 'o1', trigger: more }));

    rerender({ selected: [OPEN, ACKED] });
    more.focus();
    await user.keyboard('{ArrowDown}');
    expect(props.onOpenMenu).toHaveBeenLastCalledWith(expect.objectContaining({ alertId: null }));
  });

  it('closes the menu it opened when More actions is pressed again', async () => {
    const { user, props, rerender } = renderBar([OPEN]);
    const more = screen.getByRole('button', { name: 'More actions' });
    await user.click(more);
    const menu = props.onOpenMenu.mock.calls[0][0] as AlertContextMenu;
    rerender({ contextMenu: menu });

    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Alert actions' })).toBeTruthy();
    await user.click(more);
    expect(props.onCloseMenu).toHaveBeenCalled();
  });

  it('runs an action chosen in the menu', async () => {
    const api = mockApi(actionRoutes({ o1: done }));
    const menu: AlertContextMenu = { anchor: { kind: 'point', x: 20, y: 20 }, alertId: 'o1' };
    const { user, props } = renderBar([OPEN], { contextMenu: menu });
    await user.click(screen.getByRole('menuitem', { name: /^Acknowledge/ }));
    expect(props.onCloseMenu).toHaveBeenCalled();
    await waitFor(() => expect(status().textContent).toContain('1 alert acknowledged'));
    expect(api.calls).toHaveLength(1);
  });

  it('closes the menu when the selection becomes empty', () => {
    const menu: AlertContextMenu = { anchor: { kind: 'point', x: 20, y: 20 }, alertId: null };
    const { props } = renderBar([], { contextMenu: menu });
    expect(props.onCloseMenu).toHaveBeenCalled();
  });

  it('drops a pending question when the selection changes or a menu opens', async () => {
    const { user, rerender } = renderBar([OPEN, ACKED]);
    await user.click(screen.getByRole('button', { name: 'Close 2' }));
    expect(screen.getByText('Close 2 alerts?')).toBeTruthy();
    rerender({ selected: [OPEN] });
    expect(screen.queryByText(/alerts\?$/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Close 1' }));
    expect(screen.getByText('Close 1 alert?')).toBeTruthy();
    rerender({ contextMenu: { anchor: { kind: 'point', x: 0, y: 0 }, alertId: 'o1' } });
    expect(screen.queryByText('Close 1 alert?')).toBeNull();
  });
});

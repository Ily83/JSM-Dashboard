// @vitest-environment jsdom
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SortingState } from '@tanstack/react-table';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert } from '../../shared/types';
import type { AlertContextMenu } from '../../src/components/actions/BulkActions';
import { AlertTable } from '../../src/components/table/AlertTable';
import type { LaneBy } from '../../src/lib/tableItems';
import { DEFAULT_TABLE_LAYOUT, tableLayoutStore } from '../../src/state/tableLayout';
import { makeAlert } from '../fixtures';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 20, 12, 0);
const ALERTS: Alert[] = [
  makeAlert({ id: 'a1', tinyId: '101', priority: 'P2', summary: 'Disk full on db-1', customers: ['Acme'], createdAt: NOW - 3 * HOUR }),
  makeAlert({ id: 'a2', tinyId: '102', priority: 'P1', summary: 'CPU high on web-2', customers: ['Globex'], createdAt: NOW - 2 * HOUR }),
  makeAlert({ id: 'a3', tinyId: '103', priority: 'P3', summary: 'Backup late', status: 'closed', createdAt: NOW - HOUR }),
  makeAlert({ id: 'a4', tinyId: '104', priority: 'P4', summary: 'Memory warning', customers: ['Acme', 'Globex'], createdAt: NOW - 4 * HOUR }),
];

interface HarnessProps {
  alerts?: Alert[];
  selectedId?: string | null;
  followFocus?: boolean;
  sorting?: SortingState;
  initialSelection?: string[];
  selectable?: boolean;
  groupRepeats?: boolean;
  laneBy?: LaneBy;
}

const onSelect = vi.fn();
const onSortingChange = vi.fn();
const onSelectionChange = vi.fn();
const onContextMenu = vi.fn<(menu: AlertContextMenu) => void>();

/** The table is controlled: this keeps sorting and selection the way the application does. */
function Harness({ alerts = ALERTS, selectedId = null, followFocus = false, sorting: initialSorting = [], initialSelection = [], selectable = true, groupRepeats, laneBy }: HarnessProps) {
  const [sorting, setSorting] = useState(initialSorting);
  const [selection, setSelection] = useState<Set<string>>(() => new Set(initialSelection));
  return (
    <AlertTable
      alerts={alerts}
      selectedId={selectedId}
      followFocus={followFocus}
      onSelect={onSelect}
      sorting={sorting}
      onSortingChange={(next) => {
        onSortingChange(next);
        setSorting(next);
      }}
      density="compact"
      cellOptions={{ timeFormat: 'absolute', showTags: true, showOccurrences: true }}
      highlightCritical
      emptyState={<p>No alerts match</p>}
      selection={selectable ? selection : undefined}
      onSelectionChange={
        selectable
          ? (next) => {
              onSelectionChange(next);
              setSelection(next);
            }
          : undefined
      }
      onContextMenu={onContextMenu}
      groupRepeats={groupRepeats}
      laneBy={laneBy}
    />
  );
}

function renderTable(props: HarnessProps = {}) {
  const user = userEvent.setup();
  const view = render(<Harness {...props} />);
  return { user, ...view, grid: screen.getByRole('grid', { name: 'Alerts' }) };
}

/** Body rows in display order (the header row excluded). */
const bodyRows = () => screen.getAllByRole('row').slice(1);
const rowOf = (text: string) => screen.getByText(text).closest<HTMLElement>('[role="row"]')!;
const summaries = () => bodyRows().map((row) => row.querySelector('[data-tip]')?.textContent ?? '');
const lastSelection = () => [...(onSelectionChange.mock.lastCall?.[0] ?? [])].sort();

beforeEach(() => {
  // Only the clock is fixed (activity strips count the last 24 hours); timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  tableLayoutStore.set(DEFAULT_TABLE_LAYOUT());
  // jsdom has no layout: give the scroll container a size so the virtualiser renders rows.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  onSelect.mockReset();
  onSortingChange.mockReset();
  onSelectionChange.mockReset();
  onContextMenu.mockReset();
});

describe('AlertTable', () => {
  it('renders a grid with a header and one row per alert', () => {
    const { grid } = renderTable();
    expect(grid.getAttribute('aria-rowcount')).toBe('5');
    expect(grid.getAttribute('aria-multiselectable')).toBe('true');
    expect(bodyRows()).toHaveLength(4);
    expect(summaries()).toEqual(['Disk full on db-1', 'CPU high on web-2', 'Backup late', 'Memory warning']);
    expect(rowOf('CPU high on web-2').dataset.critical).toBe('true');
    expect(rowOf('Backup late').dataset.closed).toBe('true');
    // Hidden by default: the ID and Count columns.
    expect(screen.queryByRole('button', { name: 'ID' })).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(10);
  });

  it('shows the empty state when there are no alerts', () => {
    renderTable({ alerts: [] });
    expect(screen.getByText('No alerts match')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Select all 0 alerts' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('renders without a selection column when selection is off', () => {
    renderTable({ selectable: false });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('grid').getAttribute('aria-multiselectable')).toBeNull();
  });

  it('sorts by a column, toggles the direction and adds sort levels with Shift', async () => {
    const { user } = renderTable();
    const summaryHeader = () => screen.getByRole('button', { name: /^Summary/ }).closest('[role="columnheader"]')!;

    await user.click(screen.getByRole('button', { name: /^Summary/ }));
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: 'summary', desc: false }]);
    expect(summaryHeader().getAttribute('aria-sort')).toBe('ascending');
    expect(summaries()).toEqual(['Backup late', 'CPU high on web-2', 'Disk full on db-1', 'Memory warning']);

    await user.click(screen.getByRole('button', { name: /^Summary/ }));
    expect(summaryHeader().getAttribute('aria-sort')).toBe('descending');
    expect(summaries()[0]).toBe('Memory warning');

    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('button', { name: /^Priority/ }));
    await user.keyboard('{/Shift}');
    expect(onSortingChange).toHaveBeenLastCalledWith([
      { id: 'summary', desc: true },
      { id: 'priority', desc: false },
    ]);
    expect(screen.getByRole('button', { name: /^Priority/ }).textContent).toBe('Priority2');
  });

  it('opens an alert on click and marks the open one', async () => {
    const { user } = renderTable({ selectedId: 'a2' });
    expect(rowOf('CPU high on web-2').getAttribute('aria-selected')).toBe('true');
    expect(rowOf('Disk full on db-1').getAttribute('aria-selected')).toBe('false');
    await user.click(screen.getByText('Backup late'));
    expect(onSelect).toHaveBeenCalledWith('a3');
  });

  it('selects rows with their checkboxes, Shift for a range', async () => {
    const { user } = renderTable();
    await user.click(screen.getByRole('checkbox', { name: 'Select alert #101' }));
    expect(lastSelection()).toEqual(['a1']);
    expect(onSelect).not.toHaveBeenCalled();
    expect(rowOf('Disk full on db-1').dataset.checked).toBe('true');
    const all = screen.getByRole('checkbox', { name: 'Select all 4 alerts' }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);

    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select alert #103' }));
    await user.keyboard('{/Shift}');
    expect(lastSelection()).toEqual(['a1', 'a2', 'a3']);

    await user.click(screen.getByRole('checkbox', { name: 'Select alert #101' }));
    expect(lastSelection()).toEqual(['a2', 'a3']);
  });

  it('selects and clears all alerts from the header checkbox', async () => {
    const { user } = renderTable();
    await user.click(screen.getByRole('checkbox', { name: 'Select all 4 alerts' }));
    expect(lastSelection()).toEqual(['a1', 'a2', 'a3', 'a4']);
    const clear = screen.getByRole('checkbox', { name: 'Clear selection' }) as HTMLInputElement;
    expect(clear.checked).toBe(true);
    await user.click(clear);
    expect(lastSelection()).toEqual([]);
  });

  it('toggles a row with Ctrl+click and selects a range with Shift+click', async () => {
    const { user } = renderTable();
    await user.click(screen.getByText('Disk full on db-1'));
    expect(onSelect).toHaveBeenCalledWith('a1');

    await user.keyboard('{Control>}');
    await user.click(screen.getByText('Backup late'));
    await user.keyboard('{/Control}');
    expect(lastSelection()).toEqual(['a3']);

    await user.keyboard('{Shift>}');
    await user.click(screen.getByText('Memory warning'));
    await user.keyboard('{/Shift}');
    // The range starts at the row toggled last.
    expect(lastSelection()).toEqual(['a3', 'a4']);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('moves the focus with the keyboard and opens the focused alert', async () => {
    const { user } = renderTable();
    const rows = bodyRows();
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1, -1]);

    act(() => rows[0].focus());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toBe(bodyRows()[1]));
    expect(bodyRows()[1].tabIndex).toBe(0);
    await user.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toBe(bodyRows()[3]));
    await user.keyboard('{Home}');
    await waitFor(() => expect(document.activeElement).toBe(bodyRows()[0]));
    expect(onSelect).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('a1');
  });

  it('follows the focus with the open alert when the detail panel is open', async () => {
    const { user } = renderTable({ followFocus: true });
    act(() => bodyRows()[0].focus());
    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenCalledWith('a2');
  });

  it('toggles the focused row with X, Shift+X for a range', async () => {
    const { user } = renderTable();
    act(() => bodyRows()[1].focus());
    await user.keyboard('x');
    expect(lastSelection()).toEqual(['a2']);
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toBe(bodyRows()[2]));
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toBe(bodyRows()[3]));
    await user.keyboard('{Shift>}X{/Shift}');
    expect(lastSelection()).toEqual(['a2', 'a3', 'a4']);
  });

  it('opens the alert menu at the pointer on right-click and selects that row', () => {
    renderTable({ initialSelection: ['a1'] });
    fireEvent.contextMenu(screen.getByText('CPU high on web-2'), { button: 2, clientX: 140, clientY: 220 });
    expect(lastSelection()).toEqual(['a2']);
    expect(onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ anchor: { kind: 'point', x: 140, y: 220 }, alertId: 'a2' }));
  });

  it('keeps the selection when the menu opens on a selected row', () => {
    renderTable({ initialSelection: ['a1', 'a2'] });
    fireEvent.contextMenu(screen.getByText('CPU high on web-2'), { button: 2 });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('opens the alert menu with Shift+F10 against the row, and gives focus back', async () => {
    const { user } = renderTable();
    const row = bodyRows()[2];
    act(() => row.focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const menu = onContextMenu.mock.calls[0][0];
    expect(menu.anchor.kind).toBe('rect');
    expect(menu.alertId).toBe('a3');

    // The browser's own contextmenu event for the same key press does not open a second menu.
    fireEvent.contextMenu(row, { button: 0 });
    expect(onContextMenu).toHaveBeenCalledTimes(1);

    act(() => (document.activeElement as HTMLElement).blur());
    act(() => menu.restoreFocus?.());
    expect(document.activeElement).toBe(bodyRows()[2]);
  });

  it('collapses repeated alerts into a group row that expands', async () => {
    const repeated = [
      makeAlert({ id: 'g1', alias: 'disk-db1', summary: 'Disk 91% on db-1', createdAt: NOW - HOUR, count: 3 }),
      makeAlert({ id: 'g2', alias: 'disk-db1', summary: 'Disk 95% on db-1', createdAt: NOW - 2 * HOUR }),
      makeAlert({ id: 'g3', summary: 'Login failures', createdAt: NOW - 3 * HOUR }),
    ];
    const { user } = renderTable({ alerts: repeated, groupRepeats: true });
    expect(bodyRows()).toHaveLength(2);
    const group = bodyRows()[0];
    expect(group.dataset.group).toBe('true');
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(within(group).getByText('2 alerts · ×4')).toBeTruthy();
    expect(within(group).getByRole('img', { name: /^Last 24 h, per hour: 2 created/ })).toBeTruthy();

    await user.click(within(group).getByText('Disk 91% on db-1'));
    expect(bodyRows()).toHaveLength(4);
    expect(bodyRows()[0].getAttribute('aria-expanded')).toBe('true');
    expect(bodyRows()[1].dataset.child).toBe('true');

    act(() => bodyRows()[0].focus());
    await user.keyboard('{ArrowLeft}');
    expect(bodyRows()).toHaveLength(2);
    await user.keyboard('{ArrowRight}');
    expect(bodyRows()).toHaveLength(4);
    await user.keyboard('{Enter}');
    expect(bodyRows()).toHaveLength(2);
  });

  it('selects all alerts of a group with its checkbox', async () => {
    const repeated = [
      makeAlert({ id: 'g1', alias: 'disk-db1', summary: 'Disk 91% on db-1', createdAt: NOW - HOUR }),
      makeAlert({ id: 'g2', alias: 'disk-db1', summary: 'Disk 95% on db-1', createdAt: NOW - 2 * HOUR }),
    ];
    const { user } = renderTable({ alerts: repeated, groupRepeats: true, initialSelection: ['g2'] });
    const box = screen.getByRole('checkbox', { name: 'Select 2 alerts in this group' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    await user.click(box);
    expect(lastSelection()).toEqual(['g1', 'g2']);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('splits the rows into lanes that collapse', async () => {
    const { user } = renderTable({ laneBy: 'customer' });
    const lanes = bodyRows().filter((row) => row.dataset.lane === 'true');
    expect(lanes.map((lane) => lane.textContent)).toEqual([
      expect.stringContaining('Globex'),
      expect.stringContaining('Acme'),
      expect.stringContaining('No customer'),
    ]);
    // An alert with two customers appears in both lanes.
    expect(screen.getAllByText('Memory warning')).toHaveLength(2);
    expect(screen.getAllByLabelText(/^Also in: /)).toHaveLength(2);

    await user.click(screen.getByRole('checkbox', { name: 'Select 2 alerts in Acme' }));
    expect(lastSelection()).toEqual(['a1', 'a4']);

    const acme = lanes[1];
    await user.click(acme);
    expect(acme.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Disk full on db-1')).toBeNull();
    expect(screen.getAllByText('Memory warning')).toHaveLength(1);
  });

  it('resizes a column with the arrow keys and resets it on double-click', async () => {
    const { user } = renderTable();
    const resizer = screen.getByRole('separator', { name: 'Resize column Summary. Use left and right arrow keys.' });
    expect(resizer.getAttribute('aria-valuenow')).toBe('430');
    act(() => resizer.focus());
    await user.keyboard('{ArrowRight}');
    expect(tableLayoutStore.get().columnSizing.summary).toBe(446);
    expect(resizer.getAttribute('aria-valuenow')).toBe('446');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tableLayoutStore.get().columnSizing.summary).toBe(414);

    await user.dblClick(resizer);
    expect(resizer.getAttribute('aria-valuenow')).toBe('430');
  });

  it('moves a column by dragging its header', () => {
    renderTable();
    const status = screen.getByRole('button', { name: /^Status/ });
    const priorityHeader = screen.getByRole('button', { name: /^Priority/ }).closest<HTMLElement>('[role="columnheader"]')!;
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };

    fireEvent.dragStart(status, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'status');
    // jsdom has no DragEvent, so the event carries no pointer position: the column lands after the target.
    fireEvent.dragOver(priorityHeader, { dataTransfer });
    expect(priorityHeader.dataset.drop).toBe('after');
    fireEvent.drop(priorityHeader, { dataTransfer });

    expect(tableLayoutStore.get().columnOrder.slice(0, 3)).toEqual(['priority', 'status', 'summary']);
    fireEvent.dragEnd(status);
    expect(priorityHeader.dataset.drop).toBeUndefined();
  });

  describe('rectangle selection', () => {
    // Rows start below the 32 px header and are 30 px high (compact density).
    const rowY = (index: number) => 32 + index * 30 + 15;

    function layOut(grid: HTMLElement) {
      vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 1200, height: 600 }));
    }

    it('selects the rows a vertical drag covers, and the release does not open a row', async () => {
      const { grid } = renderTable();
      layOut(grid);
      const cell = screen.getByText('Disk full on db-1');
      fireEvent.pointerDown(cell, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 300, clientY: rowY(0) });
      fireEvent.pointerMove(cell, { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 302, clientY: rowY(2) });

      await waitFor(() => expect(lastSelection()).toEqual(['a1', 'a2', 'a3']));
      expect(grid.querySelector('[data-selection-box]')).not.toBeNull();

      fireEvent.pointerUp(cell, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 302, clientY: rowY(2) });
      expect(grid.querySelector('[data-selection-box]')).toBeNull();
      fireEvent.click(cell, { detail: 1 });
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('puts the previous selection back on Escape', async () => {
      const { grid } = renderTable({ initialSelection: ['a4'] });
      layOut(grid);
      const cell = screen.getByText('Disk full on db-1');
      fireEvent.pointerDown(cell, { pointerId: 2, pointerType: 'mouse', button: 0, buttons: 1, clientX: 300, clientY: rowY(0) });
      fireEvent.pointerMove(cell, { pointerId: 2, pointerType: 'mouse', buttons: 1, clientX: 300, clientY: rowY(1) });
      await waitFor(() => expect(lastSelection()).toEqual(['a1', 'a2']));

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(lastSelection()).toEqual(['a4']);
      expect(grid.querySelector('[data-selection-box]')).toBeNull();
    });

    it('leaves a sideways drag to text selection', () => {
      const { grid } = renderTable();
      layOut(grid);
      const cell = screen.getByText('Disk full on db-1');
      fireEvent.pointerDown(cell, { pointerId: 3, pointerType: 'mouse', button: 0, buttons: 1, clientX: 300, clientY: rowY(0) });
      fireEvent.pointerMove(cell, { pointerId: 3, pointerType: 'mouse', buttons: 1, clientX: 360, clientY: rowY(0) + 2 });
      fireEvent.pointerUp(cell, { pointerId: 3, pointerType: 'mouse', button: 0 });
      fireEvent.click(cell, { detail: 1 });
      expect(onSelectionChange).not.toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('ends the drag when the button was released outside the window', async () => {
      const { grid } = renderTable();
      layOut(grid);
      const cell = screen.getByText('Disk full on db-1');
      fireEvent.pointerDown(cell, { pointerId: 4, pointerType: 'mouse', button: 0, buttons: 1, clientX: 300, clientY: rowY(0) });
      fireEvent.pointerMove(cell, { pointerId: 4, pointerType: 'mouse', buttons: 1, clientX: 300, clientY: rowY(3) });
      await waitFor(() => expect(grid.querySelector('[data-selection-box]')).not.toBeNull());
      fireEvent.pointerMove(cell, { pointerId: 4, pointerType: 'mouse', buttons: 0, clientX: 300, clientY: rowY(3) });
      expect(grid.querySelector('[data-selection-box]')).toBeNull();
    });
  });
});

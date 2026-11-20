import { describe, expect, it } from 'vitest';
import type { Alert } from '../shared/types';
import { buildTableItems, type BuildOptions, type TableItem } from '../src/lib/tableItems';
import { arrowToggles, checkState, countSelected, navigationTarget } from '../src/components/table/tableHelpers';
import { makeAlert } from './fixtures';

const base: BuildOptions = { laneBy: 'off', groupRepeats: false, expanded: new Set(), collapsedLanes: new Set() };

const alerts: Alert[] = [
  makeAlert({ id: 'a', customers: ['Contoso'], alias: 'disk' }),
  makeAlert({ id: 'b', customers: ['Contoso'], alias: 'disk' }),
  makeAlert({ id: 'c', customers: ['Fabrikam'], alias: 'aks' }),
];

function first<K extends TableItem['kind']>(items: TableItem[], kind: K): Extract<TableItem, { kind: K }> {
  const item = items.find((i): i is Extract<TableItem, { kind: K }> => i.kind === kind);
  if (!item) throw new Error(`no ${kind} item`);
  return item;
}

describe('table keyboard navigation', () => {
  it('moves by one row, by a page, and to the first and last row', () => {
    expect(navigationTarget('ArrowDown', 3, 10, 50)).toBe(4);
    expect(navigationTarget('ArrowUp', 3, 10, 50)).toBe(2);
    expect(navigationTarget('PageDown', 3, 10, 50)).toBe(13);
    // The caller clamps to the table.
    expect(navigationTarget('PageUp', 3, 10, 50)).toBe(-7);
    expect(navigationTarget('Home', 3, 10, 50)).toBe(0);
    expect(navigationTarget('End', 3, 10, 50)).toBe(49);
  });

  it('leaves other keys alone', () => {
    for (const key of ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'x', 'a']) expect(navigationTarget(key, 3, 10, 50)).toBeUndefined();
  });

  it('opens a closed group with ArrowRight and closes an open one with ArrowLeft', () => {
    const closed = first(buildTableItems(alerts, { ...base, groupRepeats: true }), 'group');
    expect(arrowToggles(closed, 'ArrowRight')).toBe(true);
    expect(arrowToggles(closed, 'ArrowLeft')).toBe(false);
    const open = first(buildTableItems(alerts, { ...base, groupRepeats: true, expanded: new Set([closed.key]) }), 'group');
    expect(open.expanded).toBe(true);
    expect(arrowToggles(open, 'ArrowRight')).toBe(false);
    expect(arrowToggles(open, 'ArrowLeft')).toBe(true);
  });

  it('collapses an open lane with ArrowLeft and opens a collapsed one with ArrowRight', () => {
    const open = first(buildTableItems(alerts, { ...base, laneBy: 'customer' }), 'lane');
    expect(arrowToggles(open, 'ArrowLeft')).toBe(true);
    expect(arrowToggles(open, 'ArrowRight')).toBe(false);
    const collapsed = first(buildTableItems(alerts, { ...base, laneBy: 'customer', collapsedLanes: new Set([open.key]) }), 'lane');
    expect(collapsed.collapsed).toBe(true);
    expect(arrowToggles(collapsed, 'ArrowRight')).toBe(true);
    expect(arrowToggles(collapsed, 'ArrowLeft')).toBe(false);
  });

  it('does not toggle alert rows, missing rows or with other keys', () => {
    const items = buildTableItems(alerts, { ...base, groupRepeats: true });
    expect(arrowToggles(first(items, 'alert'), 'ArrowRight')).toBe(false);
    expect(arrowToggles(undefined, 'ArrowRight')).toBe(false);
    expect(arrowToggles(first(items, 'group'), 'Enter')).toBe(false);
  });
});

describe('table selection', () => {
  it('counts the selected alerts of a row', () => {
    expect(countSelected(alerts, new Set())).toBe(0);
    expect(countSelected(alerts, new Set(['a', 'c', 'other']))).toBe(2);
  });

  it('shows a group or lane checkbox as off, mixed or on', () => {
    expect(checkState(0, 3)).toBe(false);
    expect(checkState(2, 3)).toBe('mixed');
    expect(checkState(3, 3)).toBe(true);
  });
});

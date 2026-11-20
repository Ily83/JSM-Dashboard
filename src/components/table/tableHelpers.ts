import type { TableItem } from '../../lib/tableItems';

/** Keyboard and selection rules of the alert table, kept free of React so they can be tested. */

/** The row a navigation key moves the focus to, or undefined when the key does not move it. */
export function navigationTarget(key: string, index: number, page: number, count: number): number | undefined {
  const moves: Record<string, number> = {
    ArrowDown: index + 1,
    ArrowUp: index - 1,
    PageDown: index + page,
    PageUp: index - page,
    Home: 0,
    End: count - 1,
  };
  return key in moves ? moves[key] : undefined;
}

/** True when ArrowRight opens, or ArrowLeft closes, the group or lane in this row. */
export function arrowToggles(item: TableItem | undefined, key: string): boolean {
  if (key !== 'ArrowRight' && key !== 'ArrowLeft') return false;
  const open = key === 'ArrowRight';
  if (item?.kind === 'group') return item.expanded !== open;
  if (item?.kind === 'lane') return item.collapsed === open;
  return false;
}

/** How many of these alerts are selected. */
export function countSelected(alerts: ReadonlyArray<{ id: string }>, selection: ReadonlySet<string>): number {
  return alerts.reduce((n, a) => n + (selection.has(a.id) ? 1 : 0), 0);
}

/** Checkbox state of a row standing for `total` alerts, `selected` of them selected. */
export function checkState(selected: number, total: number): boolean | 'mixed' {
  if (selected === 0) return false;
  return selected === total ? true : 'mixed';
}

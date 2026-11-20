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

/** Pointer travel (px) before a press becomes a drag. */
export const DRAG_THRESHOLD = 6;

/**
 * What a mouse drag from a row becomes once it passes the threshold:
 * a rectangle selection when it starts in the checkbox column or goes mostly
 * up or down, else native text selection (copying a host name from a
 * summary). 'wait' until the pointer has moved far enough.
 */
export function dragMode(dx: number, dy: number, fromGutter: boolean, threshold = DRAG_THRESHOLD): 'wait' | 'rectangle' | 'text' {
  if (Math.hypot(dx, dy) < threshold) return 'wait';
  return fromGutter || Math.abs(dy) >= Math.abs(dx) ? 'rectangle' : 'text';
}

/** The row at a vertical position in the table's content (header included), clamped to the rows. */
export function rowAtContentY(y: number, headerHeight: number, rowHeight: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor((y - headerHeight) / rowHeight)));
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

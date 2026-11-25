import { alertsOfItem, type TableItem } from '../../lib/tableItems';

/** Rectangle and range selection of the alert table (AlertTable.tsx), kept free of React so they can be tested. */

/**
 * The selection from row `start` to row `end` (either way round): `base` plus
 * every alert of the rows between, both included. Lane headers add nothing.
 */
export function rowRangeSelection(items: readonly TableItem[], start: number, end: number, base?: Iterable<string>): Set<string> {
  const next = new Set(base);
  for (let i = Math.min(start, end); i <= Math.max(start, end); i += 1) {
    const item = items[i];
    if (item && item.kind !== 'lane') for (const alert of alertsOfItem(item)) next.add(alert.id);
  }
  return next;
}

/**
 * How far a rectangle drag scrolls the table per frame: up while the pointer
 * is within 32 px under `top` (the bottom of the sticky header), down within
 * 32 px above `bottom`, else not at all.
 */
export function edgeScrollStep(clientY: number, top: number, bottom: number): number {
  if (clientY < top + 32) return -12;
  if (clientY > bottom - 32) return 12;
  return 0;
}

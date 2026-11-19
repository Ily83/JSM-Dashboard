import type { ColumnSizingState, VisibilityState } from '@tanstack/react-table';
import { COLUMN_IDS, COLUMN_INFO, isColumnId, type ColumnId } from '../config/columns';
import { createPersistentStore, isRecord } from '../lib/store';

/** Which columns are shown, in what order, and how wide. */
export interface TableLayout {
  columnOrder: ColumnId[];
  columnVisibility: VisibilityState;
  columnSizing: ColumnSizingState;
}

export const DEFAULT_TABLE_LAYOUT = (): TableLayout => ({
  columnOrder: [...COLUMN_IDS],
  columnVisibility: Object.fromEntries(COLUMN_IDS.filter((id) => !COLUMN_INFO[id].defaultVisible).map((id) => [id, false])),
  columnSizing: {},
});

export function sanitizeTableLayout(stored: unknown, fallback: TableLayout = DEFAULT_TABLE_LAYOUT()): TableLayout {
  if (!isRecord(stored)) return fallback;

  // Keep the saved order, drop unknown ids, append columns added in a newer version.
  const saved = Array.isArray(stored.columnOrder) ? [...new Set(stored.columnOrder.filter(isColumnId))] : [];
  const columnOrder = [...saved, ...COLUMN_IDS.filter((id) => !saved.includes(id))];

  const columnVisibility: VisibilityState = { ...fallback.columnVisibility };
  if (isRecord(stored.columnVisibility)) {
    for (const [id, visible] of Object.entries(stored.columnVisibility)) {
      if (isColumnId(id) && typeof visible === 'boolean') columnVisibility[id] = visible;
    }
  }
  for (const id of COLUMN_IDS) if (!COLUMN_INFO[id].hideable) delete columnVisibility[id];

  const columnSizing: ColumnSizingState = {};
  if (isRecord(stored.columnSizing)) {
    for (const [id, size] of Object.entries(stored.columnSizing)) {
      if (isColumnId(id) && typeof size === 'number' && size >= 40 && size <= 2000) columnSizing[id] = Math.round(size);
    }
  }
  return { columnOrder, columnVisibility, columnSizing };
}

export const tableLayoutStore = createPersistentStore<TableLayout>('table:v1', DEFAULT_TABLE_LAYOUT, sanitizeTableLayout);

export function moveColumn(id: ColumnId, delta: -1 | 1): void {
  tableLayoutStore.set((layout) => {
    const order = [...layout.columnOrder];
    const from = order.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return layout;
    [order[from], order[to]] = [order[to]!, order[from]!];
    return { ...layout, columnOrder: order };
  });
}

export function setColumnVisible(id: ColumnId, visible: boolean): void {
  if (!COLUMN_INFO[id].hideable) return;
  tableLayoutStore.set((layout) => ({ ...layout, columnVisibility: { ...layout.columnVisibility, [id]: visible } }));
}

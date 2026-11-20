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

/** Keeps the saved order, drops unknown ids, appends columns added in a newer version. */
function sanitizeOrder(stored: unknown): ColumnId[] {
  const saved = Array.isArray(stored) ? [...new Set(stored.filter(isColumnId))] : [];
  return [...saved, ...COLUMN_IDS.filter((id) => !saved.includes(id))];
}

/** Saved visibility over the fallback; columns that cannot be hidden have no entry. */
function sanitizeVisibility(stored: unknown, fallback: VisibilityState): VisibilityState {
  const columnVisibility: VisibilityState = { ...fallback };
  if (isRecord(stored)) {
    for (const [id, visible] of Object.entries(stored)) {
      if (isColumnId(id) && typeof visible === 'boolean') columnVisibility[id] = visible;
    }
  }
  for (const id of COLUMN_IDS) if (!COLUMN_INFO[id].hideable) delete columnVisibility[id];
  return columnVisibility;
}

/** Saved widths of known columns between 40 and 2000 pixels. */
function sanitizeSizing(stored: unknown): ColumnSizingState {
  const columnSizing: ColumnSizingState = {};
  if (isRecord(stored)) {
    for (const [id, size] of Object.entries(stored)) {
      if (isColumnId(id) && typeof size === 'number' && size >= 40 && size <= 2000) columnSizing[id] = Math.round(size);
    }
  }
  return columnSizing;
}

export function sanitizeTableLayout(stored: unknown, fallback: TableLayout = DEFAULT_TABLE_LAYOUT()): TableLayout {
  if (!isRecord(stored)) return fallback;
  return {
    columnOrder: sanitizeOrder(stored.columnOrder),
    columnVisibility: sanitizeVisibility(stored.columnVisibility, fallback.columnVisibility),
    columnSizing: sanitizeSizing(stored.columnSizing),
  };
}

export const tableLayoutStore = createPersistentStore<TableLayout>('table:v1', DEFAULT_TABLE_LAYOUT, sanitizeTableLayout);

export function moveColumn(id: ColumnId, delta: -1 | 1): void {
  tableLayoutStore.set((layout) => {
    const order = [...layout.columnOrder];
    const from = order.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return layout;
    [order[from], order[to]] = [order[to], order[from]];
    return { ...layout, columnOrder: order };
  });
}

export function setColumnVisible(id: ColumnId, visible: boolean): void {
  if (!COLUMN_INFO[id].hideable) return;
  tableLayoutStore.set((layout) => ({ ...layout, columnVisibility: { ...layout.columnVisibility, [id]: visible } }));
}

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type MouseEvent, type PointerEvent } from 'react';
import { getCoreRowModel, getSortedRowModel, useReactTable, type Header, type SortingState, type Updater } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronRight, Copy } from 'lucide-react';
import type { Alert, Priority } from '../../../shared/types';
import type { AlertGroup } from '../../lib/alertGroups';
import { cn } from '../../lib/cn';
import { alertsOfItem, buildTableItems, itemKey, type LaneBy, type TableItem } from '../../lib/tableItems';
import { ActivityStrip } from '../ActivityStrip';
import type { AlertContextMenu } from '../actions/BulkActions';
import { CustomerBadge, PriorityBadge } from '../ui/badges';
import type { MenuAnchor } from '../ui/menuPlacement';
import { COLUMN_INFO, type ColumnId } from '../../config/columns';
import { isCritical } from '../../config/sections';
import { useStore } from '../../lib/store';
import type { Density } from '../../state/prefs';
import { tableLayoutStore, type TableLayout } from '../../state/tableLayout';
import { COLUMNS, renderCell, type CellOptions } from './columns';
import { arrowToggles, checkState, countSelected, dragMode, navigationTarget, rowAtContentY } from './tableHelpers';

/**
 * The alert table.
 *
 * Performance notes
 *  - Rows are virtualised: only the rows in view (plus a small overscan) exist
 *    in the DOM, so 30 alerts and 30,000 alerts scroll the same.
 *  - Column widths are CSS variables on the table element. Dragging a column
 *    edge updates one style attribute; no row re-renders until the drag ends.
 *  - Rows are memoised on the alert object. A background refresh that changes
 *    nothing, or changes three alerts, re-renders zero or three rows.
 *  - Column sizing, order and visibility live in a store outside React
 *    state; sorting belongs to the current view. Both are persisted.
 *
 * Optional features
 *  - Selection: checkboxes, Shift+click for a range, Ctrl/Cmd+click to
 *    toggle a row, and X to toggle the focused row. Dragging from the checkbox column,
 *    or mostly up or down from anywhere in a row, draws a selection
 *    rectangle (Ctrl adds, Esc cancels); dragging sideways selects text.
 *  - Alert menu: right-click, Shift+F10 or the ContextMenu key on a row.
 *  - Group repeats: alerts that share a group key (src/lib/alertGroups.ts)
 *    collapse into one expandable row showing distinct records, total
 *    occurrences and a 24-hour activity strip. Groups keep the position of
 *    their first sorted alert.
 *  - Lanes: the rows are split by customer, service or team, each lane with
 *    a collapsible header (src/lib/tableItems.ts). An alert with several
 *    customers appears in each of their lanes, marked as such.
 */

const HEADER_HEIGHT = 32;
const SELECT_WIDTH = 32;
export const ROW_HEIGHT: Record<Density, number> = { compact: 30, comfortable: 38, spacious: 48 };

interface AlertTableProps {
  alerts: Alert[];
  selectedId: string | null;
  /** True when the detail panel is open: arrow keys then move the selection too. */
  followFocus: boolean;
  onSelect: (id: string) => void;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  density: Density;
  cellOptions: CellOptions;
  highlightCritical: boolean;
  /** Shown instead of rows when there are none. */
  emptyState: ReactNode;
  /** When set, a checkbox column is shown. */
  selection?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
  onContextMenu?: (menu: AlertContextMenu) => void;
  groupRepeats?: boolean;
  laneBy?: LaneBy;
}

interface RowColumn {
  id: ColumnId;
  size: number;
}

/** A mouse press on a row that may become a rectangle selection. */
interface DragState {
  pointerId: number;
  /** Where the press happened, on screen, for the drag threshold. */
  downX: number;
  downY: number;
  /** The latest pointer position, on screen. */
  clientX: number;
  clientY: number;
  /** Where the press happened in the table's content (scroll offsets included): the box's fixed corner. */
  anchorX: number;
  anchorY: number;
  startIndex: number;
  /** Last row the box reached; the selection is only rebuilt when it changes. */
  endIndex: number;
  /** Started in the checkbox column: always a rectangle, never text. */
  fromGutter: boolean;
  /** Selection the drag adds to (Ctrl or Cmd held), else empty. */
  base: Set<string>;
  /** Selection before the drag, restored by Escape. */
  before: Set<string>;
  active: boolean;
}

function apply<T>(updater: Updater<T>, current: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater;
}

function patchLayout<K extends keyof TableLayout>(key: K, updater: Updater<TableLayout[K]>): void {
  tableLayoutStore.set((layout) => ({ ...layout, [key]: apply(updater, layout[key]) }));
}

export const AlertTable = memo(function AlertTable({
  alerts,
  selectedId,
  followFocus,
  onSelect,
  sorting,
  onSortingChange,
  density,
  cellOptions,
  highlightCritical,
  emptyState,
  selection,
  onSelectionChange,
  onContextMenu,
  groupRepeats = false,
  laneBy = 'off',
}: AlertTableProps) {
  const selectable = selection !== undefined && onSelectionChange !== undefined;
  const layoutPrefs = useStore(tableLayoutStore);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = ROW_HEIGHT[density];

  const table = useReactTable({
    data: alerts,
    columns: COLUMNS,
    getRowId: (alert) => alert.id,
    state: {
      sorting,
      columnOrder: layoutPrefs.columnOrder,
      columnVisibility: layoutPrefs.columnVisibility,
      columnSizing: layoutPrefs.columnSizing,
    },
    onSortingChange: (u) => onSortingChange(apply(u, sorting)),
    onColumnOrderChange: (u) => patchLayout('columnOrder', u as Updater<ColumnId[]>),
    onColumnVisibilityChange: (u) => patchLayout('columnVisibility', u),
    onColumnSizingChange: (u) => patchLayout('columnSizing', u),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
    enableMultiSort: true,
    maxMultiSortColCount: 3,
    enableSortingRemoval: true,
    defaultColumn: { maxSize: 1400 },
  });

  const rows = table.getRowModel().rows;
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const totalWidth = table.getTotalSize();
  const isResizing = Boolean(table.getState().columnSizingInfo.isResizingColumn);

  // Column widths as CSS variables: rows read them without re-rendering.
  const sizeVars: Record<string, string | number> = { '--table-width': `${totalWidth + (selectable ? SELECT_WIDTH : 0)}px` };
  for (const header of headers) sizeVars[`--w-${header.id}`] = header.getSize();

  // Rows need the real widths only for content decisions (how many badges
  // fit). That value is frozen during a drag and updated when it ends.
  const liveLayout = headers.map((h) => `${h.id}:${h.getSize()}`).join('|');
  const [layout, setLayout] = useState(liveLayout);
  if (!isResizing && layout !== liveLayout) setLayout(liveLayout);
  const rowColumns = useMemo<RowColumn[]>(
    () =>
      layout === ''
        ? []
        : layout.split('|').map((part) => {
            const [id, size] = part.split(':');
            return { id: id as ColumnId, size: Number(size) };
          }),
    [layout],
  );

  // ---- Lanes and grouping -------------------------------------------------
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedLanes, setCollapsedLanes] = useState<ReadonlySet<string>>(() => new Set());
  const items = useMemo<TableItem[]>(
    () => buildTableItems(rows.map((r) => r.original), { laneBy, groupRepeats, expanded, collapsedLanes }),
    [rows, laneBy, groupRepeats, expanded, collapsedLanes],
  );

  const toggleIn = (setter: typeof setExpanded) => (key: string) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleGroup = useCallback(toggleIn(setExpanded), []);
  const toggleLane = useCallback(toggleIn(setCollapsedLanes), []);
  // Group rows show activity up to now; refreshed with the data, not by a timer.
  const activityEnd = useMemo(() => Date.now(), [rows]);

  // ---- Selection -----------------------------------------------------------
  const selectionAnchor = useRef<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const dragSelection = useRef<DragState | null>(null);
  const dragFrame = useRef<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // The click that ends a rectangle drag, a text drag or a double-click must not open or toggle the row.
  const suppressClick = useRef(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
      dragCleanup.current?.();
    },
    [],
  );

  /** One frame of a rectangle drag: scroll at the edges, move the box, select the rows it covers. */
  const dragTick = () => {
    dragFrame.current = null;
    const drag = dragSelection.current;
    const element = scrollRef.current;
    if (!drag?.active || !element || !onSelectionChange) return;
    const rect = element.getBoundingClientRect();
    let step = 0;
    if (drag.clientY < rect.top + HEADER_HEIGHT + 32) step = -12;
    else if (drag.clientY > rect.bottom - 32) step = 12;
    const before = element.scrollTop;
    if (step) element.scrollTop += step;
    // The pointer in content coordinates, like the anchor, so the box stays on its rows while scrolling.
    const x = Math.max(rect.left, Math.min(rect.right, drag.clientX)) - rect.left + element.scrollLeft;
    const y = Math.max(rect.top + HEADER_HEIGHT, Math.min(rect.bottom, drag.clientY)) - rect.top + element.scrollTop;
    const box = boxRef.current;
    if (box) {
      box.style.left = `${Math.min(drag.anchorX, x)}px`;
      box.style.top = `${Math.min(drag.anchorY, y)}px`;
      box.style.width = `${Math.abs(x - drag.anchorX)}px`;
      box.style.height = `${Math.abs(y - drag.anchorY)}px`;
    }
    const end = rowAtContentY(y, HEADER_HEIGHT, rowHeight, itemsRef.current.length);
    if (end !== drag.endIndex) {
      drag.endIndex = end;
      const next = new Set(drag.base);
      for (let i = Math.min(drag.startIndex, end); i <= Math.max(drag.startIndex, end); i += 1) {
        const item = itemsRef.current[i];
        if (item && item.kind !== 'lane') for (const alert of alertsOfItem(item)) next.add(alert.id);
      }
      onSelectionChange(next);
    }
    // Keep scrolling while the pointer rests at an edge.
    if (step && element.scrollTop !== before) dragFrame.current = requestAnimationFrame(dragTick);
  };
  const scheduleDragTick = () => {
    dragFrame.current ??= requestAnimationFrame(dragTick);
  };
  const dragTickRef = useRef(dragTick);
  dragTickRef.current = dragTick;
  // The box element exists from this commit on: draw it at once rather than on the next move.
  useLayoutEffect(() => {
    if (!dragging) return;
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragTickRef.current();
  }, [dragging]);

  /** Ends a drag; `cancel` (Escape) puts back the selection from before it. */
  const endDrag = (cancel = false) => {
    const drag = dragSelection.current;
    if (!drag) return;
    dragSelection.current = null;
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
    if (!drag.active) return;
    dragCleanup.current?.();
    dragCleanup.current = null;
    if (scrollRef.current) scrollRef.current.style.userSelect = '';
    setDragging(false);
    if (cancel) {
      // The button is still down: its release must not click the row.
      suppressClick.current = true;
      onSelectionChange?.(new Set(drag.before));
    }
  };
  const endDragRef = useRef(endDrag);
  endDragRef.current = endDrag;

  const startRectangle = (drag: DragState, event: PointerEvent<HTMLDivElement>) => {
    drag.active = true;
    // Text selection may have begun in the first pixels; a rectangle drag replaces it.
    globalThis.getSelection()?.removeAllRanges();
    event.currentTarget.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    const onBlur = () => endDragRef.current();
    const onKey = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      endDragRef.current(true);
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey, true);
    dragCleanup.current = () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey, true);
    };
  };

  const onSelectionPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    // No preventDefault: a press still focuses the row and can start a text selection.
    if (!selectable || event.button !== 0 || event.pointerType !== 'mouse') return;
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.at-row[data-index]');
    if (!row || row.hasAttribute('data-lane') || target.closest('button, a, [role="button"], input:not([type="checkbox"])')) return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    dragSelection.current = {
      pointerId: event.pointerId,
      downX: event.clientX,
      downY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      anchorX: event.clientX - rect.left + element.scrollLeft,
      anchorY: event.clientY - rect.top + element.scrollTop,
      startIndex: Number(row.dataset.index),
      endIndex: -1,
      fromGutter: target.closest('.at-select') !== null,
      base: event.ctrlKey || event.metaKey ? new Set(selectionRef.current) : new Set(),
      before: new Set(selectionRef.current),
      active: false,
    };
  };

  const onSelectionPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragSelection.current;
    if (!drag || drag.pointerId !== event.pointerId || !onSelectionChange) return;
    // Released outside the window: no pointerup arrived.
    if ((event.buttons & 1) === 0) {
      endDrag();
      return;
    }
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.active) {
      const mode = dragMode(event.clientX - drag.downX, event.clientY - drag.downY, drag.fromGutter);
      if (mode === 'wait') return;
      if (mode === 'text') {
        // Native text selection goes on; its release must not open the row.
        dragSelection.current = null;
        suppressClick.current = true;
        return;
      }
      startRectangle(drag, event);
    }
    scheduleDragTick();
  };

  const onSelectionPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragSelection.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.active) suppressClick.current = true;
    endDrag();
  };

  /** Puts focus back on the row a menu was opened from, or on the row now at its place. */
  const restoreRowFocus = (row: HTMLElement, index: number) => {
    const target = row.isConnected ? row : scrollRef.current?.querySelector<HTMLElement>(`.at-row[data-index="${index}"]`);
    target?.focus({ preventScroll: true });
  };

  /** Opens the alert menu for a row: at the pointer, or against the row when opened by keyboard. */
  const openMenu = (index: number, row: HTMLElement, point: { x: number; y: number } | null): boolean => {
    if (!selectable || !onSelectionChange || !onContextMenu) return false;
    const item = itemsRef.current[index];
    if (!item || item.kind === 'lane') return false;
    const targets = alertsOfItem(item);
    const current = selectionRef.current ?? new Set<string>();
    if (!targets.every((alert) => current.has(alert.id))) onSelectionChange(new Set(targets.map((alert) => alert.id)));
    setActiveIndex(index);
    let anchor: MenuAnchor;
    if (point) {
      anchor = { kind: 'point', x: point.x, y: point.y };
    } else {
      const rowRect = row.getBoundingClientRect();
      const left = Math.max(rowRect.left, scrollRef.current?.getBoundingClientRect().left ?? rowRect.left) + SELECT_WIDTH;
      anchor = { kind: 'rect', left, right: left, top: rowRect.top, bottom: rowRect.bottom };
    }
    onContextMenu({ anchor, alertId: item.kind === 'alert' ? item.alert.id : null, restoreFocus: () => restoreRowFocus(row, index) });
    return true;
  };

  // A keyboard-opened menu may be followed by the browser's own contextmenu event.
  const keyboardMenuAt = useRef(Number.NEGATIVE_INFINITY);

  const onRowContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.at-row[data-index]');
    if (!row || !selectable || !onContextMenu) return;
    // A contextmenu event without the right button comes from the keyboard: anchor to the row,
    // unless the key handler has just opened the menu for that same key press.
    const fromKeyboard = event.button !== 2;
    if (fromKeyboard && event.timeStamp - keyboardMenuAt.current < 1000) {
      event.preventDefault();
      return;
    }
    const point = fromKeyboard ? null : { x: event.clientX, y: event.clientY };
    if (openMenu(Number(row.dataset.index), row, point)) event.preventDefault();
  };

  const onCheck = useCallback(
    (index: number, range: boolean) => {
      const current = selectionRef.current;
      if (!current || !onSelectionChange) return;
      const list = itemsRef.current;
      const target = list[index];
      if (!target) return;
      const turnOn = !alertsOfItem(target).every((a) => current.has(a.id));
      const anchor = range ? list.findIndex((item) => itemKey(item) === selectionAnchor.current) : -1;
      const from = anchor < 0 ? index : Math.min(anchor, index);
      const to = anchor < 0 ? index : Math.max(anchor, index);
      const next = new Set(current);
      for (let i = from; i <= to; i += 1) {
        for (const alert of alertsOfItem(list[i])) {
          if (turnOn) next.add(alert.id);
          else next.delete(alert.id);
        }
      }
      selectionAnchor.current = itemKey(target);
      onSelectionChange(next);
    },
    [onSelectionChange],
  );

  const allAlerts = rows.length;
  const selectedHere = selectable ? countSelected(rows, selection) : 0;
  const headerChecked = allAlerts > 0 && selectedHere === allAlerts;
  const headerMixed = selectedHere > 0 && !headerChecked;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    scrollMargin: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  // ---- Keyboard navigation (roving tab stop) ---------------------------
  const [activeIndex, setActiveIndex] = useState(0);
  const safeActive = Math.min(activeIndex, Math.max(0, items.length - 1));

  const handleSelect = useCallback(
    (id: string, index: number) => {
      setActiveIndex(index);
      onSelect(id);
    },
    [onSelect],
  );

  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setActiveIndex(next);
    virtualizer.scrollToIndex(next, { align: 'auto' });
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus({ preventScroll: true });
    });
    const item = items[next];
    if (followFocus && item?.kind === 'alert') onSelect(item.alert.id);
  };

  const toggleItem = (item: TableItem | undefined) => {
    if (item?.kind === 'group') toggleGroup(item.key);
    else if (item?.kind === 'lane') toggleLane(item.key);
  };

  /** Enter or Space: an alert row opens, a group or lane row expands or collapses. */
  const activateItem = (item: TableItem | undefined, index: number) => {
    if (item?.kind === 'alert') handleSelect(item.alert.id, index);
    else toggleItem(item);
  };

  const onBodyKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rowElement = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (!rowElement) return;
    const index = Number(rowElement.dataset.index);
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 300) / rowHeight) - 2);
    const target = navigationTarget(event.key, index, page, items.length);
    const item = items[index];
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      if (openMenu(index, rowElement, null)) keyboardMenuAt.current = event.timeStamp;
    } else if (target !== undefined) {
      event.preventDefault();
      focusRow(target);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateItem(item, index);
    } else if (arrowToggles(item, event.key)) {
      event.preventDefault();
      toggleItem(item);
    } else if ((event.key === 'x' || event.key === 'X') && selectable && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      onCheck(index, event.shiftKey);
    }
  };

  // Each row gets the same keyboard handling, through one stable function so
  // the memoised rows do not re-render when the handler's closure changes.
  const keyHandler = useRef(onBodyKeyDown);
  keyHandler.current = onBodyKeyDown;
  const onRowKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => keyHandler.current(event), []);

  // ---- Column reordering by dragging a header --------------------------
  const [drag, setDrag] = useState<{ from: ColumnId; over: ColumnId | null; side: 'before' | 'after' } | null>(null);

  const onDragOver = (event: DragEvent<HTMLDivElement>, id: ColumnId) => {
    if (!drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    if (drag.over !== id || drag.side !== side) setDrag({ ...drag, over: id, side });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (drag?.over && drag.over !== drag.from) {
      const { from, over, side } = drag;
      patchLayout('columnOrder', (order) => {
        const next = order.filter((id) => id !== from);
        next.splice(next.indexOf(over) + (side === 'after' ? 1 : 0), 0, from);
        return next;
      });
    }
    setDrag(null);
  };

  const virtualRows = virtualizer.getVirtualItems();

  const onRowClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    // Keyboard activation (detail 0) is never the end of a drag.
    if (event.detail === 0) return;
    const target = event.target as HTMLElement;
    const control = target.closest('.at-select, button, input, a, [role="button"]');
    // The second click of a double-click selects a word; it must not toggle or reopen the row.
    const wordClick = event.detail > 1 && !control;
    if (suppressClick.current || wordClick) {
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!selectable || !onSelectionChange || control) return;
    const row = target.closest<HTMLElement>('.at-row[data-index]');
    if (!row) return;
    const index = Number(row.dataset.index);
    const item = items[index];
    if (!item || item.kind === 'lane') return;
    const additive = event.ctrlKey || event.metaKey;
    if (!event.shiftKey && !additive) {
      selectionAnchor.current = itemKey(item);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!event.shiftKey) {
      onCheck(index, false);
      return;
    }
    const anchor = items.findIndex((entry) => itemKey(entry) === selectionAnchor.current);
    const start = anchor < 0 ? index : anchor;
    if (anchor < 0) selectionAnchor.current = itemKey(item);
    const next = new Set(additive ? selectionRef.current : undefined);
    for (let i = Math.min(start, index); i <= Math.max(start, index); i += 1) {
      if (items[i].kind !== 'lane') for (const alert of alertsOfItem(items[i])) next.add(alert.id);
    }
    onSelectionChange(next);
  };

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label="Alerts"
      aria-rowcount={items.length + 1}
      aria-colcount={headers.length + (selectable ? 1 : 0)}
      aria-multiselectable={selectable || undefined}
      className={cn('relative min-h-0 flex-1 overflow-auto bg-panel', isResizing && 'cursor-col-resize select-none')}
      style={sizeVars}
      onPointerDown={onSelectionPointerDown}
      onPointerMove={onSelectionPointerMove}
      onPointerUp={onSelectionPointerUp}
      onPointerCancel={() => endDrag()}
      onLostPointerCapture={() => endDrag()}
      onClickCapture={onRowClickCapture}
      onFocus={(event) => {
        // A row focused by a click becomes the tab stop, as one focused by the arrow keys.
        const row = event.target as HTMLElement;
        if (row.classList.contains('at-row') && row.dataset.index !== undefined) setActiveIndex(Number(row.dataset.index));
      }}
      onContextMenu={onRowContextMenu}
    >
      <div role="row" aria-rowindex={1} className="at-header" style={{ height: HEADER_HEIGHT, width: 'var(--table-width)', minWidth: '100%' }}>
        {selectable && (
          <div role="columnheader" className="at-th at-select" style={{ width: SELECT_WIDTH }}>
            <input
              type="checkbox"
              aria-label={headerChecked ? 'Clear selection' : `Select all ${allAlerts} alerts`}
              checked={headerChecked}
              ref={(el) => {
                if (el) el.indeterminate = headerMixed;
              }}
              disabled={allAlerts === 0}
              onChange={() => onSelectionChange(headerChecked ? new Set() : new Set(rows.map((r) => r.id)))}
              data-tip={headerChecked ? 'Clear selection' : 'Select all'}
              data-tip-always=""
            />
          </div>
        )}
        {headers.map((header) => (
          <HeaderCell
            key={header.id}
            header={header}
            drop={drag?.over === header.id && drag.from !== header.id ? drag.side : undefined}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', header.id);
              setDrag({ from: header.id as ColumnId, over: null, side: 'before' });
            }}
            onDragOver={(event) => onDragOver(event, header.id as ColumnId)}
            onDrop={onDrop}
            onDragEnd={() => setDrag(null)}
            onResizeBy={(delta) =>
              table.setColumnSizing((sizing) => ({
                ...sizing,
                [header.id]: Math.max(COLUMN_INFO[header.id as ColumnId].minSize, header.getSize() + delta),
              }))
            }
          />
        ))}
      </div>

      {items.length === 0 ? (
        <div className="sticky left-0 flex w-full items-center justify-center px-6 py-16">{emptyState}</div>
      ) : (
        <div
          role="rowgroup"
          className="relative"
          style={{ height: virtualizer.getTotalSize(), width: 'var(--table-width)', minWidth: '100%' }}
        >
          {virtualRows.map((virtual) => {
            const item = items[virtual.index];
            const common = {
              index: virtual.index,
              top: virtual.start - HEADER_HEIGHT,
              height: rowHeight,
              tabbable: virtual.index === safeActive,
              columns: rowColumns,
              options: cellOptions,
              onCheck: selectable ? onCheck : undefined,
              onKeyDown: onRowKeyDown,
              hasMenu: selectable && onContextMenu !== undefined,
            };
            const key = itemKey(item);
            if (item.kind === 'lane') {
              const count = selectable ? countSelected(item.alerts, selection) : 0;
              return (
                <LaneRow
                  key={key}
                  {...common}
                  laneKey={item.key}
                  name={item.name}
                  isNone={item.isNone}
                  laneBy={laneBy}
                  total={item.alerts.length}
                  shared={item.shared}
                  p1={item.p1}
                  priority={item.priority}
                  collapsed={item.collapsed}
                  checked={checkState(count, item.alerts.length)}
                  onToggle={toggleLane}
                />
              );
            }
            if (item.kind === 'group') {
              const members = item.group.alerts;
              const count = selectable ? countSelected(members, selection) : 0;
              return (
                <GroupRow
                  key={key}
                  {...common}
                  itemKey={item.key}
                  group={item.group}
                  summary={item.summary}
                  expanded={item.expanded}
                  checked={checkState(count, members.length)}
                  critical={highlightCritical && isCritical(item.summary)}
                  activityEnd={activityEnd}
                  onToggle={toggleGroup}
                />
              );
            }
            return (
              <Row
                key={key}
                {...common}
                alert={item.alert}
                child={item.child}
                alsoIn={item.alsoIn}
                selected={item.alert.id === selectedId}
                checked={selectable ? selection.has(item.alert.id) : undefined}
                critical={highlightCritical && isCritical(item.alert)}
                onSelect={handleSelect}
              />
            );
          })}
        </div>
      )}
      {dragging && (
        // Positioned in content coordinates by dragTick: it scrolls with its rows, under the sticky header.
        <div ref={boxRef} aria-hidden="true" data-selection-box="" className="pointer-events-none absolute left-0 top-0 z-[2] size-0 border border-accent bg-accent/20" />
      )}
    </div>
  );
});

interface RowBaseProps {
  index: number;
  top: number;
  height: number;
  tabbable: boolean;
  columns: RowColumn[];
  options: CellOptions;
  critical: boolean;
  /** Present when the selection column is shown. */
  onCheck?: (index: number, range: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** The row opens the alert menu (right-click, Shift+F10, the ContextMenu key). */
  hasMenu: boolean;
}

/** Clicks in the selection cell tick the box; they must not also open or toggle the row. */
const inSelectCell = (event: MouseEvent<HTMLElement>) => (event.target as HTMLElement).closest('.at-select') !== null;

interface RowProps extends RowBaseProps {
  alert: Alert;
  child: boolean;
  /** Other lanes this alert also appears in, comma-separated; '' when none. */
  alsoIn: string;
  selected: boolean;
  checked: boolean | undefined;
  onSelect: (id: string, index: number) => void;
}

function SelectCell({ index, checked, label, onCheck }: Readonly<{ index: number; checked: boolean | 'mixed'; label: string; onCheck: (index: number, range: boolean) => void }>) {
  return (
    <div role="gridcell" className="at-cell at-select" style={{ width: SELECT_WIDTH }}>
      <input
        type="checkbox"
        tabIndex={-1}
        aria-label={label}
        checked={checked === true}
        ref={(el) => {
          if (el) el.indeterminate = checked === 'mixed';
        }}
        onClick={(event) => {
          event.stopPropagation();
          onCheck(index, event.shiftKey);
        }}
        onChange={() => undefined}
      />
    </div>
  );
}

const Row = memo(function Row({ alert, child, alsoIn, index, top, height, selected, checked, tabbable, columns, options, critical, onSelect, onCheck, onKeyDown, hasMenu }: RowProps) {
  const name = alert.tinyId ? `#${alert.tinyId}` : alert.summary;
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      aria-haspopup={hasMenu ? 'menu' : undefined}
      data-index={index}
      data-critical={critical ? 'true' : undefined}
      data-closed={alert.status === 'closed' ? 'true' : undefined}
      data-child={child ? 'true' : undefined}
      data-checked={checked ? 'true' : undefined}
      tabIndex={tabbable ? 0 : -1}
      className="at-row"
      style={{ transform: `translateY(${top}px)`, height, width: 'var(--table-width)' }}
      onClick={(event) => !inSelectCell(event) && onSelect(alert.id, index)}
      onKeyDown={onKeyDown}
    >
      {onCheck && <SelectCell index={index} checked={checked ?? false} label={`Select alert ${name}`} onCheck={onCheck} />}
      {columns.map((column) => (
        <div
          key={column.id}
          role="gridcell"
          className={cn('at-cell', column.id === 'count' && 'justify-end')}
          style={{ width: `calc(var(--w-${column.id}) * 1px)` }}
        >
          {renderCell(column.id, alert, column.size, options)}
          {column.id === 'summary' && alsoIn && (
            <span
              className="flex flex-none items-center gap-0.5 rounded border border-line-strong px-1 text-[10px] leading-4 text-muted"
              data-tip={`Also in: ${alsoIn}`}
              data-tip-always=""
              aria-label={`Also in: ${alsoIn}`}
            >
              <Copy size={10} aria-hidden />
              {alsoIn.split(', ').length}
            </span>
          )}
        </div>
      ))}
    </div>
  );
});

interface GroupRowProps extends RowBaseProps {
  /** Expansion key (unique across lanes). */
  itemKey: string;
  group: AlertGroup;
  summary: Alert;
  expanded: boolean;
  checked: boolean | 'mixed';
  /** End of the 24-hour activity strip, epoch ms. */
  activityEnd: number;
  onToggle: (key: string) => void;
}

/** One cell of a group row: the summary column describes the group, the id column counts its alerts. */
function GroupCellContent({
  column,
  group,
  summary,
  expanded,
  activityEnd,
  options,
}: Readonly<{ column: RowColumn; group: AlertGroup; summary: Alert; expanded: boolean; activityEnd: number; options: CellOptions }>) {
  if (column.id === 'tinyId') return <span className="truncate text-xs text-subtle">{group.records} alerts</span>;
  if (column.id !== 'summary') return renderCell(column.id, summary, column.size, options);
  const tip = `${group.records} alert records · ${group.occurrences} occurrences\nGrouped by ${group.basis === 'alias' ? 'alias' : 'source and similar summary'}`;
  return (
    <>
      <ChevronRight size={14} aria-hidden className={cn('flex-none text-muted transition-transform', expanded && 'rotate-90')} />
      <span className="truncate font-medium" data-tip={summary.summary}>
        {summary.summary}
      </span>
      <span className="flex-none rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold leading-4 tabular-nums text-accent" data-tip={tip} data-tip-always="">
        {group.records} alerts{options.showOccurrences && group.occurrences > group.records ? ` · ×${group.occurrences}` : ''}
      </span>
      <ActivityStrip alerts={group.alerts} end={activityEnd} />
    </>
  );
}

/** One row standing for a group of repeated alerts; click to expand. */
const GroupRow = memo(function GroupRow({ itemKey: key, group, summary, expanded, checked, activityEnd, index, top, height, tabbable, columns, options, critical, onToggle, onCheck, onKeyDown, hasMenu }: GroupRowProps) {
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-expanded={expanded}
      aria-haspopup={hasMenu ? 'menu' : undefined}
      data-index={index}
      data-group="true"
      data-critical={critical ? 'true' : undefined}
      data-closed={summary.status === 'closed' ? 'true' : undefined}
      tabIndex={tabbable ? 0 : -1}
      className="at-row"
      style={{ transform: `translateY(${top}px)`, height, width: 'var(--table-width)' }}
      onClick={(event) => !inSelectCell(event) && onToggle(key)}
      onKeyDown={onKeyDown}
    >
      {onCheck && <SelectCell index={index} checked={checked} label={`Select ${group.records} alerts in this group`} onCheck={onCheck} />}
      {columns.map((column) => (
        <div key={column.id} role="gridcell" className={cn('at-cell', column.id === 'count' && 'justify-end')} style={{ width: `calc(var(--w-${column.id}) * 1px)` }}>
          <GroupCellContent column={column} group={group} summary={summary} expanded={expanded} activityEnd={activityEnd} options={options} />
        </div>
      ))}
    </div>
  );
});

interface LaneRowProps extends Omit<RowBaseProps, 'critical' | 'columns' | 'options'> {
  laneKey: string;
  name: string;
  isNone: boolean;
  laneBy: LaneBy;
  total: number;
  shared: number;
  p1: number;
  priority: Priority;
  collapsed: boolean;
  checked: boolean | 'mixed';
  onToggle: (key: string) => void;
}

/** Header of one lane: name, most urgent priority, counts. Click to collapse. */
const LaneRow = memo(function LaneRow({ laneKey, name, isNone, laneBy, total, shared, p1, priority, collapsed, checked, index, top, height, tabbable, onToggle, onCheck, onKeyDown }: LaneRowProps) {
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-expanded={!collapsed}
      data-index={index}
      data-lane="true"
      tabIndex={tabbable ? 0 : -1}
      className="at-row"
      style={{ transform: `translateY(${top}px)`, height, width: 'var(--table-width)' }}
      onClick={(event) => !inSelectCell(event) && onToggle(laneKey)}
      onKeyDown={onKeyDown}
    >
      {onCheck && <SelectCell index={index} checked={checked} label={`Select ${total} alerts in ${name}`} onCheck={onCheck} />}
      <div role="gridcell" className="at-cell sticky left-0 min-w-0 flex-1">
        <ChevronRight size={14} aria-hidden className={cn('flex-none text-muted transition-transform', !collapsed && 'rotate-90')} />
        {laneBy === 'customer' && !isNone ? <CustomerBadge name={name} /> : <span className={cn('truncate', isNone && 'text-muted')}>{name}</span>}
        <span className="flex-none tabular-nums text-muted" data-tip={`${total} alerts in this lane`} data-tip-always="">
          {total}
        </span>
        {p1 > 0 ? (
          <span className="flex-none text-[11px] font-semibold tabular-nums text-crit" data-tip={`${p1} P1 alerts`} data-tip-always="">
            {p1} P1
          </span>
        ) : (
          <span data-tip="Most urgent priority in this lane" data-tip-always="">
            <PriorityBadge priority={priority} />
          </span>
        )}
        {shared > 0 && (
          <span className="flex flex-none items-center gap-0.5 text-[11px] font-normal text-subtle" data-tip={`${shared} of these alerts also appear in other lanes`} data-tip-always="">
            <Copy size={11} aria-hidden />
            {shared}
          </span>
        )}
      </div>
    </div>
  );
});

interface HeaderCellProps {
  header: Header<Alert, unknown>;
  drop: 'before' | 'after' | undefined;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onResizeBy: (delta: number) => void;
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

function HeaderCell({ header, drop, onDragStart, onDragOver, onDrop, onDragEnd, onResizeBy }: Readonly<HeaderCellProps>) {
  const column = header.column;
  const id = header.id as ColumnId;
  const { label } = COLUMN_INFO[id];
  const sorted = column.getIsSorted();
  const sortIndex = column.getSortIndex();
  const multiSorted = header.getContext().table.getState().sorting.length > 1;

  return (
    <div
      role="columnheader"
      aria-sort={sorted ? ARIA_SORT[sorted] : 'none'}
      aria-colindex={header.index + 1}
      className="at-th"
      data-sorted={sorted ? 'true' : undefined}
      data-drop={drop}
      style={{ width: `calc(var(--w-${id}) * 1px)` }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        draggable
        className="at-th-button"
        onClick={column.getToggleSortingHandler()}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        data-tip={`${label}\nClick to sort · Shift+click to add a sort level · drag to move`}
        data-tip-always=""
      >
        <span className="truncate">{label}</span>
        {sorted === 'asc' && <ArrowUp size={12} strokeWidth={2.5} aria-hidden className="flex-none text-accent" />}
        {sorted === 'desc' && <ArrowDown size={12} strokeWidth={2.5} aria-hidden className="flex-none text-accent" />}
        {sorted && multiSorted && <span className="flex-none text-[10px] tabular-nums text-accent">{sortIndex + 1}</span>}
      </button>
      {/* Sibling of the draggable button, so dragging the edge resizes instead of moving the column. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize column ${label}. Use left and right arrow keys.`}
        aria-valuenow={Math.round(header.getSize())}
        tabIndex={0}
        className="at-resizer"
        data-active={column.getIsResizing() ? 'true' : undefined}
        onMouseDown={header.getResizeHandler()}
        onTouchStart={header.getResizeHandler()}
        onDoubleClick={() => column.resetSize()}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          onResizeBy(event.key === 'ArrowLeft' ? -16 : 16);
        }}
      />
    </div>
  );
}

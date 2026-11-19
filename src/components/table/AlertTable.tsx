import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { getCoreRowModel, getSortedRowModel, useReactTable, type Header, type SortingState, type Updater } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Alert } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { COLUMN_INFO, type ColumnId } from '../../config/columns';
import { isCritical } from '../../config/sections';
import { useStore } from '../../lib/store';
import type { Density } from '../../state/prefs';
import { tableLayoutStore, type TableLayout } from '../../state/tableLayout';
import { COLUMNS, renderCell, type CellOptions } from './columns';

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
 */

const HEADER_HEIGHT = 32;
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
}

interface RowColumn {
  id: ColumnId;
  size: number;
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
}: AlertTableProps) {
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
  const sizeVars: Record<string, string | number> = { '--table-width': `${totalWidth}px` };
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

  const virtualizer = useVirtualizer({
    count: rows.length,
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
  const safeActive = Math.min(activeIndex, Math.max(0, rows.length - 1));

  const handleSelect = useCallback(
    (id: string, index: number) => {
      setActiveIndex(index);
      onSelect(id);
    },
    [onSelect],
  );

  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setActiveIndex(next);
    virtualizer.scrollToIndex(next, { align: 'auto' });
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus({ preventScroll: true });
    });
    const row = rows[next];
    if (followFocus && row) onSelect(row.id);
  };

  const onBodyKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rowElement = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (!rowElement) return;
    const index = Number(rowElement.dataset.index);
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 300) / rowHeight) - 2);
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      PageDown: index + page,
      PageUp: index - page,
      Home: 0,
      End: rows.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      focusRow(moves[event.key]!);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const row = rows[index];
      if (row) handleSelect(row.id, index);
    }
  };

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

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label="Alerts"
      aria-rowcount={rows.length + 1}
      aria-colcount={headers.length}
      className={cn('relative min-h-0 flex-1 overflow-auto bg-panel', isResizing && 'cursor-col-resize select-none')}
      style={sizeVars as CSSProperties}
    >
      <div role="row" aria-rowindex={1} className="at-header" style={{ height: HEADER_HEIGHT, width: 'var(--table-width)', minWidth: '100%' }}>
        {headers.map((header) => (
          <HeaderCell
            key={header.id}
            header={header}
            drop={drag && drag.over === header.id && drag.from !== header.id ? drag.side : undefined}
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

      {rows.length === 0 ? (
        <div className="sticky left-0 flex w-full items-center justify-center px-6 py-16">{emptyState}</div>
      ) : (
        <div
          role="rowgroup"
          className="relative"
          style={{ height: virtualizer.getTotalSize(), width: 'var(--table-width)', minWidth: '100%' }}
          onKeyDown={onBodyKeyDown}
        >
          {virtualRows.map((item) => {
            const row = rows[item.index]!;
            return (
              <Row
                key={row.id}
                alert={row.original}
                index={item.index}
                top={item.start - HEADER_HEIGHT}
                height={rowHeight}
                selected={row.id === selectedId}
                tabbable={item.index === safeActive}
                columns={rowColumns}
                options={cellOptions}
                critical={highlightCritical && isCritical(row.original)}
                onSelect={handleSelect}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

interface RowProps {
  alert: Alert;
  index: number;
  top: number;
  height: number;
  selected: boolean;
  tabbable: boolean;
  columns: RowColumn[];
  options: CellOptions;
  critical: boolean;
  onSelect: (id: string, index: number) => void;
}

const Row = memo(function Row({ alert, index, top, height, selected, tabbable, columns, options, critical, onSelect }: RowProps) {
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      data-index={index}
      data-critical={critical ? 'true' : undefined}
      data-closed={alert.status === 'closed' ? 'true' : undefined}
      tabIndex={tabbable ? 0 : -1}
      className="at-row"
      style={{ transform: `translateY(${top}px)`, height, width: 'var(--table-width)' }}
      onClick={() => onSelect(alert.id, index)}
    >
      {columns.map((column) => (
        <div
          key={column.id}
          role="gridcell"
          className={cn('at-cell', column.id === 'count' && 'justify-end')}
          style={{ width: `calc(var(--w-${column.id}) * 1px)` }}
        >
          {renderCell(column.id, alert, column.size, options)}
        </div>
      ))}
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

function HeaderCell({ header, drop, onDragStart, onDragOver, onDrop, onDragEnd, onResizeBy }: HeaderCellProps) {
  const column = header.column;
  const id = header.id as ColumnId;
  const { label } = COLUMN_INFO[id];
  const sorted = column.getIsSorted();
  const sortIndex = column.getSortIndex();
  const multiSorted = header.getContext().table.getState().sorting.length > 1;

  return (
    <div
      role="columnheader"
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
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

import { memo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from 'react';
import { EyeOff, GripVertical, Plus, RotateCcw } from 'lucide-react';
import { GRID_COLUMNS, WIDGET_BY_ID, type WidgetId } from '../../config/widgets';
import { cn } from '../../lib/cn';
import type { DashboardStats } from '../../lib/stats';
import { useStore } from '../../lib/store';
import { DEFAULT_DASHBOARD, dashboardStore, moveWidget, resizeWidget, setWidgetVisible } from '../../state/dashboard';
import type { Density } from '../../state/prefs';
import { WIDGET_COMPONENTS, type WidgetActions } from './widgets';

/**
 * The widget area above the table: a 12-column grid whose content, order and
 * sizes belong to the user. In edit mode widgets can be dragged to a new
 * position, resized from the bottom-right corner, hidden, and added back.
 * The same operations are available with the keyboard in Settings.
 */

const GAP = 8;
const ROW_UNIT: Record<Density, number> = { compact: 30, comfortable: 34, spacious: 40 };

interface DashboardProps {
  stats: DashboardStats;
  density: Density;
  editing: boolean;
  onDoneEditing: () => void;
  actions: WidgetActions;
}

export const Dashboard = memo(function Dashboard({ stats, density, editing, onDoneEditing, actions }: DashboardProps) {
  const layout = useStore(dashboardStore);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: WidgetId; over: WidgetId | null; side: 'before' | 'after' } | null>(null);
  const rowUnit = ROW_UNIT[density];

  const visible = layout.widgets.filter((w) => w.visible);
  const hidden = layout.widgets.filter((w) => !w.visible);
  if (layout.collapsed && !editing) return null;

  const onDragOver = (event: DragEvent<HTMLDivElement>, id: WidgetId) => {
    if (!drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    if (drag.over !== id || drag.side !== side) setDrag({ ...drag, over: id, side });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (drag?.over) moveWidget(drag.id, drag.over, drag.side);
    setDrag(null);
  };

  /** Corner drag: the size snaps to whole grid columns and row units. */
  const onResizeMove = (event: PointerEvent<HTMLDivElement>, id: WidgetId) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const grid = gridRef.current;
    const cell = event.currentTarget.parentElement;
    if (!grid || !cell) return;
    const rect = cell.getBoundingClientRect();
    const columnWidth = (grid.clientWidth + GAP) / GRID_COLUMNS;
    resizeWidget(id, (event.clientX - rect.left + GAP) / columnWidth, (event.clientY - rect.top + GAP) / (rowUnit + GAP));
  };

  return (
    <div className={cn('flex-none px-3 pt-2', editing && 'bg-accent-soft/40 pb-2')}>
      <div
        ref={gridRef}
        className="dash-grid"
        style={{ '--dash-row': `${rowUnit}px`, gap: GAP } as CSSProperties}
      >
        {visible.map((placement) => {
          const def = WIDGET_BY_ID[placement.id];
          const Widget = WIDGET_COMPONENTS[placement.id];
          const height = placement.h * rowUnit + (placement.h - 1) * GAP;
          const dropSide = drag && drag.over === placement.id && drag.id !== placement.id ? drag.side : undefined;
          return (
            <div
              key={placement.id}
              data-widget={placement.id}
              data-size={placement.w <= 3 ? 's' : 'l'}
              data-drop={dropSide}
              className={cn('dash-cell relative min-w-0', editing && 'rounded-md outline-1 outline-dashed outline-accent/60')}
              style={{ gridColumn: `span ${placement.w}`, gridRow: `span ${placement.h}` }}
              onDragOver={editing ? (event) => onDragOver(event, placement.id) : undefined}
              onDrop={editing ? onDrop : undefined}
            >
              {/* While editing, the content does not react to clicks. */}
              <div className={cn('h-full', editing && 'pointer-events-none select-none')} inert={editing}>
                <Widget stats={stats} w={placement.w} h={placement.h} height={height} actions={actions} />
              </div>

              {editing && (
                <>
                  <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-raised/95 shadow-sm">
                    <button
                      type="button"
                      draggable
                      aria-label={`Move ${def.title}. Drag to another position.`}
                      className="cursor-grab rounded p-1 text-muted hover:bg-hover hover:text-fg active:cursor-grabbing"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', placement.id);
                        const cell = event.currentTarget.closest<HTMLElement>('[data-widget]');
                        if (cell) event.dataTransfer.setDragImage(cell, cell.clientWidth - 20, 12);
                        setDrag({ id: placement.id, over: null, side: 'before' });
                      }}
                      onDragEnd={() => setDrag(null)}
                    >
                      <GripVertical size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Hide ${def.title}`}
                      onClick={() => setWidgetVisible(placement.id, false)}
                      className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
                    >
                      <EyeOff size={14} aria-hidden />
                    </button>
                  </div>
                  <div
                    role="separator"
                    aria-label={`Resize ${def.title}`}
                    className="absolute bottom-0 right-0 size-4 cursor-nwse-resize touch-none rounded-br-md border-b-2 border-r-2 border-accent"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => onResizeMove(event, placement.id)}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {hidden.map((placement) => (
            <button
              key={placement.id}
              type="button"
              onClick={() => setWidgetVisible(placement.id, true)}
              className="flex h-7 items-center gap-1 rounded-md border border-dashed border-line-strong bg-panel px-2 text-xs font-medium text-muted hover:bg-hover hover:text-fg"
            >
              <Plus size={13} aria-hidden />
              {WIDGET_BY_ID[placement.id].title}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => dashboardStore.set(DEFAULT_DASHBOARD())}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-hover"
            >
              <RotateCcw size={13} aria-hidden />
              Reset
            </button>
            <button type="button" onClick={onDoneEditing} className="h-7 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

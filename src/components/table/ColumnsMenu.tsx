import { ArrowDown, ArrowUp, Columns3, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { COLUMN_INFO } from '../../config/columns';
import { useStore } from '../../lib/store';
import { DEFAULT_TABLE_LAYOUT, moveColumn, setColumnVisible, tableLayoutStore } from '../../state/tableLayout';
import { Popover } from '../ui/Popover';

/** Show, hide and reorder columns. Keyboard alternative to dragging headers. */
export function ColumnsMenu() {
  const prefs = useStore(tableLayoutStore);
  const hiddenCount = prefs.columnOrder.filter((id) => prefs.columnVisibility[id] === false).length;

  return (
    <Popover
      label="Columns"
      align="end"
      className="w-72"
      trigger={(props, open) => (
        <button
          type="button"
          {...props}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium',
            open ? 'border-accent bg-accent-soft text-fg' : 'border-line-strong bg-panel text-muted hover:bg-hover hover:text-fg',
          )}
        >
          <Columns3 size={14} aria-hidden />
          Columns
          {hiddenCount > 0 && <span className="text-subtle">({hiddenCount} hidden)</span>}
        </button>
      )}
    >
      {() => (
        <div className="p-1.5">
          <ul className="max-h-[60vh] overflow-auto">
            {prefs.columnOrder.map((id, index) => {
              const info = COLUMN_INFO[id];
              const visible = prefs.columnVisibility[id] !== false;
              return (
                <li key={id} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-(--accent)"
                      checked={visible}
                      disabled={!info.hideable}
                      onChange={(event) => setColumnVisible(id, event.target.checked)}
                    />
                    <span className={cn('truncate', !visible && 'text-subtle')}>{info.label}</span>
                  </label>
                  <button
                    type="button"
                    aria-label={`Move ${info.label} left`}
                    disabled={index === 0}
                    onClick={() => moveColumn(id, -1)}
                    className="rounded p-1 text-muted hover:bg-line hover:text-fg disabled:opacity-30"
                  >
                    <ArrowUp size={13} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${info.label} right`}
                    disabled={index === prefs.columnOrder.length - 1}
                    onClick={() => moveColumn(id, 1)}
                    className="rounded p-1 text-muted hover:bg-line hover:text-fg disabled:opacity-30"
                  >
                    <ArrowDown size={13} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 flex items-center justify-between border-t border-line px-1.5 pt-1.5">
            <span className="text-[11px] text-subtle">Drag a header to move it, drag its edge to resize.</span>
            <button
              type="button"
              onClick={() => tableLayoutStore.set(DEFAULT_TABLE_LAYOUT())}
              className="flex flex-none items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-accent hover:bg-hover"
            >
              <RotateCcw size={12} aria-hidden />
              Reset
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

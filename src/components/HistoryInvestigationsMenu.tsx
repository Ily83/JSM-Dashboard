import { useState } from 'react';
import { Check, FolderOpen, Pencil, Save, Trash2 } from 'lucide-react';
import { cn } from '../lib/cn';
import { useStore } from '../lib/store';
import {
  deleteInvestigation,
  historyStore,
  isInvestigationModified,
  MAX_INVESTIGATIONS,
  renameInvestigation,
  saveInvestigation,
  updateInvestigation,
  type HistoryInvestigation,
  type InvestigationInput,
} from '../state/historyInvestigations';
import { Popover } from './ui/Popover';

interface Props {
  current: InvestigationInput;
  activeId: string | null;
  onOpen: (investigation: HistoryInvestigation) => void;
  onActiveChange: (id: string | null) => void;
}

const iconButton = 'flex-none rounded p-1 text-subtle hover:bg-hover hover:text-fg';

/** Save the current History analysis under a name, and open, rename or delete saved ones. */
export function HistoryInvestigationsMenu({ current, activeId, onOpen, onActiveChange }: Props) {
  const { saved } = useStore(historyStore);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const active = saved.find((item) => item.id === activeId) ?? null;
  const modified = active ? isInvestigationModified(active, current) : false;
  const full = saved.length >= MAX_INVESTIGATIONS;

  return (
    <Popover
      label="Saved investigations"
      align="end"
      className="w-80"
      onOpenChange={(open) => !open && setRenaming(null)}
      trigger={(props, open) => (
        <button
          type="button"
          {...props}
          data-tip="Saved investigations"
          data-tip-always=""
          className={cn(
            'flex h-7 max-w-56 items-center gap-1.5 rounded-md border px-2 text-xs font-medium',
            open ? 'border-accent bg-accent-soft text-fg' : 'border-line-strong bg-panel text-muted hover:bg-hover hover:text-fg',
          )}
        >
          <FolderOpen size={14} aria-hidden className={cn('flex-none', active && 'text-accent')} />
          <span className="truncate">{active ? active.name : 'Investigations'}</span>
          {modified && <span className="flex-none text-warn" aria-label="modified">•</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="flex max-h-[70vh] flex-col">
          <ul className="min-h-0 flex-1 overflow-auto p-1">
            {saved.length === 0 && <li className="px-2 py-2 text-xs text-subtle">No saved investigations</li>}
            {saved.map((item) => (
              <li key={item.id} className="group flex items-center gap-0.5 rounded pr-1 hover:bg-hover">
                {renaming?.id === item.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      renameInvestigation(item.id, renaming.name);
                      setRenaming(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={renaming.name}
                      maxLength={80}
                      aria-label={`New name for ${item.name}`}
                      onChange={(event) => setRenaming({ id: item.id, name: event.target.value })}
                      className="h-6 min-w-0 flex-1 rounded border border-line-strong bg-bg px-1.5 text-xs"
                    />
                    <button type="submit" disabled={!renaming.name.trim()} aria-label="Save name" className={iconButton}>
                      <Check size={13} aria-hidden />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onOpen(item);
                        close();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left"
                    >
                      <Check size={13} aria-hidden className={cn('flex-none text-accent', item.id !== activeId && 'invisible')} />
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <span className="flex-none text-[11px] tabular-nums text-subtle">
                        {item.from.slice(2)} – {item.to.slice(2)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename ${item.name}`}
                      data-tip="Rename"
                      data-tip-always=""
                      onClick={() => setRenaming({ id: item.id, name: item.name })}
                      className={cn(iconButton, 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100')}
                    >
                      <Pencil size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${item.name}`}
                      data-tip="Delete"
                      data-tip-always=""
                      onClick={() => {
                        deleteInvestigation(item.id);
                        if (item.id === activeId) onActiveChange(null);
                      }}
                      className={cn(iconButton, 'opacity-0 hover:text-crit focus-visible:opacity-100 group-hover:opacity-100')}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          <div className="grid gap-1.5 border-t border-line p-2">
            {active && modified && (
              <button
                type="button"
                onClick={() => {
                  updateInvestigation(active.id, current);
                  close();
                }}
                className="flex items-center gap-1.5 rounded border border-line-strong px-2 py-1 text-left text-xs font-medium hover:bg-hover"
              >
                <Save size={13} aria-hidden className="flex-none" />
                <span className="truncate">Save changes to “{active.name}”</span>
              </button>
            )}
            <form
              className="flex gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                const id = saveInvestigation(name, current);
                if (id) {
                  onActiveChange(id);
                  setName('');
                  close();
                }
              }}
            >
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder={full ? `Limit of ${MAX_INVESTIGATIONS} reached` : 'Investigation name'}
                aria-label="Investigation name"
                disabled={full}
                className="h-7 min-w-0 flex-1 rounded border border-line-strong bg-bg px-2 text-xs placeholder:text-subtle"
              />
              <button
                type="submit"
                disabled={!name.trim() || full}
                className="h-7 flex-none rounded bg-accent px-2.5 text-xs font-semibold text-on-accent disabled:opacity-40"
              >
                Save
              </button>
            </form>
          </div>
        </div>
      )}
    </Popover>
  );
}

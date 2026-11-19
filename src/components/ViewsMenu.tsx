import { useState } from 'react';
import { Bookmark, Check, Save, Settings2, Star } from 'lucide-react';
import { SECTIONS, type SectionId } from '../config/sections';
import { cn } from '../lib/cn';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { applyView, isViewModified, saveViewAs, setDefaultView, updateView, viewsStore } from '../state/views';
import { Popover } from './ui/Popover';

/** Apply a saved view, save the current one, or save it under a new name. Full management is in Settings. */
export function ViewsMenu({ section }: { section: SectionId }) {
  const views = useStore(viewsStore);
  const [name, setName] = useState('');
  const [includeLayout, setIncludeLayout] = useState(false);

  const active = views.saved.find((v) => v.id === views.activeViewId) ?? null;
  const modified = active ? isViewModified(active, section, views.current) : false;

  return (
    <Popover
      label="Saved views"
      align="end"
      className="w-72"
      trigger={(props, open) => (
        <button
          type="button"
          {...props}
          className={cn(
            'flex h-7 max-w-56 items-center gap-1.5 rounded-md border px-2 text-xs font-medium',
            open ? 'border-accent bg-accent-soft text-fg' : 'border-line-strong bg-panel text-muted hover:bg-hover hover:text-fg',
          )}
        >
          <Bookmark size={14} aria-hidden className={cn('flex-none', active && 'fill-current text-accent')} />
          <span className="truncate">{active ? active.name : 'Views'}</span>
          {modified && <span className="flex-none text-warn" aria-label="modified">•</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="flex max-h-[70vh] flex-col">
          <ul className="min-h-0 flex-1 overflow-auto p-1">
            {views.saved.length === 0 && <li className="px-2 py-2 text-xs text-subtle">No saved views</li>}
            {views.saved.map((view) => {
              const isDefault = views.defaultViewId === view.id;
              return (
                <li key={view.id} className="group flex items-center rounded hover:bg-hover">
                  <button
                    type="button"
                    onClick={() => {
                      applyView(view.id);
                      close();
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left"
                  >
                    <Check size={13} aria-hidden className={cn('flex-none text-accent', view.id !== views.activeViewId && 'invisible')} />
                    <span className="min-w-0 flex-1 truncate">{view.name}</span>
                    <span className="flex-none text-[11px] text-subtle">{SECTIONS[view.section].label.replace(' Alerts', '')}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={isDefault ? `${view.name} is the default view. Remove default.` : `Make ${view.name} the default view`}
                    aria-pressed={isDefault}
                    data-tip={isDefault ? 'Default view' : 'Set as default'}
                    data-tip-always=""
                    onClick={() => setDefaultView(isDefault ? null : view.id)}
                    className={cn(
                      'mx-1 flex-none rounded p-1',
                      isDefault ? 'text-warn' : 'text-subtle opacity-0 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100',
                    )}
                  >
                    <Star size={13} aria-hidden className={cn(isDefault && 'fill-current')} />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="grid gap-1.5 border-t border-line p-2">
            {active && modified && (
              <button
                type="button"
                onClick={() => {
                  updateView(active.id, section);
                  close();
                }}
                className="flex items-center gap-1.5 rounded border border-line-strong px-2 py-1 text-left text-xs font-medium hover:bg-hover"
              >
                <Save size={13} aria-hidden className="flex-none" />
                <span className="truncate">Save changes to “{active.name}”</span>
              </button>
            )}
            <form
              className="grid gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                saveViewAs(name, section, includeLayout);
                setName('');
                close();
              }}
            >
              <div className="flex gap-1.5">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  placeholder="New view name"
                  aria-label="New view name"
                  className="h-7 min-w-0 flex-1 rounded border border-line-strong bg-bg px-2 text-xs placeholder:text-subtle"
                />
                <button
                  type="submit"
                  disabled={!name.trim()}
                  className="h-7 flex-none rounded bg-accent px-2.5 text-xs font-semibold text-on-accent disabled:opacity-40"
                >
                  Save
                </button>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input type="checkbox" className="size-3.5 accent-(--accent)" checked={includeLayout} onChange={(event) => setIncludeLayout(event.target.checked)} />
                Include columns and dashboard layout
              </label>
            </form>
            <button
              type="button"
              onClick={() => {
                navigate({ page: 'settings' });
                close();
              }}
              className="flex items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-accent hover:bg-hover"
            >
              <Settings2 size={13} aria-hidden />
              Manage views
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

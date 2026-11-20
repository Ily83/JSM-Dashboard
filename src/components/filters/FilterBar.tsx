import { memo, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { CircleHelp, FilterX, Plus, Search, TriangleAlert, X } from 'lucide-react';
import {
  FILTER_FIELDS,
  type DateFieldId,
  type FilterField,
  type FilterFieldId,
  type SetFieldId,
  type TextFieldId,
} from '../../config/filterFields';
import { QUICK_FILTERS, type QuickFilterId } from '../../config/quickFilters';
import type { SectionDef } from '../../config/sections';
import { cn } from '../../lib/cn';
import {
  activeFields,
  withDate,
  withSet,
  withText,
  type FacetOption,
  type Facets,
  type Filters,
  type SetCondition,
} from '../../lib/filterEngine';
import { checkQuery, QUERY_HELP } from '../../lib/query';
import { navigate } from '../../lib/router';
import { patchPrefs, type Profile } from '../../state/prefs';
import type { ViewState } from '../../state/views';
import { Popover } from '../ui/Popover';
import { DateFilter, SetFilter, TextFilter } from './FilterControls';

interface FilterBarProps {
  section: SectionDef;
  facets: Facets;
  view: ViewState;
  onChange: (patch: Partial<ViewState>) => void;
  onClearAll: () => void;
  quickCounts: Record<QuickFilterId, number>;
  pinned: FilterFieldId[];
  showQuickFilters: boolean;
  profile: Profile;
  shown: number;
  total: number;
  /** Controls at the right end: views, density, columns. */
  children?: ReactNode;
}

const segment = (active: boolean) =>
  cn(
    'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium',
    active ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-panel text-muted hover:bg-hover hover:text-fg',
  );

type TriggerRender = ComponentProps<typeof Popover>['trigger'];

/** The values a section allows for a field it restricts (priority or status). */
function sectionValues(section: SectionDef, id: SetFieldId): readonly string[] | undefined {
  if (id === 'priority') return section.priority;
  if (id === 'status') return section.status;
  return undefined;
}

/** "My Customers" and "Watching" appear once there is something to show. */
function hasContent(id: QuickFilterId, profile: Profile, quickCounts: Record<QuickFilterId, number>): boolean {
  if (id === 'myCustomers') return profile.customers.length > 0;
  if (id === 'watching') return quickCounts.watching > 0;
  return true;
}

function searchBorder(queryCheck: ReturnType<typeof checkQuery>): string {
  if (!queryCheck.ok) return 'border-crit';
  return queryCheck.structured ? 'border-accent font-mono' : 'border-line-strong';
}

/** "Assigned to Me" before the user's name is known: the radio opens a name picker. */
function chooseNameTrigger(label: string): TriggerRender {
  return (props) => (
    <button type="button" role="radio" aria-checked={false} {...props} className={segment(false)}>
      {label}
    </button>
  );
}

/** Asks once who "me" is, from the assignees in the data, for "Assigned to Me". */
function ChooseName({ label, assignees, onPick }: Readonly<{ label: string; assignees: FacetOption[]; onPick: (name: string) => void }>) {
  return (
    <Popover label="Choose your name" className="w-56" trigger={chooseNameTrigger(label)}>
      {(close) => (
        <div className="p-1">
          <p className="px-2 py-1 text-[11px] font-medium text-muted">Who are you?</p>
          <ul className="max-h-64 overflow-auto">
            {assignees
              .filter((o) => o.value !== '')
              .map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(o.value);
                      close();
                    }}
                    className="w-full truncate rounded px-2 py-1 text-left hover:bg-hover"
                  >
                    {o.value}
                  </button>
                </li>
              ))}
          </ul>
          <button
            type="button"
            onClick={() => navigate({ page: 'settings' })}
            className="mt-1 w-full rounded border-t border-line px-2 py-1 text-left text-xs text-accent hover:bg-hover"
          >
            Other name…
          </button>
        </div>
      )}
    </Popover>
  );
}

const moreTrigger: TriggerRender = (props, open) => (
  <button
    type="button"
    {...props}
    className={cn(
      'flex h-7 items-center gap-1 rounded-md border border-dashed border-line-strong px-2 text-xs font-medium',
      open ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg',
    )}
  >
    <Plus size={13} aria-hidden />
    More
  </button>
);

export const FilterBar = memo(function FilterBar({
  section,
  facets,
  view,
  onChange,
  onClearAll,
  quickCounts,
  pinned,
  showQuickFilters,
  profile,
  shown,
  total,
  children,
}: FilterBarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const { filters, search, quick } = view;
  const queryCheck = useMemo(() => checkQuery(search), [search]);
  /** Filters added from "More" during this session. */
  const [extra, setExtra] = useState<FilterFieldId[]>([]);
  const [justAdded, setJustAdded] = useState<FilterFieldId | null>(null);

  // "/" focuses the search field, as in most consoles.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const setFilters = (next: Filters) => onChange({ filters: next });
  const active = new Set(activeFields(filters));
  const fixedBySection = (id: FilterFieldId) =>
    (id === 'priority' && section.priority?.length === 1) || (id === 'status' && section.status?.length === 1);
  const available = FILTER_FIELDS.filter((f) => !fixedBySection(f.id as FilterFieldId));
  const isShown = (f: FilterField) => pinned.includes(f.id as FilterFieldId) || active.has(f.id as FilterFieldId) || extra.includes(f.id as FilterFieldId);
  const shownFields = available.filter(isShown);
  const moreFields = available.filter((f) => !isShown(f));
  const hasAnything = active.size > 0 || search.trim() !== '' || quick !== null;

  /** Within a section that restricts a field, selections outside the restriction are not shown. */
  const scoped = (id: SetFieldId): SetCondition | undefined => {
    const condition = filters.set[id];
    const allowed = sectionValues(section, id);
    if (!condition || !allowed) return condition;
    return { ...condition, include: condition.include.filter((v) => allowed.includes(v)), exclude: condition.exclude.filter((v) => allowed.includes(v)) };
  };

  const quickFilters = QUICK_FILTERS.filter((q) => quick === q.id || hasContent(q.id, profile, quickCounts));

  const addField = (id: FilterFieldId) => {
    setExtra((ids) => [...ids, id]);
    setJustAdded(id);
  };

  return (
    <div className="border-y border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-1.5">
        <div className="relative w-60 flex-none max-sm:w-full">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => onChange({ search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && search) {
                event.stopPropagation();
                onChange({ search: '' });
              }
            }}
            placeholder="Search alerts"
            aria-label="Search alerts"
            aria-keyshortcuts="/"
            aria-invalid={!queryCheck.ok || undefined}
            aria-describedby={queryCheck.ok ? undefined : 'search-error'}
            spellCheck={false}
            className={cn(
              'h-7 w-full rounded-md border bg-bg pl-7 pr-7 text-xs text-fg placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden',
              searchBorder(queryCheck),
            )}
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                onChange({ search: '' });
                searchRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:bg-hover hover:text-fg"
            >
              <X size={13} aria-hidden />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line-strong px-1 font-mono text-[10px] text-subtle">/</kbd>
          )}
        </div>
        <span
          className="-ml-1 flex size-5 flex-none cursor-help items-center justify-center text-subtle hover:text-fg"
          data-tip={QUERY_HELP}
          data-tip-always=""
          aria-label="Search syntax"
          role="img"
        >
          <CircleHelp size={13} aria-hidden />
        </span>
        {!queryCheck.ok && (
          <span id="search-error" role="alert" className="flex max-w-56 flex-none items-center gap-1 text-[11px] font-medium text-crit" data-tip={`${queryCheck.error}\nSearching the words instead.`} data-tip-always="">
            <TriangleAlert size={12} aria-hidden className="flex-none" />
            <span className="truncate">{queryCheck.error}</span>
          </span>
        )}

        {showQuickFilters && (
          <div role="radiogroup" aria-label="Quick filters" className="flex min-w-0 flex-wrap items-center gap-1">
            <button type="button" role="radio" aria-checked={quick === null} onClick={() => onChange({ quick: null })} className={segment(quick === null)}>
              All
            </button>
            {quickFilters.map((q) => {
              const needsName = q.id === 'mine' && !profile.name;
              const content = (
                <>
                  {q.label}
                  <span className={cn('tabular-nums', quick === q.id ? 'opacity-80' : 'text-subtle')}>{quickCounts[q.id]}</span>
                </>
              );
              if (needsName) {
                // "Assigned to Me" needs to know who "me" is: ask once.
                return (
                  <ChooseName
                    key={q.id}
                    label={q.label}
                    assignees={facets.assignee}
                    onPick={(name) => {
                      patchPrefs({ profile: { ...profile, name } });
                      onChange({ quick: 'mine' });
                    }}
                  />
                );
              }
              return (
                <button
                  key={q.id}
                  type="button"
                  role="radio"
                  aria-checked={quick === q.id}
                  data-tip={q.description}
                  data-tip-always=""
                  onClick={() => onChange({ quick: quick === q.id ? null : q.id })}
                  className={segment(quick === q.id)}
                >
                  {content}
                </button>
              );
            })}
          </div>
        )}

      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-1.5" aria-label="Filters">
        {shownFields.map((field) => {
          const defaultOpen = justAdded === field.id;
          if (field.kind === 'set') {
            const id = field.id as SetFieldId;
            return (
              <SetFilter
                key={id}
                field={field}
                options={facets[id]}
                condition={scoped(id)}
                defaultOpen={defaultOpen}
                onChange={(condition) => setFilters(withSet(filters, id, condition))}
              />
            );
          }
          if (field.kind === 'date') {
            const id = field.id as DateFieldId;
            return (
              <DateFilter
                key={id}
                field={field}
                condition={filters.date[id]}
                defaultOpen={defaultOpen}
                onChange={(condition) => setFilters(withDate(filters, id, condition))}
              />
            );
          }
          const id = field.id as TextFieldId;
          return (
            <TextFilter
              key={id}
              field={field}
              value={filters.text[id]}
              defaultOpen={defaultOpen}
              onChange={(value) => setFilters(withText(filters, id, value))}
            />
          );
        })}

        {moreFields.length > 0 && (
          <Popover
            label="More filters"
            className="w-48 p-1"
            trigger={moreTrigger}
          >
            {(close) => (
              <ul>
                {moreFields.map((field) => (
                  <li key={field.id}>
                    <button
                      type="button"
                      onClick={() => {
                        addField(field.id as FilterFieldId);
                        close();
                      }}
                      className="w-full rounded px-2 py-1 text-left hover:bg-hover"
                    >
                      {field.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover>
        )}

        <button
          type="button"
          disabled={!hasAnything}
          onClick={() => {
            onClearAll();
            setExtra([]);
            setJustAdded(null);
          }}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-hover disabled:text-subtle disabled:hover:bg-transparent"
        >
          <FilterX size={13} aria-hidden />
          Clear all
        </button>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <span className="mr-1 whitespace-nowrap text-xs tabular-nums text-muted" aria-live="polite">
            <strong className="font-semibold text-fg">{shown.toLocaleString()}</strong>
            {shown !== total && <> of {total.toLocaleString()}</>} alert{total === 1 ? '' : 's'}
          </span>
          {children}
        </div>
      </div>
    </div>
  );
});

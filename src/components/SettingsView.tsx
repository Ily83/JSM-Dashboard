import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, Play, RotateCcw, Star, Trash2 } from 'lucide-react';
import type { StatusResponse } from '../../shared/types';
import { COLUMN_INFO } from '../config/columns';
import { FILTER_FIELDS, type FilterFieldId } from '../config/filterFields';
import { SECTIONS } from '../config/sections';
import { GRID_COLUMNS, WIDGET_BY_ID } from '../config/widgets';
import { cn } from '../lib/cn';
import { formatAbsolute } from '../lib/format';
import { getPreferenceStorage } from '../lib/storage';
import { suspendPersistence, useStore } from '../lib/store';
import {
  DEFAULT_DASHBOARD,
  dashboardStore,
  resizeWidget,
  setDashboardCollapsed,
  setWidgetVisible,
  shiftWidget,
} from '../state/dashboard';
import { DENSITIES, REFRESH_OPTIONS, patchPrefs, prefsStore, type Theme } from '../state/prefs';
import { DEFAULT_TABLE_LAYOUT, moveColumn, setColumnVisible, tableLayoutStore } from '../state/tableLayout';
import {
  applyView,
  deleteView,
  duplicateView,
  moveView,
  renameView,
  setDefaultView,
  setViewLayout,
  viewsStore,
} from '../state/views';
import { CustomerBadge } from './ui/badges';

/**
 * Settings. Every control here writes to one of the preference stores, and
 * the lists are generated from the registries in src/config, so a new column,
 * filter or widget shows up here without changes to this file.
 */

function Card({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`settings-${id}`} className="rounded-lg border border-line bg-panel">
      <div className="flex h-10 items-center justify-between border-b border-line px-4">
        <h2 id={`settings-${id}`} className="text-[13px] font-semibold">
          {title}
        </h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        {hint && <div className="text-xs text-subtle">{hint}</div>}
      </div>
      <div className="flex flex-none items-center gap-2">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex overflow-hidden rounded-md border border-line-strong">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 border-r border-line-strong px-2.5 text-xs font-medium last:border-r-0',
            value === option.value ? 'bg-accent text-on-accent' : 'text-muted hover:bg-hover hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-5 w-9 rounded-full transition-colors motion-reduce:transition-none', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={cn('absolute top-0.5 size-4 rounded-full bg-panel shadow transition-[left] motion-reduce:transition-none', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

const resetButton = 'flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-accent hover:bg-hover';
const smallIcon = 'rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent';
const select = 'h-7 rounded-md border border-line-strong bg-panel px-1.5 text-xs text-fg';
const th = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted';

function MoveButtons({ label, index, count, onMove }: { label: string; index: number; count: number; onMove: (delta: -1 | 1) => void }) {
  return (
    <span className="flex">
      <button type="button" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(-1)} className={smallIcon}>
        <ArrowUp size={13} aria-hidden />
      </button>
      <button type="button" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(1)} className={smallIcon}>
        <ArrowDown size={13} aria-hidden />
      </button>
    </span>
  );
}

interface SettingsViewProps {
  status: StatusResponse | undefined;
  /** Values seen in the current data, offered in the profile fields. */
  assignees: string[];
  customers: string[];
}

export function SettingsView({ status, assignees, customers }: SettingsViewProps) {
  const prefs = useStore(prefsStore);
  const table = useStore(tableLayoutStore);
  const dashboard = useStore(dashboardStore);
  const views = useStore(viewsStore);
  const [confirmReset, setConfirmReset] = useState(false);

  const refresh = prefs.refreshSeconds ?? status?.defaultRefreshSeconds ?? 60;
  const refreshOptions = [...new Set([...REFRESH_OPTIONS, refresh])].sort((a, b) => a - b);
  const customerOptions = [...new Set([...customers, ...prefs.profile.customers])].sort((a, b) => a.localeCompare(b));

  const togglePinned = (id: FilterFieldId, pinned: boolean) =>
    patchPrefs({ pinnedFilters: pinned ? [...prefs.pinnedFilters, id] : prefs.pinnedFilters.filter((f) => f !== id) });
  const toggleCustomer = (name: string) =>
    patchPrefs({
      profile: {
        ...prefs.profile,
        customers: prefs.profile.customers.includes(name) ? prefs.profile.customers.filter((c) => c !== name) : [...prefs.profile.customers, name],
      },
    });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-3 p-4 lg:grid-cols-2">
        <Card id="appearance" title="Appearance">
          <Row label="Theme">
            <Segmented<Theme>
              label="Theme"
              value={prefs.theme}
              onChange={(theme) => patchPrefs({ theme })}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'System' },
              ]}
            />
          </Row>
          <Row label="Density">
            <Segmented label="Density" value={prefs.density} onChange={(density) => patchPrefs({ density })} options={DENSITIES.map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1) }))} />
          </Row>
          <Row label="Highlight critical alerts">
            <Toggle label="Highlight critical alerts" checked={prefs.highlightCritical} onChange={(highlightCritical) => patchPrefs({ highlightCritical })} />
          </Row>
        </Card>

        <Card id="refresh" title="Refresh">
          <Row label="Auto-refresh" hint={status ? `Server default ${status.defaultRefreshSeconds}s · Jira is queried at most every ${status.cacheTtlSeconds}s` : undefined}>
            <select className={select} aria-label="Auto-refresh interval" value={refresh} onChange={(event) => patchPrefs({ refreshSeconds: Number(event.target.value) })}>
              {refreshOptions.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds === 0 ? 'Off' : seconds < 60 ? `${seconds} seconds` : `${seconds / 60} min`}
                </option>
              ))}
            </select>
            <button type="button" className={resetButton} onClick={() => patchPrefs({ refreshSeconds: null })}>
              Default
            </button>
          </Row>
        </Card>

        <Card id="information" title="Visible information">
          <Row label="Timestamps">
            <Segmented
              label="Timestamps"
              value={prefs.timeFormat}
              onChange={(timeFormat) => patchPrefs({ timeFormat })}
              options={[
                { value: 'relative', label: 'Relative' },
                { value: 'absolute', label: 'Date and time' },
              ]}
            />
          </Row>
          <Row label="Tags next to customers">
            <Toggle label="Tags next to customers" checked={prefs.showTags} onChange={(showTags) => patchPrefs({ showTags })} />
          </Row>
          <Row label="Occurrence counter">
            <Toggle label="Occurrence counter" checked={prefs.showOccurrences} onChange={(showOccurrences) => patchPrefs({ showOccurrences })} />
          </Row>
          <Row label="Quick-filter bar">
            <Toggle label="Quick-filter bar" checked={prefs.showQuickFilters} onChange={(showQuickFilters) => patchPrefs({ showQuickFilters })} />
          </Row>
          <Row label="Dashboard">
            <Toggle label="Dashboard" checked={!dashboard.collapsed} onChange={(shown) => setDashboardCollapsed(!shown)} />
          </Row>
        </Card>

        <Card id="profile" title="Profile">
          <Row label="Your name" hint="As shown in the Assignee column. Used by “Assigned to Me”.">
            <input
              list="settings-assignees"
              value={prefs.profile.name ?? ''}
              onChange={(event) => patchPrefs({ profile: { ...prefs.profile, name: event.target.value || null } })}
              placeholder="Not set"
              aria-label="Your name"
              className="h-7 w-48 rounded-md border border-line-strong bg-bg px-2 text-xs placeholder:text-subtle"
            />
            <datalist id="settings-assignees">
              {assignees.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Row>
          <div className="pt-2">
            <div className="font-medium">My customers</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {customerOptions.length === 0 && <span className="text-xs text-subtle">No customers in the current data</span>}
              {customerOptions.map((name) => {
                const selected = prefs.profile.customers.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleCustomer(name)}
                    className={cn('rounded-md p-0.5', selected ? 'outline-2 outline-accent' : 'opacity-50 hover:opacity-100')}
                  >
                    <CustomerBadge name={name} />
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        <Card
          id="views"
          title="Saved views and default filters"
        >
          <Row label="Default view" hint="Shown when the application is opened.">
            <select className={cn(select, 'max-w-56')} aria-label="Default view" value={views.defaultViewId ?? ''} onChange={(event) => setDefaultView(event.target.value || null)}>
              <option value="">Alert Center, no filters</option>
              {views.saved.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
          </Row>
          {views.saved.length > 0 && (
            <ul className="mt-2 grid gap-1 border-t border-line pt-2">
              {views.saved.map((view, index) => (
                <li key={view.id} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={views.defaultViewId === view.id ? 'Default view' : `Make ${view.name} the default view`}
                    aria-pressed={views.defaultViewId === view.id}
                    onClick={() => setDefaultView(views.defaultViewId === view.id ? null : view.id)}
                    className={cn(smallIcon, views.defaultViewId === view.id && 'text-warn')}
                  >
                    <Star size={14} aria-hidden className={cn(views.defaultViewId === view.id && 'fill-current')} />
                  </button>
                  <input
                    defaultValue={view.name}
                    key={view.name}
                    maxLength={80}
                    aria-label={`Name of view ${view.name}`}
                    onBlur={(event) => {
                      if (event.target.value.trim() && event.target.value !== view.name) renameView(view.id, event.target.value);
                      else event.target.value = view.name;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                    className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 font-medium hover:border-line-strong focus:border-line-strong focus:bg-bg"
                  />
                  <span className="flex-none text-xs text-subtle max-sm:hidden">{SECTIONS[view.section].label.replace(' Alerts', '')}</span>
                  <label className="flex flex-none cursor-pointer items-center gap-1 text-xs text-muted" data-tip="Applying this view also restores columns, dashboard and density" data-tip-always="">
                    <input type="checkbox" className="size-3.5 accent-(--accent)" checked={view.layout !== null} onChange={(event) => setViewLayout(view.id, event.target.checked)} />
                    Layout
                  </label>
                  <MoveButtons label={view.name} index={index} count={views.saved.length} onMove={(delta) => moveView(view.id, delta)} />
                  <button type="button" aria-label={`Open ${view.name}`} data-tip="Open" data-tip-always="" onClick={() => applyView(view.id)} className={smallIcon}>
                    <Play size={13} aria-hidden />
                  </button>
                  <button type="button" aria-label={`Duplicate ${view.name}`} data-tip="Duplicate" data-tip-always="" onClick={() => duplicateView(view.id)} className={smallIcon}>
                    <Copy size={13} aria-hidden />
                  </button>
                  <button type="button" aria-label={`Delete ${view.name}`} data-tip="Delete" data-tip-always="" onClick={() => deleteView(view.id)} className={cn(smallIcon, 'hover:text-crit')}>
                    <Trash2 size={13} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card id="filters" title="Filter bar">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {FILTER_FIELDS.map((field) => (
              <label key={field.id} className="flex cursor-pointer items-center gap-2 py-0.5" data-tip={field.description} data-tip-always="">
                <input
                  type="checkbox"
                  className="size-3.5 accent-(--accent)"
                  checked={prefs.pinnedFilters.includes(field.id as FilterFieldId)}
                  onChange={(event) => togglePinned(field.id as FilterFieldId, event.target.checked)}
                />
                {field.label}
              </label>
            ))}
          </div>
        </Card>

        <Card
          id="table"
          title="Table columns"
          action={
            <button type="button" className={resetButton} onClick={() => tableLayoutStore.set(DEFAULT_TABLE_LAYOUT())}>
              <RotateCcw size={12} aria-hidden />
              Reset
            </button>
          }
        >
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Column</th>
                <th className={th}>Width</th>
                <th className={cn(th, 'text-right')}>Order</th>
              </tr>
            </thead>
            <tbody>
              {table.columnOrder.map((id, index) => {
                const info = COLUMN_INFO[id];
                const width = table.columnSizing[id] ?? info.size;
                return (
                  <tr key={id} className="border-t border-line">
                    <td className="px-2 py-0.5">
                      <label className="flex cursor-pointer items-center gap-2 py-1">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-(--accent)"
                          checked={table.columnVisibility[id] !== false}
                          disabled={!info.hideable}
                          onChange={(event) => setColumnVisible(id, event.target.checked)}
                        />
                        {info.label}
                      </label>
                    </td>
                    <td className="px-2 py-0.5">
                      <input
                        type="number"
                        min={info.minSize}
                        max={1400}
                        step={10}
                        value={Math.round(width)}
                        aria-label={`Width of ${info.label} in pixels`}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next) && next >= info.minSize && next <= 1400) {
                            tableLayoutStore.set((layout) => ({ ...layout, columnSizing: { ...layout.columnSizing, [id]: next } }));
                          }
                        }}
                        className="h-7 w-20 rounded-md border border-line-strong bg-bg px-1.5 text-xs tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-0.5 text-right">
                      <MoveButtons label={info.label} index={index} count={table.columnOrder.length} onMove={(delta) => moveColumn(id, delta)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card
          id="dashboard"
          title="Dashboard widgets"
          action={
            <button type="button" className={resetButton} onClick={() => dashboardStore.set(DEFAULT_DASHBOARD())}>
              <RotateCcw size={12} aria-hidden />
              Reset
            </button>
          }
        >
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>Widget</th>
                <th className={th}>Width</th>
                <th className={th}>Height</th>
                <th className={cn(th, 'text-right')}>Order</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.widgets.map((placement, index) => {
                const def = WIDGET_BY_ID[placement.id];
                const widths = Array.from({ length: Math.min(def.maxW, GRID_COLUMNS) - def.minW + 1 }, (_, i) => def.minW + i);
                const heights = Array.from({ length: def.maxH - def.minH + 1 }, (_, i) => def.minH + i);
                return (
                  <tr key={placement.id} className="border-t border-line">
                    <td className="px-2 py-0.5">
                      <label className="flex cursor-pointer items-center gap-2 py-1" data-tip={def.description} data-tip-always="">
                        <input type="checkbox" className="size-3.5 accent-(--accent)" checked={placement.visible} onChange={(event) => setWidgetVisible(placement.id, event.target.checked)} />
                        {def.title}
                      </label>
                    </td>
                    <td className="px-2 py-0.5">
                      <select className={select} aria-label={`Width of ${def.title}`} value={placement.w} onChange={(event) => resizeWidget(placement.id, Number(event.target.value), placement.h)}>
                        {widths.map((w) => (
                          <option key={w} value={w}>
                            {w}/12
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-0.5">
                      <select className={select} aria-label={`Height of ${def.title}`} value={placement.h} onChange={(event) => resizeWidget(placement.id, placement.w, Number(event.target.value))}>
                        {heights.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-0.5 text-right">
                      <MoveButtons label={def.title} index={index} count={dashboard.widgets.length} onMove={(delta) => shiftWidget(placement.id, delta)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card id="connection" title="Connection">
          {status ? (
            <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              <dt className="text-muted">Mode</dt>
              <dd>{status.mode === 'demo' ? 'Demo (sample data)' : 'Live · read-only'}</dd>
              {status.site && (
                <>
                  <dt className="text-muted">Jira site</dt>
                  <dd className="break-all">{status.site}</dd>
                </>
              )}
              <dt className="text-muted">Last sync</dt>
              <dd className="tabular-nums">{formatAbsolute(status.meta.lastSyncAt)}</dd>
              <dt className="text-muted">Alerts loaded</dt>
              <dd className="tabular-nums">
                {status.meta.total.toLocaleString()}
                {status.meta.skipped > 0 && ` · ${status.meta.skipped} skipped (invalid)`}
              </dd>
              {status.mode === 'live' && (
                <>
                  <dt className="text-muted">Limits</dt>
                  <dd>
                    {status.limits.maxOpenAlerts.toLocaleString()} open · {status.limits.maxClosedAlerts.toLocaleString()} closed from the last {status.limits.closedLookbackHours} h
                  </dd>
                </>
              )}
              <dt className="text-muted">Customer from</dt>
              <dd className="break-words">
                tags {status.extraction.customerTagPrefixes.map((p) => `“${p}…”`).join(', ') || '–'} · properties {status.extraction.customerPropertyKeys.join(', ') || '–'}
              </dd>
              <dt className="text-muted">Service from</dt>
              <dd className="break-words">
                properties {status.extraction.servicePropertyKeys.join(', ') || '–'} · tags {status.extraction.serviceTagPrefixes.map((p) => `“${p}…”`).join(', ') || '–'}
                {status.extraction.serviceFallbackToEntity && ' · entity'}
              </dd>
              {status.warnings.map((warning) => (
                <dd key={warning} className="col-span-2 text-warn">
                  {warning}
                </dd>
              ))}
            </dl>
          ) : (
            <span className="text-subtle">Backend not reachable</span>
          )}
        </Card>

        <Card id="reset" title="Reset">
          <Row label="All preferences" hint="Theme, columns, dashboard, saved views, filters and profile in this browser.">
            {confirmReset ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    suspendPersistence();
                    const storage = getPreferenceStorage();
                    for (const key of ['prefs:v1', 'table:v1', 'dashboard:v1', 'views:v1']) storage.remove(key);
                    window.location.hash = '';
                    window.location.reload();
                  }}
                  className="h-7 rounded-md bg-crit px-2.5 text-xs font-semibold text-panel"
                >
                  Reset everything
                </button>
                <button type="button" onClick={() => setConfirmReset(false)} className="h-7 rounded-md border border-line-strong px-2.5 text-xs font-medium">
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmReset(true)} className="h-7 rounded-md border border-line-strong px-2.5 text-xs font-medium hover:bg-hover">
                Reset…
              </button>
            )}
          </Row>
        </Card>
      </div>
    </div>
  );
}

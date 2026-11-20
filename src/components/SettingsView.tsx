import { useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, Play, RotateCcw, Star, Trash2, Upload } from 'lucide-react';
import { ACTION_IDS, ACTION_LABEL } from '../../shared/actions';
import type { Alert, StatusResponse } from '../../shared/types';
import { trimChar } from '../lib/id';
import { desktopPermission, playAlarm, requestDesktopPermission, showDesktop, unlockAudio, type DesktopPermission } from '../lib/alarm';
import { COLUMN_INFO } from '../config/columns';
import { FILTER_FIELDS, type FilterFieldId } from '../config/filterFields';
import { SECTIONS } from '../config/sections';
import { GRID_COLUMNS, WIDGET_BY_ID } from '../config/widgets';
import { cn } from '../lib/cn';
import { formatAbsolute } from '../lib/format';
import { MAX_IMPORT_BYTES, parseImportFile, planViewImport, type ConflictChoice, type ImportPayload } from '../lib/preferencesTransfer';
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
import { applyImport, exportPreferences, exportView, TRANSFER_PARTS } from '../state/transfer';
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

function Card({ id, title, action, children }: Readonly<{ id: string; title: string; action?: ReactNode; children: ReactNode }>) {
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

function Row({ label, hint, children }: Readonly<{ label: string; hint?: string; children: ReactNode }>) {
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

function Segmented<T extends string | number>({ value, options, onChange, label }: Readonly<{ value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }>) {
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

function Toggle({ checked, onChange, label }: Readonly<{ checked: boolean; onChange: (checked: boolean) => void; label: string }>) {
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

const SAMPLE_P1: Alert = {
  id: 'alarm-test',
  tinyId: null,
  alias: null,
  summary: 'Test: this is how a new P1 alert is announced',
  priority: 'P1',
  status: 'open',
  rawStatus: 'open',
  acknowledged: false,
  customers: [],
  tags: [],
  service: 'Alert Center',
  entity: null,
  assignee: null,
  responders: [],
  source: 'Alert Center',
  rawSource: null,
  integrationName: null,
  integrationType: null,
  createdAt: 0,
  updatedAt: 0,
  lastOccurredAt: null,
  ackTime: null,
  closeTime: null,
  snoozedUntil: null,
  count: 1,
  url: null,
};

function desktopHint(permission: DesktopPermission): string {
  if (permission === 'unsupported') return 'Not supported by this browser';
  if (permission === 'denied') return 'Blocked in the browser settings';
  return 'New P1 alerts only';
}

/** P1 alarm: only P1 alerts, never other priorities. */
function P1AlarmCard({ sound, desktop }: Readonly<{ sound: boolean; desktop: boolean }>) {
  const [permission, setPermission] = useState<DesktopPermission>(desktopPermission);
  const [tested, setTested] = useState<string | null>(null);
  return (
    <Card id="p1-alarm" title="P1 alarm">
      <Row label="Sound" hint="New P1 alerts only">
        <Toggle
          label="Sound for new P1 alerts"
          checked={sound}
          onChange={(on) => {
            if (on) unlockAudio();
            patchPrefs({ p1Sound: on });
          }}
        />
      </Row>
      <Row label="Desktop notification" hint={desktopHint(permission)}>
        <Toggle
          label="Desktop notification for new P1 alerts"
          checked={desktop && permission === 'granted'}
          onChange={(on) => {
            if (!on) {
              patchPrefs({ p1Desktop: false });
              return;
            }
            void requestDesktopPermission().then((next) => {
              setPermission(next);
              patchPrefs({ p1Desktop: next === 'granted' });
            });
          }}
        />
      </Row>
      <Row label="Test">
        {tested && <span className="text-xs text-subtle">{tested}</span>}
        <button
          type="button"
          className={resetButton}
          onClick={() => {
            unlockAudio();
            // Give the audio context a moment to start on the first click.
            setTimeout(() => {
              const played = playAlarm();
              const shown = desktopPermission() === 'granted' ? showDesktop([SAMPLE_P1], () => undefined) : 0;
              setTested([played ? 'Sound played' : 'Sound unavailable', shown ? 'notification shown' : 'no notification'].join(' · '));
            }, 50);
          }}
        >
          Play test
        </button>
      </Row>
    </Card>
  );
}
const smallIcon = 'rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent';
const select = 'h-7 rounded-md border border-line-strong bg-panel px-1.5 text-xs text-fg';
const th = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted';

function MoveButtons({ label, index, count, onMove }: Readonly<{ label: string; index: number; count: number; onMove: (delta: -1 | 1) => void }>) {
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

function refreshLabel(seconds: number): string {
  if (seconds === 0) return 'Off';
  return seconds < 60 ? `${seconds} seconds` : `${seconds / 60} min`;
}

function modeLabel(status: StatusResponse): string {
  if (status.mode === 'demo') return 'Demo (sample data)';
  return status.readOnly ? 'Live · read-only' : 'Live · write actions on';
}

function writeActionsLabel(status: StatusResponse): ReactNode {
  if (!status.writes.enabled) {
    return <span data-tip="JIRA_WRITE_ACTIONS in .env" data-tip-always="">Off</span>;
  }
  if (status.writes.actions.length === ACTION_IDS.length) return `All${status.mode === 'demo' ? ' · sample data only' : ''}`;
  return status.writes.actions.map((id) => ACTION_LABEL[id]).join(', ');
}

interface SettingsViewProps {
  status: StatusResponse | undefined;
  /** Values seen in the current data, offered in the profile fields. */
  assignees: string[];
  customers: string[];
}

export function SettingsView({ status, assignees, customers }: Readonly<SettingsViewProps>) {
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
            <Segmented label="Density" value={prefs.density} onChange={(density) => patchPrefs({ density })} options={DENSITIES.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }))} />
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
                  {refreshLabel(seconds)}
                </option>
              ))}
            </select>
            <button type="button" className={resetButton} onClick={() => patchPrefs({ refreshSeconds: null })}>
              Default
            </button>
          </Row>
        </Card>

        <P1AlarmCard sound={prefs.p1Sound} desktop={prefs.p1Desktop} />

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
            <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1 border-t border-line pt-2">
              {views.saved.map((view, index) => (
                <li key={view.id} className="flex min-w-0 items-center gap-1">
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
                    {'Layout'}
                  </label>
                  <MoveButtons label={view.name} index={index} count={views.saved.length} onMove={(delta) => moveView(view.id, delta)} />
                  <button type="button" aria-label={`Open ${view.name}`} data-tip="Open" data-tip-always="" onClick={() => applyView(view.id)} className={smallIcon}>
                    <Play size={13} aria-hidden />
                  </button>
                  <button type="button" aria-label={`Duplicate ${view.name}`} data-tip="Duplicate" data-tip-always="" onClick={() => duplicateView(view.id)} className={smallIcon}>
                    <Copy size={13} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Export ${view.name}`}
                    data-tip="Export"
                    data-tip-always=""
                    onClick={() => {
                      const file = exportView(view.id);
                      if (file) downloadJson(`alert-center-view-${slug(view.name)}.json`, file);
                    }}
                    className={smallIcon}
                  >
                    <Download size={13} aria-hidden />
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
              <dd>{modeLabel(status)}</dd>
              <dt className="text-muted">Write actions</dt>
              <dd className="break-words">{writeActionsLabel(status)}</dd>
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
                {(status.extraction.customerCompanyTagPrefixes?.length ?? 0) > 0 && ` · company tags (${status.extraction.customerCompanyTagPrefixes.length} prefixes)`}
                {(status.extraction.customerMapRules ?? 0) > 0 && ` · mapping file (${status.extraction.customerMapRules} rules)`}
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

        <BackupCard />

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
                    globalThis.location.hash = '';
                    globalThis.location.reload();
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

// ---- Backup -------------------------------------------------------------------

function slug(name: string): string {
  return trimChar(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-').slice(0, 40) || 'view';
}

function downloadJson(fileName: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const outlineButton = 'flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-xs font-medium hover:bg-hover';

interface PendingImport {
  fileName: string;
  payload: ImportPayload;
  /** Keys of the parts that will be replaced. */
  parts: string[];
  views: boolean;
  choice: ConflictChoice;
}

function BackupCard() {
  const views = useStore(viewsStore);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const readFile = async (file: File) => {
    setPending(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setMessage({ tone: 'error', text: `File is larger than ${MAX_IMPORT_BYTES / 1024} KB.` });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setMessage({ tone: 'error', text: 'The file could not be read.' });
      return;
    }
    const result = parseImportFile(text, TRANSFER_PARTS);
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.error });
      return;
    }
    setMessage(null);
    setPending({
      fileName: file.name,
      payload: result.payload,
      parts: result.payload.parts.map((p) => p.key),
      views: result.payload.views.length > 0,
      choice: 'keepBoth',
    });
  };

  // Recomputed on every render, so the preview follows changes made meanwhile.
  const plan = pending ? planViewImport(views.saved, pending.payload.views) : null;
  const importsViews = pending !== null && plan !== null && pending.views && plan.added.length + plan.conflicts.length > 0;
  const nothingSelected = pending !== null && pending.parts.length === 0 && !importsViews;

  const confirm = () => {
    if (!pending) return;
    const outcome = applyImport(pending.payload, { parts: pending.parts, views: importsViews, choice: pending.choice });
    const done = [
      ...outcome.replacedParts,
      outcome.viewsAdded > 0 ? `${plural(outcome.viewsAdded, 'view')} added` : '',
      outcome.viewsReplaced > 0 ? `${plural(outcome.viewsReplaced, 'view')} replaced` : '',
    ].filter(Boolean);
    setPending(null);
    setMessage({ tone: 'ok', text: done.length > 0 ? `Imported: ${done.join(' · ')}` : 'Nothing changed' });
  };

  const togglePart = (key: string, checked: boolean) =>
    setPending((p) => (p ? { ...p, parts: checked ? [...p.parts, key] : p.parts.filter((k) => k !== key) } : p));

  return (
    <Card id="backup" title="Backup">
      <Row label="Preferences and saved views">
        <button
          type="button"
          onClick={() => downloadJson(`alert-center-preferences-${new Date().toISOString().slice(0, 10)}.json`, exportPreferences())}
          className={outlineButton}
        >
          <Download size={13} aria-hidden />
          Export
        </button>
        <button type="button" onClick={() => input.current?.click()} className={outlineButton}>
          <Upload size={13} aria-hidden />
          Import…
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Import preferences file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void readFile(file);
          }}
        />
      </Row>
      <p className="text-xs text-subtle">No credentials or alerts. Customer names and tags in views and profile are included.</p>

      {message?.tone === 'error' && (
        <p role="alert" className="mt-2 text-xs text-crit">
          {message.text}
        </p>
      )}
      {message?.tone === 'ok' && <output className="mt-2 block text-xs text-ok">{message.text}</output>}

      {pending && plan && (
        <fieldset className="mt-3 min-w-0 rounded-md border border-line-strong p-3" aria-label="Import preview">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate font-medium">{pending.fileName}</span>
            {pending.payload.exportedAt && (
              <span className="flex-none text-xs tabular-nums text-subtle">{formatAbsolute(Date.parse(pending.payload.exportedAt))}</span>
            )}
          </div>
          <ul className="mt-2 grid gap-1">
            {pending.payload.parts.map((part) => (
              <li key={part.key}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-(--accent)"
                    checked={pending.parts.includes(part.key)}
                    onChange={(event) => togglePart(part.key, event.target.checked)}
                  />
                  {part.label}
                  <span className="ml-auto text-xs text-warn">Replace</span>
                </label>
              </li>
            ))}
            {pending.payload.views.length > 0 && (
              <li>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-(--accent)"
                    checked={pending.views}
                    onChange={(event) => setPending((p) => (p ? { ...p, views: event.target.checked } : p))}
                  />
                  {'Saved views'}
                  <span className="ml-auto text-xs tabular-nums text-muted">
                    {[
                      `${plan.added.length} new`,
                      plan.conflicts.length > 0 ? plural(plan.conflicts.length, 'conflict') : '',
                      plan.identical.length > 0 ? `${plan.identical.length} unchanged` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </label>
              </li>
            )}
          </ul>

          {pending.views && plan.conflicts.length > 0 && (
            <div className="mt-2 border-t border-line pt-2">
              <ul className="grid gap-0.5 text-xs" aria-label="Conflicting views">
                {plan.conflicts.slice(0, 8).map((conflict) => (
                  <li key={conflict.imported.id} className="flex gap-2">
                    <span className="min-w-0 truncate font-medium">{conflict.imported.name}</span>
                    <span className="ml-auto flex-none text-subtle">
                      {conflict.reason === 'id' ? `same id as “${conflict.existing.name}”` : 'same name'}
                    </span>
                  </li>
                ))}
                {plan.conflicts.length > 8 && <li className="text-subtle">+{plan.conflicts.length - 8}</li>}
              </ul>
              <div className="mt-2">
                <Segmented<ConflictChoice>
                  label="Conflicting views"
                  value={pending.choice}
                  onChange={(choice) => setPending((p) => (p ? { ...p, choice } : p))}
                  options={[
                    { value: 'keepBoth', label: 'Keep both' },
                    { value: 'replace', label: 'Replace' },
                  ]}
                />
              </div>
            </div>
          )}

          {pending.payload.ignored.length > 0 && <p className="mt-2 text-xs text-warn">Ignored: {pending.payload.ignored.join(', ')}</p>}

          <div className="mt-3 flex justify-end gap-1.5">
            <button type="button" onClick={() => setPending(null)} className="h-7 rounded-md border border-line-strong px-2.5 text-xs font-medium hover:bg-hover">
              Cancel
            </button>
            <button
              type="button"
              disabled={nothingSelected}
              onClick={confirm}
              className="h-7 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent disabled:opacity-40"
            >
              Import
            </button>
          </div>
        </fieldset>
      )}
    </Card>
  );
}

import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { SortingState } from '@tanstack/react-table';
import { Layers, Rows2, Rows3, Rows4, TriangleAlert } from 'lucide-react';
import type { Alert, SyncMeta } from '../shared/types';
import { useAlerts, useStatus, useWriteActions } from './api/hooks';
import { BulkActionBar, type AlertContextMenu } from './components/actions/BulkActions';
import { AlertsEmptyState } from './components/AlertsEmptyState';
import { useP1Alarm } from './components/useP1Alarm';
import { requestDesktopPermission, unlockAudio } from './lib/alarm';
import { CustomerScope } from './components/CustomerScope';
import { Dashboard } from './components/dashboard/Dashboard';
import type { WidgetActions } from './components/dashboard/widgets';
import { DetailPanel } from './components/DetailPanel';
import { FilterBar } from './components/filters/FilterBar';
import { Sidebar } from './components/Sidebar';
import { AlertTable } from './components/table/AlertTable';
import type { CellOptions } from './components/table/columns';
import { ColumnsMenu } from './components/table/ColumnsMenu';
import { LanesMenu } from './components/table/LanesMenu';
import { TopBar } from './components/TopBar';
import { TooltipLayer } from './components/ui/TooltipLayer';
import { ViewsMenu } from './components/ViewsMenu';
import { CopyLinkButton } from './components/CopyLinkButton';
import { useViewUrlSync } from './state/viewUrlSync';
import { QUICK_FILTERS, type QuickFilterContext, type QuickFilterId } from './config/quickFilters';
import { SECTIONS, SECTION_IDS, inSection, type SectionDef, type SectionId } from './config/sections';
import { cn } from './lib/cn';
import { formatClock } from './lib/format';
import { customerOptions, scopeAlerts } from './lib/customerScope';
import { buildFacets, filterAlerts } from './lib/filterEngine';
import { navigate, useRoute, type Route } from './lib/router';
import { computeStats } from './lib/stats';
import { useStore } from './lib/store';
import { dashboardStore, setDashboardCollapsed } from './state/dashboard';
import { DENSITIES, patchPrefs, prefsStore } from './state/prefs';
import { clearAllFilters, openSection, patchCurrentView, viewsStore, type ViewsData, type ViewState } from './state/views';
import { PageErrorBoundary } from './components/PageErrorBoundary';

// Pages other than the alerts page load on first visit, keeping the initial bundle small.
const HistoryView = lazy(() => import('./components/HistoryView').then((m) => ({ default: m.HistoryView })));
const WorkflowsView = lazy(() => import('./components/WorkflowsView').then((m) => ({ default: m.WorkflowsView })));
const NotificationsView = lazy(() => import('./components/NotificationsView').then((m) => ({ default: m.NotificationsView })));
const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })));
const PAGE_FALLBACK = (
  <div className="grid min-h-0 flex-1 content-start gap-2 p-4" aria-busy="true">
    <div className="skeleton h-5 w-1/3" />
    <div className="skeleton h-5 w-2/3" />
    <div className="skeleton h-5 w-1/2" />
  </div>
);

const NO_ALERTS: Alert[] = [];
const DENSITY_ICON = { compact: Rows4, comfortable: Rows3, spacious: Rows2 } as const;

function useAppliedTheme(theme: 'dark' | 'light' | 'system'): void {
  useEffect(() => {
    const media = globalThis.matchMedia('(prefers-color-scheme: light)');
    const systemTheme = () => (media.matches ? 'light' : 'dark');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? systemTheme() : theme;
    };
    apply();
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

/** Alerts per section, and per quick filter within the shown section. */
function countAlerts(alerts: readonly Alert[], section: SectionDef, profile: QuickFilterContext) {
  const sectionCounts = Object.fromEntries(SECTION_IDS.map((id) => [id, 0])) as Record<SectionId, number>;
  const quickCounts = Object.fromEntries(QUICK_FILTERS.map((q) => [q.id, 0])) as Record<QuickFilterId, number>;
  for (const alert of alerts) {
    for (const id of SECTION_IDS) if (inSection(alert, SECTIONS[id])) sectionCounts[id] += 1;
    if (!inSection(alert, section)) continue;
    for (const quick of QUICK_FILTERS) if (quick.test(alert, profile)) quickCounts[quick.id] += 1;
  }
  return { sectionCounts, quickCounts, sectionTotal: sectionCounts[section.id] };
}

/** The banner text while the shown data is out of date, or null. */
function staleNoticeText(meta: SyncMeta | undefined, hasAlerts: boolean, requestError: string | null): string | null {
  if (meta?.stale) {
    const shown = meta.lastSyncAt ? ` Showing data from ${formatClock(meta.lastSyncAt)}.` : '';
    return `${meta.error ?? 'Synchronisation failed.'}${shown}`;
  }
  return hasAlerts && requestError ? requestError : null;
}

function pageTitle(page: Route['page'], views: ViewsData, sectionLabel: string): string {
  if (page === 'settings') return 'Settings';
  if (page === 'history') return 'Alert history';
  if (page === 'workflows') return 'Workflows';
  if (page === 'notifications') return 'Alert notifications';
  return views.saved.find((v) => v.id === views.activeViewId)?.name ?? sectionLabel;
}

function alarmTip(on: boolean, sound: boolean, desktop: boolean): string {
  if (!on) return 'P1 alarm off';
  return `P1 alarm on: ${[sound && 'sound', desktop && 'desktop'].filter(Boolean).join(' + ')}`;
}

export function App() {
  const route = useRoute();
  const prefs = useStore(prefsStore);
  const views = useStore(viewsStore);
  const dashboardCollapsed = useStore(dashboardStore).collapsed;
  const [editingDashboard, setEditingDashboard] = useState(false);
  useAppliedTheme(prefs.theme);

  const status = useStatus();
  const refreshSeconds = prefs.refreshSeconds ?? status.data?.defaultRefreshSeconds ?? 60;
  const onHistory = route.page === 'history';
  const alarmOn = prefs.p1Sound || prefs.p1Desktop;
  // With the P1 alarm on, alerts keep being polled on History and in a hidden tab.
  const alertsQuery = useAlerts(refreshSeconds, !onHistory || alarmOn, alarmOn);
  const loadedAlerts = alertsQuery.data?.alerts ?? NO_ALERTS;
  const meta = alertsQuery.data?.meta;
  // Customer scope: limits KPIs, widgets, section and quick-filter counts and
  // the table together. Kept out of the views, so it never modifies one.
  const customerScope = prefs.customerScope;
  const alerts = useMemo(() => scopeAlerts(loadedAlerts, customerScope), [loadedAlerts, customerScope]);
  const scopeOptions = useMemo(() => customerOptions(loadedAlerts, customerScope), [loadedAlerts, customerScope]);

  const section = SECTIONS[route.section];
  const view = views.current;
  // Filters, search and sorting live in the address too, so a view can be shared as a link.
  useViewUrlSync(route, view);
  // Typing stays responsive on large lists: filtering follows a beat behind.
  const deferredSearch = useDeferredValue(view.search);

  const profile = useMemo<QuickFilterContext>(
    () => ({ me: prefs.profile.name, myCustomers: new Set(prefs.profile.customers), watched: new Set(prefs.watchList) }),
    [prefs.profile, prefs.watchList],
  );

  // Everything below derives from the one cached list: no request is made
  // when the section, a filter, the search text or the sorting changes.
  const facets = useMemo(() => buildFacets(alerts, section), [alerts, section]);
  const visible = useMemo(
    () => filterAlerts(alerts, { section, quick: view.quick, filters: view.filters, search: deferredSearch, profile, now: Date.now() }),
    [alerts, section, view.quick, view.filters, deferredSearch, profile],
  );
  const stats = useMemo(() => computeStats(alerts), [alerts]);
  const { sectionCounts, quickCounts, sectionTotal } = useMemo(() => countAlerts(alerts, section, profile), [alerts, section, profile]);

  // ---- Selection for bulk actions ---------------------------------------
  const writeActions = useWriteActions();
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<AlertContextMenu | null>(null);
  // Only alerts that are still listed count; leaving the section clears it.
  useEffect(() => {
    setChecked(new Set());
    setContextMenu(null);
  }, [route.section, route.page]);
  const checkedAlerts = useMemo(() => (checked.size === 0 ? NO_ALERTS : visible.filter((a) => checked.has(a.id))), [visible, checked]);
  const clearChecked = useCallback(() => setChecked(new Set()), []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const selectedAlert = useMemo(
    () => (route.alertId ? (loadedAlerts.find((a) => a.id === route.alertId) ?? null) : null),
    [loadedAlerts, route.alertId],
  );

  const openFromAlarm = useCallback((id: string) => navigate({ page: 'alerts', section: 'critical', alertId: id }), []);
  useP1Alarm(alertsQuery.data?.alerts, prefs.p1Sound, prefs.p1Desktop, openFromAlarm);
  const toggleAlarm = useCallback(() => {
    if (alarmOn) {
      patchPrefs({ p1Sound: false, p1Desktop: false });
      return;
    }
    // Called from the click: the only moment browsers allow these.
    unlockAudio();
    void requestDesktopPermission().then((permission) => patchPrefs({ p1Sound: true, p1Desktop: permission === 'granted' }));
  }, [alarmOn]);

  const selectAlert = useCallback((id: string) => navigate({ alertId: id }, { replace: true }), []);
  const closeDetail = useCallback(() => navigate({ alertId: null }, { replace: true }), []);
  const changeView = useCallback((patch: Partial<ViewState>) => patchCurrentView(patch), []);
  const changeSorting = useCallback((sorting: SortingState) => patchCurrentView({ sorting }), []);

  const widgetActions = useMemo<WidgetActions>(
    () => ({
      showSection: (id) => {
        viewsStore.set((data) => ({ ...data, activeViewId: null }));
        clearAllFilters();
        openSection(id);
      },
      filterBy: (field, value) => {
        viewsStore.set((data) => ({
          ...data,
          activeViewId: null,
          current: { ...data.current, quick: null, search: '', filters: { set: { [field]: { include: [value], exclude: [], match: 'any' } }, date: {}, text: {} } },
        }));
        navigate({ page: 'alerts', section: 'active', alertId: null });
      },
      openAlert: (id) => navigate({ alertId: id }, { replace: true }),
    }),
    [],
  );

  const cellOptions = useMemo<CellOptions>(
    () => ({ timeFormat: prefs.timeFormat, showTags: prefs.showTags, showOccurrences: prefs.showOccurrences, watched: profile.watched }),
    [prefs.timeFormat, prefs.showTags, prefs.showOccurrences, profile.watched],
  );

  const requestError = alertsQuery.error?.message ?? null;
  const nextDensity = DENSITIES[(DENSITIES.indexOf(prefs.density) + 1) % DENSITIES.length];
  const DensityIcon = DENSITY_ICON[prefs.density];

  const emptyState = (
    <AlertsEmptyState
      loading={alertsQuery.isPending}
      hasAlerts={loadedAlerts.length > 0}
      requestError={requestError}
      onRetry={alertsQuery.refresh}
      needsCustomers={view.quick === 'myCustomers' && prefs.profile.customers.length === 0}
      sectionTotal={sectionTotal}
      scoped={customerScope.length > 0}
    />
  );

  const staleNotice = staleNoticeText(meta, loadedAlerts.length > 0, requestError);

  return (
    <div className="flex h-full">
      <Sidebar
        route={route}
        counts={sectionCounts}
        countsKnown={alertsQuery.data !== undefined}
        collapsed={prefs.sidebarCollapsed}
        onToggle={() => patchPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })}
        views={views.saved}
        activeViewId={views.activeViewId}
        defaultViewId={views.defaultViewId}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={pageTitle(route.page, views, section.label)}
          demo={(meta?.mode ?? status.data?.mode) === 'demo'}
          meta={meta}
          isFetching={alertsQuery.isFetching}
          requestError={requestError}
          refreshSeconds={refreshSeconds}
          onRefreshSecondsChange={(seconds) => patchPrefs({ refreshSeconds: seconds })}
          onRefresh={alertsQuery.refresh}
          theme={prefs.theme}
          onThemeChange={(theme) => patchPrefs({ theme })}
          showLiveControls={!onHistory}
          canSignOut={status.data?.oauth === true}
          alarm={{
            on: alarmOn,
            tip: alarmTip(alarmOn, prefs.p1Sound, prefs.p1Desktop),
            onToggle: toggleAlarm,
          }}
          scope={
            route.page === 'alerts' ? (
              <CustomerScope options={scopeOptions} scope={customerScope} myCustomers={prefs.profile.customers} onChange={(next) => patchPrefs({ customerScope: next })} />
            ) : undefined
          }
          dashboard={
            route.page === 'alerts'
              ? {
                  collapsed: dashboardCollapsed,
                  editing: editingDashboard,
                  onToggleCollapsed: () => setDashboardCollapsed(!dashboardCollapsed),
                  onToggleEditing: () => setEditingDashboard((editing) => !editing),
                }
              : undefined
          }
        />

        {!onHistory && staleNotice && (
          <div role="alert" className="flex flex-none items-center gap-2 border-b border-crit/40 bg-crit-soft px-3 py-1.5 text-xs">
            <TriangleAlert size={14} aria-hidden className="flex-none text-crit" />
            <span className="min-w-0 flex-1">{staleNotice}</span>
            <button type="button" onClick={alertsQuery.refresh} className="flex-none rounded px-2 py-0.5 font-semibold text-accent hover:bg-hover">
              Retry
            </button>
          </div>
        )}
        {!onHistory && meta?.truncated && (
          <output className="block flex-none border-b border-warn/40 bg-warn-soft px-3 py-1.5 text-xs">
            {status.data ? `Jira holds more open alerts than the configured limit. Showing the newest ${status.data.limits.maxOpenAlerts.toLocaleString()}.` : 'The live list is limited to the newest open alerts.'}{' '}
            <a href="#/history" className="font-semibold underline">Browse alert history</a>
          </output>
        )}

        <PageErrorBoundary key={route.page}>
        <Suspense fallback={PAGE_FALLBACK}>
          {route.page === 'settings' && (
            <SettingsView
              status={status.data}
              assignees={facets.assignee.map((o) => o.value).filter(Boolean)}
              customers={scopeOptions.filter((o) => o.total > 0).map((o) => o.name)}
            />
          )}
          {onHistory && <HistoryView />}
          {route.page === 'notifications' && <NotificationsView />}
          {route.page === 'workflows' && <WorkflowsView alerts={loadedAlerts} site={status.data?.site} ready={alertsQuery.data !== undefined}
            limited={Boolean(meta?.truncated || meta?.stale || meta?.skipped)} />}
        </Suspense>
        </PageErrorBoundary>
        {route.page === 'alerts' && (
          <div className="relative flex min-h-0 flex-1">
            <main className="flex min-w-0 flex-1 flex-col">
              <Dashboard
                stats={stats}
                density={prefs.density}
                editing={editingDashboard}
                onDoneEditing={() => setEditingDashboard(false)}
                actions={widgetActions}
              />
              <div className="mt-2 flex min-h-0 flex-1 flex-col">
                <FilterBar
                  section={section}
                  facets={facets}
                  view={view}
                  onChange={changeView}
                  onClearAll={clearAllFilters}
                  quickCounts={quickCounts}
                  pinned={prefs.pinnedFilters}
                  showQuickFilters={prefs.showQuickFilters}
                  profile={prefs.profile}
                  shown={visible.length}
                  total={sectionTotal}
                >
                  <ViewsMenu section={section.id} />
                  <CopyLinkButton section={section.id} view={view} alertId={route.alertId} />
                  <button
                    type="button"
                    onClick={() => patchPrefs({ density: nextDensity })}
                    aria-label={`Density: ${prefs.density}. Switch to ${nextDensity}.`}
                    data-tip={`Density: ${prefs.density}`}
                    data-tip-always=""
                    className="flex size-7 items-center justify-center rounded-md border border-line-strong bg-panel text-muted hover:bg-hover hover:text-fg"
                  >
                    <DensityIcon size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => patchPrefs({ groupRepeats: !prefs.groupRepeats })}
                    aria-pressed={prefs.groupRepeats}
                    aria-label="Group repeats"
                    data-tip={prefs.groupRepeats ? 'Grouping repeats' : 'Group repeats'}
                    data-tip-always=""
                    className={cn(
                      'flex size-7 items-center justify-center rounded-md border hover:bg-hover hover:text-fg',
                      prefs.groupRepeats ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-panel text-muted',
                    )}
                  >
                    <Layers size={15} aria-hidden />
                  </button>
                  <LanesMenu value={prefs.laneBy} onChange={(laneBy) => patchPrefs({ laneBy })} />
                  <ColumnsMenu />
                </FilterBar>
                <BulkActionBar
                  selected={checkedAlerts}
                  allowed={writeActions}
                  onClear={clearChecked}
                  contextMenu={contextMenu}
                  onOpenMenu={setContextMenu}
                  onCloseMenu={closeContextMenu}
                  onOpenAlert={selectAlert}
                />
                <AlertTable
                  alerts={visible}
                  selectedId={route.alertId}
                  followFocus={route.alertId !== null}
                  onSelect={selectAlert}
                  sorting={view.sorting}
                  onSortingChange={changeSorting}
                  density={prefs.density}
                  cellOptions={cellOptions}
                  highlightCritical={prefs.highlightCritical}
                  emptyState={emptyState}
                  selection={checked}
                  onSelectionChange={setChecked}
                  onContextMenu={setContextMenu}
                  groupRepeats={prefs.groupRepeats}
                  laneBy={prefs.laneBy}
                />
              </div>
            </main>
            {route.alertId && <DetailPanel key={route.alertId} alert={selectedAlert} alertId={route.alertId} onClose={closeDetail} />}
          </div>
        )}
      </div>
      <TooltipLayer />
    </div>
  );
}

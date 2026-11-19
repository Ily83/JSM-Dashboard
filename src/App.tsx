import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { SortingState } from '@tanstack/react-table';
import { Rows2, Rows3, Rows4, SearchX, TriangleAlert } from 'lucide-react';
import type { Alert } from '../shared/types';
import { ApiRequestError } from './api/client';
import { useAlerts, useStatus } from './api/hooks';
import { Dashboard } from './components/dashboard/Dashboard';
import type { WidgetActions } from './components/dashboard/widgets';
import { DetailPanel } from './components/DetailPanel';
import { FilterBar } from './components/filters/FilterBar';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { AlertTable } from './components/table/AlertTable';
import type { CellOptions } from './components/table/columns';
import { ColumnsMenu } from './components/table/ColumnsMenu';
import { TopBar } from './components/TopBar';
import { TooltipLayer } from './components/ui/TooltipLayer';
import { ViewsMenu } from './components/ViewsMenu';
import { QUICK_FILTERS, type QuickFilterContext, type QuickFilterId } from './config/quickFilters';
import { SECTIONS, SECTION_IDS, inSection, type SectionId } from './config/sections';
import { formatClock } from './lib/format';
import { buildFacets, filterAlerts } from './lib/filterEngine';
import { navigate, useRoute } from './lib/router';
import { computeStats } from './lib/stats';
import { useStore } from './lib/store';
import { dashboardStore, setDashboardCollapsed } from './state/dashboard';
import { DENSITIES, patchPrefs, prefsStore, type Density } from './state/prefs';
import { clearAllFilters, openSection, patchCurrentView, viewsStore, type ViewState } from './state/views';

const NO_ALERTS: Alert[] = [];
const DENSITY_ICON = { compact: Rows4, comfortable: Rows3, spacious: Rows2 } as const;

function useAppliedTheme(theme: 'dark' | 'light' | 'system'): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme;
    };
    apply();
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
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
  const alertsQuery = useAlerts(refreshSeconds);
  const alerts = alertsQuery.data?.alerts ?? NO_ALERTS;
  const meta = alertsQuery.data?.meta;

  const section = SECTIONS[route.section];
  const view = views.current;
  // Typing stays responsive on large lists: filtering follows a beat behind.
  const deferredSearch = useDeferredValue(view.search);

  const profile = useMemo<QuickFilterContext>(
    () => ({ me: prefs.profile.name, myCustomers: new Set(prefs.profile.customers) }),
    [prefs.profile],
  );

  // Everything below derives from the one cached list: no request is made
  // when the section, a filter, the search text or the sorting changes.
  const facets = useMemo(() => buildFacets(alerts, section), [alerts, section]);
  const visible = useMemo(
    () => filterAlerts(alerts, { section, quick: view.quick, filters: view.filters, search: deferredSearch, profile, now: Date.now() }),
    [alerts, section, view.quick, view.filters, deferredSearch, profile],
  );
  const stats = useMemo(() => computeStats(alerts), [alerts]);
  const { sectionCounts, quickCounts, sectionTotal } = useMemo(() => {
    const sectionCounts = Object.fromEntries(SECTION_IDS.map((id) => [id, 0])) as Record<SectionId, number>;
    const quickCounts = Object.fromEntries(QUICK_FILTERS.map((q) => [q.id, 0])) as Record<QuickFilterId, number>;
    for (const alert of alerts) {
      for (const id of SECTION_IDS) if (inSection(alert, SECTIONS[id])) sectionCounts[id] += 1;
      if (!inSection(alert, section)) continue;
      for (const quick of QUICK_FILTERS) if (quick.test(alert, profile)) quickCounts[quick.id] += 1;
    }
    return { sectionCounts, quickCounts, sectionTotal: sectionCounts[section.id] };
  }, [alerts, section, profile]);

  const selectedAlert = useMemo(
    () => (route.alertId ? (alerts.find((a) => a.id === route.alertId) ?? null) : null),
    [alerts, route.alertId],
  );

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
    () => ({ timeFormat: prefs.timeFormat, showTags: prefs.showTags, showOccurrences: prefs.showOccurrences }),
    [prefs.timeFormat, prefs.showTags, prefs.showOccurrences],
  );

  const requestError = alertsQuery.error instanceof ApiRequestError || alertsQuery.error ? (alertsQuery.error?.message ?? null) : null;
  const firstLoad = alertsQuery.isPending;
  const nextDensity = DENSITIES[(DENSITIES.indexOf(prefs.density) + 1) % DENSITIES.length] as Density;
  const DensityIcon = DENSITY_ICON[prefs.density];

  let emptyState: React.ReactNode;
  if (firstLoad) {
    emptyState = (
      <div className="grid w-full max-w-3xl gap-2" aria-busy="true" aria-label="Loading alerts">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton h-5" style={{ width: `${100 - ((i * 13) % 35)}%` }} />
        ))}
      </div>
    );
  } else if (alerts.length === 0 && requestError) {
    emptyState = (
      <div className="max-w-md text-center">
        <TriangleAlert size={28} aria-hidden className="mx-auto text-crit" />
        <p className="mt-2 font-semibold">Alerts could not be loaded</p>
        <p className="mt-1 text-muted">{requestError}</p>
        <button type="button" onClick={alertsQuery.refresh} className="mt-3 h-7 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent">
          Try again
        </button>
      </div>
    );
  } else {
    const needsCustomers = view.quick === 'myCustomers' && prefs.profile.customers.length === 0;
    emptyState = (
      <div className="max-w-md text-center">
        <SearchX size={28} aria-hidden className="mx-auto text-subtle" />
        <p className="mt-2 font-semibold">{needsCustomers ? 'No customers selected' : sectionTotal === 0 ? 'No alerts here' : 'No alerts match'}</p>
        {needsCustomers ? (
          <a href="#/settings" className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
            Choose your customers in Settings
          </a>
        ) : (
          sectionTotal > 0 && (
            <button type="button" onClick={clearAllFilters} className="mt-2 text-xs font-medium text-accent hover:underline">
              Clear all filters
            </button>
          )
        )}
      </div>
    );
  }

  const staleNotice = meta?.stale
    ? `${meta.error ?? 'Synchronisation failed.'}${meta.lastSyncAt ? ` Showing data from ${formatClock(meta.lastSyncAt)}.` : ''}`
    : alerts.length > 0 && requestError
      ? requestError
      : null;

  return (
    <div className="flex h-full">
      <Sidebar
        route={route}
        counts={sectionCounts}
        collapsed={prefs.sidebarCollapsed}
        onToggle={() => patchPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })}
        views={views.saved}
        activeViewId={views.activeViewId}
        defaultViewId={views.defaultViewId}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={route.page === 'settings' ? 'Settings' : (views.saved.find((v) => v.id === views.activeViewId)?.name ?? section.label)}
          demo={(meta?.mode ?? status.data?.mode) === 'demo'}
          meta={meta}
          isFetching={alertsQuery.isFetching}
          requestError={requestError}
          refreshSeconds={refreshSeconds}
          onRefreshSecondsChange={(seconds) => patchPrefs({ refreshSeconds: seconds })}
          onRefresh={alertsQuery.refresh}
          theme={prefs.theme}
          onThemeChange={(theme) => patchPrefs({ theme })}
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

        {staleNotice && (
          <div role="alert" className="flex flex-none items-center gap-2 border-b border-crit/40 bg-crit-soft px-3 py-1.5 text-xs">
            <TriangleAlert size={14} aria-hidden className="flex-none text-crit" />
            <span className="min-w-0 flex-1">{staleNotice}</span>
            <button type="button" onClick={alertsQuery.refresh} className="flex-none rounded px-2 py-0.5 font-semibold text-accent hover:bg-hover">
              Retry
            </button>
          </div>
        )}
        {meta?.truncated && (
          <div role="status" className="flex-none border-b border-warn/40 bg-warn-soft px-3 py-1.5 text-xs">
            Jira holds more open alerts than the configured limit. Showing the newest {status.data?.limits.maxOpenAlerts.toLocaleString() ?? ''}.
          </div>
        )}

        {route.page === 'settings' ? (
          <SettingsView
            status={status.data}
            assignees={facets.assignee.map((o) => o.value).filter(Boolean)}
            customers={facets.customer.map((o) => o.value).filter(Boolean)}
          />
        ) : (
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
                  <ColumnsMenu />
                </FilterBar>
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

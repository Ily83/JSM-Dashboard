import { randomId } from '../lib/id';
import type { SortingState } from '@tanstack/react-table';
import { isColumnId } from '../config/columns';
import { NONE } from '../config/filterFields';
import { isQuickFilterId, type QuickFilterId } from '../config/quickFilters';
import { isSectionId, type SectionId } from '../config/sections';
import { EMPTY_FILTERS, sanitizeFilters, type Filters } from '../lib/filterEngine';
import { navigate } from '../lib/router';
import { createPersistentStore, deepEqual, isRecord } from '../lib/store';
import { dashboardStore, sanitizeDashboard, type DashboardLayout } from './dashboard';
import { DENSITIES, patchPrefs, prefsStore, type Density } from './prefs';
import { sanitizeTableLayout, tableLayoutStore, type TableLayout } from './tableLayout';

/**
 * Views: what the user is looking at now, and the named views they saved.
 *
 * A view is a section plus quick filter, filters, search text and sorting.
 * Optionally it also carries a layout (columns, dashboard widgets, density),
 * so "My Customers" can look different from "Unassigned Alerts".
 */

export interface ViewState {
  quick: QuickFilterId | null;
  filters: Filters;
  search: string;
  sorting: SortingState;
}

export interface ViewLayout {
  table: TableLayout;
  dashboard: DashboardLayout;
  density: Density;
}

export interface SavedView {
  id: string;
  name: string;
  section: SectionId;
  state: ViewState;
  /** null: the view does not change the layout when applied. */
  layout: ViewLayout | null;
}

export interface ViewsData {
  /** Live state of the screen. Persisted, so a reload shows the same list. */
  current: ViewState;
  /** The saved view the current state started from, if any. */
  activeViewId: string | null;
  saved: SavedView[];
  /** Applied when the application is opened without a specific address. */
  defaultViewId: string | null;
}

export const DEFAULT_SORTING: SortingState = [{ id: 'createdAt', desc: true }];
const BY_PRIORITY: SortingState = [
  { id: 'priority', desc: false },
  { id: 'createdAt', desc: true },
];

export const EMPTY_VIEW_STATE = (): ViewState => ({ quick: null, filters: EMPTY_FILTERS, search: '', sorting: DEFAULT_SORTING });

/** Starter views created on first use. They are ordinary views: rename, change or delete them. */
const STARTER_VIEWS = (): SavedView[] => [
  {
    id: 'starter-attention',
    name: 'Alerts Requiring Attention',
    section: 'active',
    layout: null,
    state: {
      quick: null,
      search: '',
      sorting: BY_PRIORITY,
      filters: {
        set: {
          priority: { include: ['P1', 'P2'], exclude: [], match: 'any' },
          acknowledged: { include: ['no'], exclude: [], match: 'any' },
        },
        date: {},
        text: {},
      },
    },
  },
  {
    id: 'starter-unassigned',
    name: 'Unassigned Alerts',
    section: 'active',
    layout: null,
    state: {
      quick: null,
      search: '',
      sorting: BY_PRIORITY,
      filters: { set: { assignee: { include: [NONE], exclude: [], match: 'any' } }, date: {}, text: {} },
    },
  },
  {
    id: 'starter-high',
    name: 'High Priority – All Customers',
    section: 'active',
    layout: null,
    state: {
      quick: null,
      search: '',
      sorting: BY_PRIORITY,
      filters: { set: { priority: { include: ['P1', 'P2'], exclude: [], match: 'any' } }, date: {}, text: {} },
    },
  },
  {
    id: 'starter-my-customers',
    name: 'My Customers',
    section: 'active',
    layout: null,
    state: { quick: 'myCustomers', search: '', sorting: BY_PRIORITY, filters: EMPTY_FILTERS },
  },
];

/** Validates a view state from storage, an imported file or a shared link. */
export function sanitizeViewState(stored: unknown): ViewState {
  const s = isRecord(stored) ? stored : {};
  const sorting: SortingState = Array.isArray(s.sorting)
    ? s.sorting
        .filter((item): item is { id: string; desc: unknown } => isRecord(item) && isColumnId(item.id))
        .slice(0, 3)
        .map((item) => ({ id: item.id, desc: item.desc === true }))
    : DEFAULT_SORTING;
  return {
    quick: isQuickFilterId(s.quick) ? s.quick : null,
    filters: sanitizeFilters(s.filters),
    search: typeof s.search === 'string' ? s.search.slice(0, 500) : '',
    sorting,
  };
}

function sanitizeLayout(stored: unknown): ViewLayout | null {
  if (!isRecord(stored)) return null;
  return {
    table: sanitizeTableLayout(stored.table),
    dashboard: sanitizeDashboard(stored.dashboard),
    density: (DENSITIES as readonly unknown[]).includes(stored.density) ? (stored.density as Density) : 'compact',
  };
}

/** One saved view, as stored or imported. Null when it has no id. */
export function sanitizeSavedView(item: unknown): SavedView | null {
  if (!isRecord(item) || typeof item.id !== 'string' || item.id === '') return null;
  return {
    id: item.id,
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : 'Untitled view',
    section: isSectionId(item.section) ? item.section : 'all',
    state: sanitizeViewState(item.state),
    layout: sanitizeLayout(item.layout),
  };
}

export const viewsStore = createPersistentStore<ViewsData>(
  'views:v1',
  () => ({ current: EMPTY_VIEW_STATE(), activeViewId: null, saved: STARTER_VIEWS(), defaultViewId: null }),
  (stored, fallback) => {
    if (!isRecord(stored)) return fallback;
    const ids = new Set<string>();
    const saved: SavedView[] = [];
    for (const item of Array.isArray(stored.saved) ? stored.saved : []) {
      const view = sanitizeSavedView(item);
      if (!view || ids.has(view.id)) continue;
      ids.add(view.id);
      saved.push(view);
    }
    const known = (id: unknown): string | null => (typeof id === 'string' && ids.has(id) ? id : null);
    return {
      current: sanitizeViewState(stored.current),
      activeViewId: known(stored.activeViewId),
      saved,
      defaultViewId: known(stored.defaultViewId),
    };
  },
);

// ---- Current state --------------------------------------------------------

export function patchCurrentView(patch: Partial<ViewState>): void {
  viewsStore.set((data) => ({ ...data, current: { ...data.current, ...patch } }));
}

/** Removes quick filter, filters and search. Sorting is kept. */
export function clearAllFilters(): void {
  patchCurrentView({ quick: null, filters: EMPTY_FILTERS, search: '' });
}

/**
 * Opens a sidebar section. Coming from a saved view, this leaves the view
 * and its filters behind; otherwise the current filters are kept, so the
 * same filter can be looked at across sections.
 */
export function openSection(section: SectionId): void {
  const data = viewsStore.get();
  if (data.activeViewId !== null) {
    viewsStore.set({ ...data, activeViewId: null, current: EMPTY_VIEW_STATE() });
  } else if (section === 'all' && !deepEqual(data.current.sorting, DEFAULT_SORTING)) {
    patchCurrentView({ sorting: DEFAULT_SORTING });
  }
  navigate({ page: 'alerts', section, alertId: null });
}

export function captureLayout(): ViewLayout {
  return { table: tableLayoutStore.get(), dashboard: dashboardStore.get(), density: prefsStore.get().density };
}

export function isViewModified(view: SavedView, section: SectionId, current: ViewState): boolean {
  return view.section !== section || !deepEqual(view.state, current);
}

// ---- Saved views ------------------------------------------------------------

export function newId(): string {
  return randomId('view');
}

export function uniqueName(name: string, saved: readonly SavedView[], ignoreId?: string): string {
  const base = name.trim().slice(0, 80) || 'Untitled view';
  const taken = new Set(saved.filter((v) => v.id !== ignoreId).map((v) => v.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Shows a saved view: section, filters, sorting and, if it has one, its layout. */
export function applyView(id: string): void {
  const view = viewsStore.get().saved.find((v) => v.id === id);
  if (!view) return;
  viewsStore.set((data) => ({ ...data, current: view.state, activeViewId: view.id }));
  if (view.layout) {
    tableLayoutStore.set(view.layout.table);
    dashboardStore.set(view.layout.dashboard);
    patchPrefs({ density: view.layout.density });
  }
  navigate({ page: 'alerts', section: view.section, alertId: null });
}

export function saveViewAs(name: string, section: SectionId, includeLayout: boolean): string {
  const id = newId();
  viewsStore.set((data) => ({
    ...data,
    activeViewId: id,
    saved: [
      ...data.saved,
      { id, name: uniqueName(name, data.saved), section, state: data.current, layout: includeLayout ? captureLayout() : null },
    ],
  }));
  return id;
}

/** Overwrites a saved view with what is on screen now. */
export function updateView(id: string, section: SectionId, includeLayout?: boolean): void {
  viewsStore.set((data) => ({
    ...data,
    activeViewId: id,
    saved: data.saved.map((view) =>
      view.id === id
        ? {
            ...view,
            section,
            state: data.current,
            layout: (includeLayout ?? view.layout !== null) ? captureLayout() : null,
          }
        : view,
    ),
  }));
}

export function renameView(id: string, name: string): void {
  viewsStore.set((data) => ({
    ...data,
    saved: data.saved.map((view) => (view.id === id ? { ...view, name: uniqueName(name, data.saved, id) } : view)),
  }));
}

export function duplicateView(id: string): string | null {
  const source = viewsStore.get().saved.find((v) => v.id === id);
  if (!source) return null;
  const copyId = newId();
  viewsStore.set((data) => {
    const index = data.saved.findIndex((v) => v.id === id);
    const saved = [...data.saved];
    saved.splice(index + 1, 0, { ...source, id: copyId, name: uniqueName(`${source.name} copy`, data.saved) });
    return { ...data, saved };
  });
  return copyId;
}

export function deleteView(id: string): void {
  viewsStore.set((data) => ({
    ...data,
    saved: data.saved.filter((v) => v.id !== id),
    activeViewId: data.activeViewId === id ? null : data.activeViewId,
    defaultViewId: data.defaultViewId === id ? null : data.defaultViewId,
  }));
}

export function setDefaultView(id: string | null): void {
  viewsStore.set((data) => ({ ...data, defaultViewId: id }));
}

export function setViewLayout(id: string, includeLayout: boolean): void {
  viewsStore.set((data) => ({
    ...data,
    saved: data.saved.map((view) => (view.id === id ? { ...view, layout: includeLayout ? captureLayout() : null } : view)),
  }));
}

export function moveView(id: string, delta: -1 | 1): void {
  viewsStore.set((data) => {
    const saved = [...data.saved];
    const from = saved.findIndex((v) => v.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= saved.length) return data;
    [saved[from], saved[to]] = [saved[to], saved[from]];
    return { ...data, saved };
  });
}

/** Called once at start-up: opening the application without an address shows the default view. */
export function applyDefaultViewOnStart(): void {
  const { defaultViewId } = viewsStore.get();
  const hash = globalThis.location.hash.replace(/^#\/?/, '');
  if (defaultViewId && hash === '') applyView(defaultViewId);
}

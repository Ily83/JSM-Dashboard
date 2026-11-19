import { LANE_FIELDS, type LaneBy } from '../lib/tableItems';
import { FILTER_FIELDS, isFilterFieldId, type FilterFieldId } from '../config/filterFields';
import { createPersistentStore, isRecord } from '../lib/store';

/** General preferences of one user. */

export type Theme = 'dark' | 'light' | 'system';
export const DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
export type Density = (typeof DENSITIES)[number];
export const REFRESH_OPTIONS = [0, 15, 30, 60, 120, 300] as const;

export interface Profile {
  /** The user's name as shown in the Assignee column; drives "Assigned to Me". */
  name: string | null;
  /** Customers the user looks after; drives "My Customers". */
  customers: string[];
}

export interface Preferences {
  theme: Theme;
  density: Density;
  /** Auto-refresh interval in seconds. null = server default, 0 = off. */
  refreshSeconds: number | null;
  sidebarCollapsed: boolean;
  /** Filters shown directly in the filter bar; the others are under "More". */
  pinnedFilters: FilterFieldId[];
  showQuickFilters: boolean;
  timeFormat: 'relative' | 'absolute';
  /** Show non-customer tags next to the customer badges in the table. */
  showTags: boolean;
  /** Show the "×N" occurrence counter next to the summary. */
  showOccurrences: boolean;
  highlightCritical: boolean;
  /** Collapse repeated alerts (same alias, or same source and similar summary) into expandable groups. */
  groupRepeats: boolean;
  /** Split the table into lanes by customer, service or team. */
  laneBy: LaneBy;
  profile: Profile;
  /**
   * Customers that KPIs, widgets, counts and the table are limited to.
   * Empty: all customers. Independent of saved views.
   */
  customerScope: string[];
  /** P1 alarm: a tone when a P1 alert arrives. */
  p1Sound: boolean;
  /** P1 alarm: a desktop notification when a P1 alert arrives. */
  p1Desktop: boolean;
  /** Alert ids the user follows ("Watching"). */
  watchList: string[];
}

export const MAX_WATCHED = 200;

export const MAX_SCOPE_CUSTOMERS = 50;

function sanitizeNames(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim().slice(0, 200);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
    if (names.length >= max) break;
  }
  return names;
}

export const DEFAULT_PREFS = (): Preferences => ({
  theme: 'dark',
  density: 'compact',
  refreshSeconds: null,
  sidebarCollapsed: false,
  pinnedFilters: FILTER_FIELDS.filter((f) => f.pinnedByDefault).map((f) => f.id as FilterFieldId),
  showQuickFilters: true,
  timeFormat: 'relative',
  showTags: true,
  showOccurrences: true,
  highlightCritical: true,
  groupRepeats: false,
  laneBy: 'off',
  profile: { name: null, customers: [] },
  customerScope: [],
  p1Sound: false,
  p1Desktop: false,
  watchList: [],
});

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

export function sanitizePrefs(stored: unknown, fallback: Preferences = DEFAULT_PREFS()): Preferences {
  if (!isRecord(stored)) return fallback;
  const profile = isRecord(stored.profile) ? stored.profile : {};
  return {
    theme: stored.theme === 'light' || stored.theme === 'system' || stored.theme === 'dark' ? stored.theme : fallback.theme,
    density: (DENSITIES as readonly unknown[]).includes(stored.density) ? (stored.density as Density) : fallback.density,
    refreshSeconds:
      typeof stored.refreshSeconds === 'number' && stored.refreshSeconds >= 0 && stored.refreshSeconds <= 3600
        ? stored.refreshSeconds
        : null,
    sidebarCollapsed: bool(stored.sidebarCollapsed, false),
    pinnedFilters: Array.isArray(stored.pinnedFilters)
      ? [...new Set(stored.pinnedFilters.filter(isFilterFieldId))]
      : fallback.pinnedFilters,
    showQuickFilters: bool(stored.showQuickFilters, true),
    timeFormat: stored.timeFormat === 'absolute' ? 'absolute' : 'relative',
    showTags: bool(stored.showTags, true),
    showOccurrences: bool(stored.showOccurrences, true),
    highlightCritical: bool(stored.highlightCritical, true),
    groupRepeats: bool(stored.groupRepeats, false),
    laneBy: (LANE_FIELDS as readonly unknown[]).includes(stored.laneBy) ? (stored.laneBy as LaneBy) : 'off',
    profile: {
      name: typeof profile.name === 'string' && profile.name.trim() !== '' ? profile.name.trim().slice(0, 120) : null,
      customers: Array.isArray(profile.customers)
        ? [...new Set(profile.customers.filter((c): c is string => typeof c === 'string'))]
        : [],
    },
    customerScope: sanitizeNames(stored.customerScope, MAX_SCOPE_CUSTOMERS),
    p1Sound: bool(stored.p1Sound, false),
    p1Desktop: bool(stored.p1Desktop, false),
    watchList: Array.isArray(stored.watchList)
      ? [...new Set(stored.watchList.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(id)))].slice(-MAX_WATCHED)
      : [],
  };
}

export const prefsStore = createPersistentStore<Preferences>('prefs:v1', DEFAULT_PREFS, sanitizePrefs);

export function patchPrefs(patch: Partial<Preferences>): void {
  prefsStore.set((prefs) => ({ ...prefs, ...patch }));
}

export function toggleWatch(id: string): void {
  prefsStore.set((prefs) => ({
    ...prefs,
    watchList: prefs.watchList.includes(id) ? prefs.watchList.filter((w) => w !== id) : [...prefs.watchList, id].slice(-MAX_WATCHED),
  }));
}

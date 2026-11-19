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
  profile: Profile;
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
  profile: { name: null, customers: [] },
});

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

export const prefsStore = createPersistentStore<Preferences>('prefs:v1', DEFAULT_PREFS, (stored, fallback) => {
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
    profile: {
      name: typeof profile.name === 'string' && profile.name.trim() !== '' ? profile.name.trim().slice(0, 120) : null,
      customers: Array.isArray(profile.customers)
        ? [...new Set(profile.customers.filter((c): c is string => typeof c === 'string'))]
        : [],
    },
  };
});

export function patchPrefs(patch: Partial<Preferences>): void {
  prefsStore.set((prefs) => ({ ...prefs, ...patch }));
}

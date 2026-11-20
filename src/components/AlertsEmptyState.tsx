import { SearchX, TriangleAlert } from 'lucide-react';
import { patchPrefs } from '../state/prefs';
import { clearAllFilters } from '../state/views';

interface AlertsEmptyStateProps {
  /** The first request is still running. */
  loading: boolean;
  /** Some alerts are loaded (before customer scope and filters). */
  hasAlerts: boolean;
  /** Error of the request to our own backend. */
  requestError: string | null;
  onRetry: () => void;
  /** The "My customers" quick filter is on, but the profile names no customers. */
  needsCustomers: boolean;
  /** Alerts in the section before the filters. */
  sectionTotal: number;
  /** A customer scope is set. */
  scoped: boolean;
}

function emptyTitle(needsCustomers: boolean, sectionTotal: number): string {
  if (needsCustomers) return 'No customers selected';
  return sectionTotal === 0 ? 'No alerts here' : 'No alerts match';
}

/** The way out of an empty list: choose customers, clear the filters, or drop the customer scope. */
function EmptyAction({ needsCustomers, sectionTotal, scoped }: Readonly<Pick<AlertsEmptyStateProps, 'needsCustomers' | 'sectionTotal' | 'scoped'>>) {
  if (needsCustomers) {
    return (
      <a href="#/settings" className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
        Choose your customers in Settings
      </a>
    );
  }
  if (sectionTotal > 0) {
    return (
      <button type="button" onClick={clearAllFilters} className="mt-2 text-xs font-medium text-accent hover:underline">
        Clear all filters
      </button>
    );
  }
  if (!scoped) return null;
  return (
    <button type="button" onClick={() => patchPrefs({ customerScope: [] })} className="mt-2 text-xs font-medium text-accent hover:underline">
      Show all customers
    </button>
  );
}

/** What the alert table shows instead of rows: loading, a failed first load, or why nothing matches. */
export function AlertsEmptyState({ loading, hasAlerts, requestError, onRetry, needsCustomers, sectionTotal, scoped }: Readonly<AlertsEmptyStateProps>) {
  if (loading) {
    return (
      <div className="grid w-full max-w-3xl gap-2" aria-busy="true" aria-label="Loading alerts">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton h-5" style={{ width: `${100 - ((i * 13) % 35)}%` }} />
        ))}
      </div>
    );
  }
  if (!hasAlerts && requestError) {
    return (
      <div className="max-w-md text-center">
        <TriangleAlert size={28} aria-hidden className="mx-auto text-crit" />
        <p className="mt-2 font-semibold">Alerts could not be loaded</p>
        <p className="mt-1 text-muted">{requestError}</p>
        <button type="button" onClick={onRetry} className="mt-3 h-7 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent">
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="max-w-md text-center">
      <SearchX size={28} aria-hidden className="mx-auto text-subtle" />
      <p className="mt-2 font-semibold">{emptyTitle(needsCustomers, sectionTotal)}</p>
      <EmptyAction needsCustomers={needsCustomers} sectionTotal={sectionTotal} scoped={scoped} />
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HISTORY_PAGE_SIZE, parseUtcDate } from '../../shared/history';
import { fetchHistory } from '../api/client';
import { cn } from '../lib/cn';
import { filterHistoryMonths, loadHistoryMonths, MAX_ANALYSIS_ALERTS_PER_MONTH } from '../lib/historyAnalysis';
import { HistoryTable } from './HistoryTable';

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
const button = 'rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium hover:bg-hover disabled:opacity-50';
const select = 'max-w-64 rounded-md border border-line-strong bg-panel px-2 py-1 text-sm';
const EMPTY: Awaited<ReturnType<typeof loadHistoryMonths>> = [];

export function HistoryAnalysis({ from, to }: { from: string; to: string }) {
  const [customer, setCustomer] = useState('');
  const [tag, setTag] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['history-months', from, to],
    queryFn: ({ signal }) => loadHistoryMonths(
      parseUtcDate(from)!,
      parseUtcDate(to)!,
      (window, offset) => fetchHistory(window, offset, signal),
    ),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const months = query.data ?? EMPTY;
  const { customers, tags } = useMemo(() => {
    const customers = new Set<string>();
    const tags = new Set<string>();
    for (const month of months) {
      for (const alert of month.alerts) {
        for (const name of alert.customers) customers.add(name);
        for (const name of alert.tags) tags.add(name);
      }
    }
    return {
      customers: [...customers].sort((a, b) => a.localeCompare(b)),
      tags: [...tags].sort((a, b) => a.localeCompare(b)),
    };
  }, [months]);
  const filtered = useMemo(() => filterHistoryMonths(months, customer, tag), [months, customer, tag]);
  const selected = filtered.find((month) => month.key === picked);
  const max = Math.max(1, ...filtered.map((month) => month.alerts.length));
  const partial = filtered.some((month) => month.partial);
  const total = filtered.reduce((sum, month) => sum + month.alerts.length, 0);

  if (!query.data && query.error) {
    return (
      <div role="alert" className="flex items-center gap-2 p-3 text-sm text-crit">
        {query.error.message}
        <button type="button" className={button} disabled={query.isFetching} onClick={() => void query.refetch()}>Retry</button>
      </div>
    );
  }
  if (!query.data) return <p role="status" className="p-3 text-sm text-muted">Loading monthly analysis…</p>;

  return (
    <section aria-labelledby="history-analysis-title" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex-none space-y-3 border-b border-line p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 id="history-analysis-title" className="text-sm font-semibold">Alerts created per month</h2>
            <p className="text-xs text-muted">{from} to {to} (UTC) · {partial ? 'At least ' : ''}{total.toLocaleString()} matching alerts</p>
          </div>
          <label className="grid gap-1 text-xs">
            Customer
            <select className={select} value={customer} onChange={(event) => { setCustomer(event.target.value); setPage(0); }}>
              <option value="">All customers</option>
              {customers.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            Tag
            <select className={select} value={tag} onChange={(event) => { setTag(event.target.value); setPage(0); }}>
              <option value="">All tags</option>
              {tags.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
        </div>
        {partial && (
          <p role="status" className="rounded bg-warn-soft p-2 text-xs text-warn">
            Counts marked + are incomplete. Analysis reads up to {MAX_ANALYSIS_ALERTS_PER_MONTH} alerts per month and may skip unreadable records.
            Use <strong>Load history</strong> with a narrower date range to browse more alerts.
          </p>
        )}
        {query.error && <p role="alert" className="text-xs text-crit">Could not refresh analysis. Showing previous results. {query.error.message}</p>}
        <div className="overflow-x-auto">
          <ul className="flex min-w-max gap-1" aria-label="Monthly alert histogram">
            {filtered.map((month) => {
              const label = monthFormat.format(parseUtcDate(month.from)!);
              const count = month.alerts.length;
              return (
                <li key={month.key} className="min-w-14 flex-1">
                  <button
                    type="button"
                    aria-label={`${label}, ${month.partial ? 'at least ' : ''}${count} alerts`}
                    aria-pressed={month.key === picked}
                    onClick={() => { setPicked(month.key); setPage(0); }}
                    className={cn('flex w-full flex-col items-center gap-1 rounded px-1 py-1 text-xs hover:bg-hover', month.key === picked && 'bg-accent-soft')}
                  >
                    <span className="flex h-24 w-full flex-col justify-end gap-1 border-b border-line-strong" aria-hidden>
                      <span className={cn('font-semibold tabular-nums', month.partial && 'text-warn')}>{count}{month.partial ? '+' : ''}</span>
                      <span className={cn('mx-auto w-2/3 max-w-16 rounded-t bg-accent', month.partial && 'bg-warn')} style={{ height: `${count / max * 74}%` }} />
                    </span>
                    <span className="whitespace-nowrap text-muted">{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {selected && selected.alerts.length > 0 ? (
        <>
          <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line p-3">
            <h3 className="mr-auto text-sm font-medium">{selected.from} to {selected.to} (UTC)</h3>
            <button type="button" className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous page</button>
            <button type="button" className={button} disabled={(page + 1) * HISTORY_PAGE_SIZE >= selected.alerts.length} onClick={() => setPage(page + 1)}>Next page</button>
          </div>
          <HistoryTable key={`${selected.key}/${page}`} alerts={selected.alerts.slice(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE)} />
        </>
      ) : (
        <p className="p-3 text-sm text-muted">{selected ? 'No matching alerts in the loaded data for this month.' : 'Select a month to inspect its matching alerts.'}</p>
      )}
    </section>
  );
}

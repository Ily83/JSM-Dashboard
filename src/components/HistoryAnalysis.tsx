import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Flame, Repeat, Users, type LucideIcon } from 'lucide-react';
import type { Alert } from '../../shared/types';
import { HISTORY_PAGE_SIZE, parseUtcDate } from '../../shared/history';
import { fetchHistory } from '../api/client';
import type { AlertGroup } from '../lib/alertGroups';
import { cn } from '../lib/cn';
import { filterHistoryMonths, loadHistoryMonths, MAX_ANALYSIS_ALERTS_PER_MONTH } from '../lib/historyAnalysis';
import {
  analysisAlerts,
  rankCustomers,
  rankHotspots,
  rankRecurring,
  type AnalysisSettings,
  type Breakdown,
  type HotspotDimension,
  type RankedEntry,
} from '../lib/historyBreakdowns';
import { HistoryTable } from './HistoryTable';

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const button = 'rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium hover:bg-hover disabled:opacity-50';
const select = 'max-w-64 rounded-md border border-line-strong bg-panel px-2 py-1 text-sm';
const EMPTY: Awaited<ReturnType<typeof loadHistoryMonths>> = [];
/** Rankings show the top entries; the drill-down still has every alert. */
const MAX_ROWS = 100;

const BREAKDOWN_INFO: Record<Breakdown, { label: string; title: string; icon: LucideIcon }> = {
  month: { label: 'Per month', title: 'Alerts created per month', icon: CalendarDays },
  recurring: { label: 'Recurring', title: 'Recurring alerts', icon: Repeat },
  hotspots: { label: 'P1 hotspots', title: 'P1 hotspots', icon: Flame },
  customers: { label: 'Per customer', title: 'Alerts per customer', icon: Users },
};

const DIMENSION_LABEL: Record<HotspotDimension, string> = { customer: 'Customer', service: 'Service', group: 'Alert group' };

interface Props {
  from: string;
  to: string;
  settings: AnalysisSettings;
  onSettingsChange: (patch: Partial<AnalysisSettings>) => void;
}

interface Selection {
  title: string;
  alerts: Alert[];
}

export function HistoryAnalysis({ from, to, settings, onSettingsChange }: Props) {
  const { customer, tag, breakdown, p1Only, dimension } = settings;
  // The selected bar or row belongs to one breakdown; the page to one selection.
  const selectionContext = `${breakdown}|${dimension}`;
  const [pick, setPick] = useState<{ context: string; key: string } | null>(null);
  const picked = pick?.context === selectionContext ? pick.key : null;
  const pageContext = `${selectionContext}|${picked}|${customer}|${tag}|${p1Only}`;
  const [pageState, setPageState] = useState<{ context: string; page: number }>({ context: '', page: 0 });
  const page = pageState.context === pageContext ? pageState.page : 0;
  const setPage = (next: number) => setPageState({ context: pageContext, page: next });
  const choose = (key: string) => setPick({ context: selectionContext, key });

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
    // A saved investigation may name a value that is not in this range.
    if (customer) customers.add(customer);
    if (tag) tags.add(tag);
    return {
      customers: [...customers].sort((a, b) => a.localeCompare(b)),
      tags: [...tags].sort((a, b) => a.localeCompare(b)),
    };
  }, [months, customer, tag]);

  const filtered = useMemo(() => filterHistoryMonths(months, customer, tag), [months, customer, tag]);
  const alerts = useMemo(() => analysisAlerts(months, customer, tag), [months, customer, tag]);
  const recurring = useMemo(() => (breakdown === 'recurring' ? rankRecurring(alerts, p1Only) : []), [alerts, breakdown, p1Only]);
  const perCustomer = useMemo(
    () => (breakdown === 'customers' ? rankCustomers(alerts, p1Only) : { entries: [], withoutCustomer: 0 }),
    [alerts, breakdown, p1Only],
  );
  const hotspots = useMemo(() => (breakdown === 'hotspots' ? rankHotspots(alerts, dimension) : []), [alerts, breakdown, dimension]);

  const partial = months.some((month) => month.partial);
  const usesP1Toggle = breakdown === 'recurring' || breakdown === 'customers';
  const scoped = breakdown === 'hotspots' || (usesP1Toggle && p1Only) ? alerts.filter((a) => a.priority === 'P1') : alerts;

  if (!query.data && query.error) {
    return (
      <div role="alert" className="flex items-center gap-2 p-3 text-sm text-crit">
        {query.error.message}
        <button type="button" className={button} disabled={query.isFetching} onClick={() => void query.refetch()}>Retry</button>
      </div>
    );
  }
  if (!query.data) return <p role="status" className="p-3 text-sm text-muted">Loading analysis…</p>;

  let ranking: ReactNode;
  let selection: Selection | null = null;
  let hint: string;

  if (breakdown === 'month') {
    const max = Math.max(1, ...filtered.map((month) => month.alerts.length));
    const month = filtered.find((m) => m.key === picked);
    if (month) selection = { title: `${month.from} to ${month.to} (UTC)`, alerts: month.alerts };
    hint = 'Select a month to inspect its alerts.';
    ranking = (
      <div className="overflow-x-auto">
        <ul className="flex min-w-max gap-1" aria-label="Monthly alert histogram">
          {filtered.map((m) => {
            const label = monthFormat.format(parseUtcDate(m.from)!);
            const count = m.alerts.length;
            return (
              <li key={m.key} className="min-w-14 flex-1">
                <button
                  type="button"
                  aria-label={`${label}, ${m.partial ? 'at least ' : ''}${count} alerts`}
                  aria-pressed={m.key === picked}
                  onClick={() => choose(m.key)}
                  className={cn('flex w-full flex-col items-center gap-1 rounded px-1 py-1 text-xs hover:bg-hover', m.key === picked && 'bg-accent-soft')}
                >
                  <span className="flex h-24 w-full flex-col justify-end gap-1 border-b border-line-strong" aria-hidden>
                    <span className={cn('font-semibold tabular-nums', m.partial && 'text-warn')}>{count}{m.partial ? '+' : ''}</span>
                    <span className={cn('mx-auto w-2/3 max-w-16 rounded-t bg-accent', m.partial && 'bg-warn')} style={{ height: `${count / max * 74}%` }} />
                  </span>
                  <span className="whitespace-nowrap text-muted">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  } else if (breakdown === 'recurring') {
    const group = recurring.find((g) => g.key === picked);
    if (group) selection = { title: group.label, alerts: group.alerts };
    hint = 'Select a group to inspect its alerts.';
    ranking = <RecurringTable groups={recurring} picked={picked} onPick={choose} />;
  } else if (breakdown === 'hotspots') {
    const entry = hotspots.find((e) => e.key === picked);
    if (entry) selection = { title: `${entry.label} · P1`, alerts: entry.alerts };
    hint = `Select a ${DIMENSION_LABEL[dimension].toLowerCase()} to inspect its P1 alerts.`;
    ranking = <BarList entries={hotspots} picked={picked} onPick={choose} variant="p1" label={`P1 alerts per ${DIMENSION_LABEL[dimension].toLowerCase()}`} />;
  } else {
    const entry = perCustomer.entries.find((e) => e.key === picked);
    if (entry) selection = { title: p1Only ? `${entry.label} · P1` : entry.label, alerts: entry.alerts };
    hint = 'Select a customer to inspect its alerts.';
    ranking = (
      <>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>Alerts with several customers count once per customer.</span>
          {perCustomer.withoutCustomer > 0 && <span className="tabular-nums">{perCustomer.withoutCustomer.toLocaleString()} without customer</span>}
          {!p1Only && (
            <span className="flex items-center gap-2" aria-hidden>
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-crit" />P1</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-accent" />Other</span>
            </span>
          )}
        </p>
        <BarList entries={perCustomer.entries} picked={picked} onPick={choose} variant={p1Only ? 'p1' : 'stacked'} label="Alerts per customer" />
      </>
    );
  }

  const info = BREAKDOWN_INFO[breakdown];
  const filterChips = [customer && `Customer: ${customer}`, tag && `Tag: ${tag}`, (breakdown === 'hotspots' || (usesP1Toggle && p1Only)) && 'P1 only'].filter(Boolean) as string[];

  return (
    <section aria-labelledby="history-analysis-title" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex-none space-y-3 border-b border-line p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 id="history-analysis-title" className="flex items-center gap-2 text-sm font-semibold">
              {info.title}
              {partial && (
                <span
                  className="rounded bg-warn-soft px-1.5 text-[11px] font-semibold text-warn"
                  data-tip={`Partial: the limit of ${MAX_ANALYSIS_ALERTS_PER_MONTH} alerts per month was reached or records could not be read`}
                  data-tip-always=""
                >
                  Partial
                </span>
              )}
            </h2>
            <p className="text-xs text-muted">{from} to {to} (UTC) · {partial ? 'At least ' : ''}{scoped.length.toLocaleString()} {filterChips.includes('P1 only') ? 'P1 alerts' : 'matching alerts'}</p>
          </div>
          <label className="grid gap-1 text-xs">
            Customer
            <select className={select} value={customer} onChange={(event) => onSettingsChange({ customer: event.target.value })}>
              <option value="">All customers</option>
              {customers.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            Tag
            <select className={select} value={tag} onChange={(event) => onSettingsChange({ tag: event.target.value })}>
              <option value="">All tags</option>
              {tags.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Breakdown" className="flex flex-wrap gap-1">
            {(Object.keys(BREAKDOWN_INFO) as Breakdown[]).map((id) => {
              const Icon = BREAKDOWN_INFO[id].icon;
              const active = id === breakdown;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSettingsChange({ breakdown: id })}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
                    active ? 'border-accent bg-accent-soft text-fg' : 'border-line-strong text-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  <Icon size={13} aria-hidden className={cn(active && 'text-accent')} />
                  {BREAKDOWN_INFO[id].label}
                </button>
              );
            })}
          </div>
          <span className="ml-auto" />
          {breakdown === 'hotspots' && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              By
              <select className={select} value={dimension} onChange={(event) => onSettingsChange({ dimension: event.target.value as HotspotDimension })}>
                {(Object.keys(DIMENSION_LABEL) as HotspotDimension[]).map((id) => <option key={id} value={id}>{DIMENSION_LABEL[id]}</option>)}
              </select>
            </label>
          )}
          {usesP1Toggle && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
              <input type="checkbox" className="size-3.5 accent-(--accent)" checked={p1Only} onChange={(event) => onSettingsChange({ p1Only: event.target.checked })} />
              P1 only
            </label>
          )}
        </div>

        {partial && breakdown === 'month' && (
          <p role="status" className="rounded bg-warn-soft p-2 text-xs text-warn">
            Counts marked + are incomplete. Analysis reads up to {MAX_ANALYSIS_ALERTS_PER_MONTH} alerts per month and may skip unreadable records.
            Use <strong>Load history</strong> with a narrower date range to browse more alerts.
          </p>
        )}
        {query.error && <p role="alert" className="text-xs text-crit">Could not refresh analysis. Showing previous results. {query.error.message}</p>}
        {ranking}
      </div>

      {selection && selection.alerts.length > 0 ? (
        <>
          <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line p-3">
            <h3 className="mr-auto flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
              <span className="truncate" data-tip={selection.title}>{selection.title}</span>
              <span className="text-xs tabular-nums text-muted">{selection.alerts.length.toLocaleString()}</span>
              {filterChips.map((chip) => (
                <span key={chip} className="rounded border border-line px-1.5 text-[11px] font-normal text-muted">{chip}</span>
              ))}
            </h3>
            <button type="button" className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous page</button>
            <button type="button" className={button} disabled={(page + 1) * HISTORY_PAGE_SIZE >= selection.alerts.length} onClick={() => setPage(page + 1)}>Next page</button>
          </div>
          <HistoryTable key={`${pageContext}/${page}`} alerts={selection.alerts.slice(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE)} />
        </>
      ) : (
        scoped.length > 0 && <p className="p-3 text-sm text-muted">{picked ? 'No matching alerts in the loaded data.' : hint}</p>
      )}
    </section>
  );
}

function RankingEmpty() {
  return <p className="text-sm text-muted">No matching alerts.</p>;
}

function MoreRows({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return <p className="px-2 pt-1 text-xs tabular-nums text-subtle">Top {shown} of {total.toLocaleString()}</p>;
}

function RecurringTable({ groups, picked, onPick }: { groups: AlertGroup[]; picked: string | null; onPick: (key: string) => void }) {
  if (groups.length === 0) return <RankingEmpty />;
  const rows = groups.slice(0, MAX_ROWS);
  return (
    <div>
      <div className="max-h-80 overflow-auto rounded border border-line">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-panel text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-1.5">Alert group</th>
              <th scope="col" className="px-3 py-1.5 text-right" data-tip="Distinct alert records in Jira" data-tip-always="">Records</th>
              <th scope="col" className="px-3 py-1.5 text-right" data-tip="Jira de-duplication count summed over the records" data-tip-always="">Occurrences</th>
              <th scope="col" className="px-3 py-1.5 text-right">P1</th>
              <th scope="col" className="px-3 py-1.5">Customers</th>
              <th scope="col" className="whitespace-nowrap px-3 py-1.5">First (UTC)</th>
              <th scope="col" className="whitespace-nowrap px-3 py-1.5">Last (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((group) => {
              const active = group.key === picked;
              return (
                <tr key={group.key} onClick={() => onPick(group.key)} className={cn('cursor-pointer border-t border-line hover:bg-hover', active && 'bg-accent-soft')}>
                  <td className="max-w-0 w-full min-w-64 px-3 py-1.5">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={(event) => {
                        event.stopPropagation();
                        onPick(group.key);
                      }}
                      className="block w-full truncate text-left hover:underline"
                      data-tip={`${group.label}\n${group.basis === 'alias' ? 'Grouped by alias' : 'Grouped by source and summary'} · ${group.source}`}
                      data-tip-always=""
                    >
                      {group.label}
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{group.records}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{group.occurrences.toLocaleString()}</td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', group.p1 > 0 ? 'font-semibold text-crit' : 'text-subtle')}>{group.p1}</td>
                  <td className="max-w-48 truncate px-3 py-1.5 text-xs text-muted" data-tip={group.customers.join(', ') || undefined}>{group.customers.join(', ') || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted">{dayFormat.format(group.firstCreatedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted">{dayFormat.format(group.lastCreatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <MoreRows shown={rows.length} total={groups.length} />
    </div>
  );
}

/**
 * Ranked horizontal bars. `stacked` shows the P1 part of each bar in red;
 * `p1` ranks P1 alerts only and shows the share of all alerts beside it.
 */
function BarList({ entries, picked, onPick, variant, label }: {
  entries: RankedEntry[];
  picked: string | null;
  onPick: (key: string) => void;
  variant: 'stacked' | 'p1';
  label: string;
}) {
  if (entries.length === 0) return <RankingEmpty />;
  const rows = entries.slice(0, MAX_ROWS);
  const max = Math.max(1, ...rows.map((e) => e.count));
  return (
    <div>
      <ul aria-label={label} className="max-h-80 space-y-0.5 overflow-auto">
        {rows.map((entry) => {
          const active = entry.key === picked;
          const width = `${(entry.count / max) * 100}%`;
          const description = variant === 'p1'
            ? `${entry.label}, ${entry.count} P1 of ${entry.total} alerts`
            : `${entry.label}, ${entry.count} alerts, ${entry.p1} P1`;
          return (
            <li key={entry.key}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={description}
                onClick={() => onPick(entry.key)}
                className={cn(
                  'grid w-full grid-cols-[minmax(6rem,14rem)_minmax(0,1fr)_4.5rem] items-center gap-3 rounded px-2 py-1 text-left text-xs hover:bg-hover',
                  active && 'bg-accent-soft',
                )}
              >
                <span className="truncate" data-tip={entry.label}>{entry.label}</span>
                <span className="h-3" aria-hidden>
                  <span className={cn('relative block h-full overflow-hidden rounded-sm', variant === 'p1' ? 'bg-crit' : 'bg-accent')} style={{ width }}>
                    {variant === 'stacked' && entry.p1 > 0 && (
                      <span className="absolute inset-y-0 left-0 bg-crit" style={{ width: `${(entry.p1 / entry.count) * 100}%` }} />
                    )}
                  </span>
                </span>
                <span className="text-right tabular-nums" aria-hidden data-tip={variant === 'p1' ? 'P1 / all alerts' : undefined} data-tip-always="">
                  <span className="font-semibold">{entry.count.toLocaleString()}</span>
                  {variant === 'p1' && <span className="text-subtle"> / {entry.total.toLocaleString()}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <MoreRows shown={rows.length} total={entries.length} />
    </div>
  );
}

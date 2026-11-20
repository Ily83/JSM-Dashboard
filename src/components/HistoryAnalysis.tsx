import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Flame, Repeat, Timer, Users, type LucideIcon } from 'lucide-react';
import type { Alert } from '../../shared/types';
import { DAY_MS, HISTORY_PAGE_SIZE, parseUtcDate } from '../../shared/history';
import { fetchHistory } from '../api/client';
import type { AlertGroup } from '../lib/alertGroups';
import { cn } from '../lib/cn';
import { filterHistoryMonths, loadHistoryMonths, MAX_ANALYSIS_ALERTS_PER_MONTH, type HistoryMonth } from '../lib/historyAnalysis';
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
import { formatDuration, responseBreakdown, responseStats, type DurationStats, type ResponseDimension, type ResponseRow, type ResponseStats } from '../lib/responseTimes';
import { ActivityStrip } from './ActivityStrip';
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
  response: { label: 'Response', title: 'Time to acknowledge and close', icon: Timer },
};

const RESPONSE_LABEL: Record<ResponseDimension, string> = { priority: 'Priority', customer: 'Customer', group: 'Alert group' };

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

/** The rankings of the loaded alerts. Only the one of the shown breakdown is computed. */
interface Rankings {
  recurring: AlertGroup[];
  perCustomer: { entries: RankedEntry[]; withoutCustomer: number };
  hotspots: RankedEntry[];
  response: { overall: ResponseStats; rows: ResponseRow[] } | null;
}

/** What a breakdown shows: its ranking, the alerts behind the picked entry, and the hint while none is picked. */
interface BreakdownView {
  ranking: ReactNode;
  selection: Selection | null;
  hint: string;
}

interface BreakdownInput {
  /** The months after the customer and tag filters. */
  months: HistoryMonth[];
  rankings: Rankings;
  settings: AnalysisSettings;
  picked: string | null;
  choose: (key: string) => void;
  activityEnd: number;
}

/** Customers and tags found in the loaded months, for the filter menus. */
function filterOptions(months: readonly HistoryMonth[], customer: string, tag: string): { customers: string[]; tags: string[] } {
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
}

function filterChipsFor(customer: string, tag: string, p1: boolean): string[] {
  const chips: string[] = [];
  if (customer) chips.push(`Customer: ${customer}`);
  if (tag) chips.push(`Tag: ${tag}`);
  if (p1) chips.push('P1 only');
  return chips;
}

/** The picked bar or row, and the page of its alerts. */
function useDrilldown({ breakdown, responseBy, dimension, customer, tag, p1Only }: AnalysisSettings) {
  // The selected bar or row belongs to one breakdown; the page to one selection.
  const selectionContext = `${breakdown}|${breakdown === 'response' ? responseBy : dimension}`;
  const [pick, setPick] = useState<{ context: string; key: string } | null>(null);
  const picked = pick?.context === selectionContext ? pick.key : null;
  const pageContext = `${selectionContext}|${picked}|${customer}|${tag}|${p1Only}`;
  const [pageState, setPageState] = useState<{ context: string; page: number }>({ context: '', page: 0 });
  const page = pageState.context === pageContext ? pageState.page : 0;
  return {
    picked,
    choose: (key: string) => setPick({ context: selectionContext, key }),
    pageContext,
    page,
    setPage: (next: number) => setPageState({ context: pageContext, page: next }),
  };
}

function useRankings(alerts: readonly Alert[], { breakdown, p1Only, dimension, responseBy }: AnalysisSettings): Rankings {
  const recurring = useMemo(() => (breakdown === 'recurring' ? rankRecurring(alerts, p1Only) : []), [alerts, breakdown, p1Only]);
  const perCustomer = useMemo(
    () => (breakdown === 'customers' ? rankCustomers(alerts, p1Only) : { entries: [], withoutCustomer: 0 }),
    [alerts, breakdown, p1Only],
  );
  const hotspots = useMemo(() => (breakdown === 'hotspots' ? rankHotspots(alerts, dimension) : []), [alerts, breakdown, dimension]);
  const response = useMemo(
    () => (breakdown === 'response' ? { overall: responseStats(alerts), rows: responseBreakdown(alerts, responseBy) } : null),
    [alerts, breakdown, responseBy],
  );
  return { recurring, perCustomer, hotspots, response };
}

function monthView({ months, picked, choose }: BreakdownInput): BreakdownView {
  const month = months.find((m) => m.key === picked);
  return {
    ranking: <MonthHistogram months={months} picked={picked} onPick={choose} />,
    selection: month ? { title: `${month.from} to ${month.to} (UTC)`, alerts: month.alerts } : null,
    hint: 'Select a month to inspect its alerts.',
  };
}

function recurringView({ rankings, picked, choose, activityEnd }: BreakdownInput): BreakdownView {
  const group = rankings.recurring.find((g) => g.key === picked);
  return {
    ranking: <RecurringTable groups={rankings.recurring} picked={picked} onPick={choose} activityEnd={activityEnd} />,
    selection: group ? { title: group.label, alerts: group.alerts } : null,
    hint: 'Select a group to inspect its alerts.',
  };
}

function hotspotsView({ rankings, settings, picked, choose }: BreakdownInput): BreakdownView {
  const entry = rankings.hotspots.find((e) => e.key === picked);
  const dimension = DIMENSION_LABEL[settings.dimension].toLowerCase();
  return {
    ranking: <BarList entries={rankings.hotspots} picked={picked} onPick={choose} variant="p1" label={`P1 alerts per ${dimension}`} />,
    selection: entry ? { title: `${entry.label} · P1`, alerts: entry.alerts } : null,
    hint: `Select a ${dimension} to inspect its P1 alerts.`,
  };
}

function responseView({ rankings, settings, picked, choose }: BreakdownInput): BreakdownView {
  const { overall, rows } = rankings.response!;
  const row = rows.find((r) => r.key === picked);
  return {
    ranking: <ResponseTable overall={overall} rows={rows} picked={picked} onPick={choose} by={settings.responseBy} />,
    selection: row ? { title: `${RESPONSE_LABEL[settings.responseBy]}: ${row.label}`, alerts: row.alerts } : null,
    hint: 'Select a row to inspect its alerts.',
  };
}

function customersView({ rankings, settings, picked, choose }: BreakdownInput): BreakdownView {
  const { p1Only } = settings;
  const entry = rankings.perCustomer.entries.find((e) => e.key === picked);
  let selection: Selection | null = null;
  if (entry) selection = { title: p1Only ? `${entry.label} · P1` : entry.label, alerts: entry.alerts };
  return {
    ranking: <CustomerRanking ranking={rankings.perCustomer} p1Only={p1Only} picked={picked} onPick={choose} />,
    selection,
    hint: 'Select a customer to inspect its alerts.',
  };
}

const BREAKDOWN_VIEW: Record<Breakdown, (input: BreakdownInput) => BreakdownView> = {
  month: monthView,
  recurring: recurringView,
  hotspots: hotspotsView,
  response: responseView,
  customers: customersView,
};

export function HistoryAnalysis({ from, to, settings, onSettingsChange }: Readonly<Props>) {
  const { customer, tag, breakdown, p1Only } = settings;
  const { picked, choose, pageContext, page, setPage } = useDrilldown(settings);

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
  const options = useMemo(() => filterOptions(months, customer, tag), [months, customer, tag]);

  const filtered = useMemo(() => filterHistoryMonths(months, customer, tag), [months, customer, tag]);
  const alerts = useMemo(() => analysisAlerts(months, customer, tag), [months, customer, tag]);
  const rankings = useRankings(alerts, settings);
  // Activity strips in Recurring end with the selected range (or now, if earlier).
  const activityEnd = Math.min(Date.now(), (parseUtcDate(to) ?? Date.now()) + DAY_MS);

  const partial = months.some((month) => month.partial);
  const usesP1Toggle = breakdown === 'recurring' || breakdown === 'customers';
  const p1Filter = breakdown === 'hotspots' || (usesP1Toggle && p1Only);
  const scoped = p1Filter ? alerts.filter((a) => a.priority === 'P1') : alerts;

  if (!query.data && query.error) {
    return (
      <div role="alert" className="flex items-center gap-2 p-3 text-sm text-crit">
        {query.error.message}
        <button type="button" className={button} disabled={query.isFetching} onClick={() => void query.refetch()}>Retry</button>
      </div>
    );
  }
  if (!query.data) return <output className="block p-3 text-sm text-muted">Loading analysis…</output>;

  const { ranking, selection, hint } = BREAKDOWN_VIEW[breakdown]({ months: filtered, rankings, settings, picked, choose, activityEnd });
  const filterChips = filterChipsFor(customer, tag, p1Filter);

  return (
    <section aria-labelledby="history-analysis-title" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex-none space-y-3 border-b border-line p-3">
        <AnalysisHeader
          title={BREAKDOWN_INFO[breakdown].title}
          from={from}
          to={to}
          partial={partial}
          count={scoped.length}
          p1={p1Filter}
          options={options}
          settings={settings}
          onSettingsChange={onSettingsChange}
        />
        <BreakdownControls settings={settings} usesP1Toggle={usesP1Toggle} onSettingsChange={onSettingsChange} />

        {partial && breakdown === 'month' && (
          <output className="block rounded bg-warn-soft p-2 text-xs text-warn">
            Counts marked + are incomplete. Analysis reads up to {MAX_ANALYSIS_ALERTS_PER_MONTH} alerts per month and may skip unreadable records.
            Use <strong>Load history</strong> with a narrower date range to browse more alerts.
          </output>
        )}
        {query.error && <p role="alert" className="text-xs text-crit">Could not refresh analysis. Showing previous results. {query.error.message}</p>}
        {ranking}
      </div>

      <Drilldown
        selection={selection}
        chips={filterChips}
        page={page}
        onPageChange={setPage}
        pageContext={pageContext}
        showHint={scoped.length > 0}
        picked={picked}
        hint={hint}
      />
    </section>
  );
}

/** Title, number of alerts in scope, and the customer and tag filters. */
function AnalysisHeader({ title, from, to, partial, count, p1, options, settings, onSettingsChange }: Readonly<{
  title: string;
  from: string;
  to: string;
  partial: boolean;
  count: number;
  p1: boolean;
  options: { customers: string[]; tags: string[] };
  settings: AnalysisSettings;
  onSettingsChange: (patch: Partial<AnalysisSettings>) => void;
}>) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="mr-auto">
        <h2 id="history-analysis-title" className="flex items-center gap-2 text-sm font-semibold">
          {title}
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
        <p className="text-xs text-muted">{from} to {to} (UTC) · {partial ? 'At least ' : ''}{count.toLocaleString()} {p1 ? 'P1 alerts' : 'matching alerts'}</p>
      </div>
      <label className="grid gap-1 text-xs">
        {'Customer'}
        <select className={select} value={settings.customer} onChange={(event) => onSettingsChange({ customer: event.target.value })}>
          <option value="">All customers</option>
          {options.customers.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        {'Tag'}
        <select className={select} value={settings.tag} onChange={(event) => onSettingsChange({ tag: event.target.value })}>
          <option value="">All tags</option>
          {options.tags.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
    </div>
  );
}

/** The breakdown buttons, and the options of the shown breakdown. */
function BreakdownControls({ settings, usesP1Toggle, onSettingsChange }: Readonly<{
  settings: AnalysisSettings;
  usesP1Toggle: boolean;
  onSettingsChange: (patch: Partial<AnalysisSettings>) => void;
}>) {
  const { breakdown, dimension, responseBy, p1Only } = settings;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <fieldset aria-label="Breakdown">
        <div className="flex flex-wrap gap-1">
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
      </fieldset>
      <span className="ml-auto" />
      {breakdown === 'hotspots' && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {'By'}
          <select className={select} value={dimension} onChange={(event) => onSettingsChange({ dimension: event.target.value as HotspotDimension })}>
            {(Object.keys(DIMENSION_LABEL) as HotspotDimension[]).map((id) => <option key={id} value={id}>{DIMENSION_LABEL[id]}</option>)}
          </select>
        </label>
      )}
      {breakdown === 'response' && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {'By'}
          <select className={select} value={responseBy} onChange={(event) => onSettingsChange({ responseBy: event.target.value as ResponseDimension })}>
            {(Object.keys(RESPONSE_LABEL) as ResponseDimension[]).map((id) => <option key={id} value={id}>{RESPONSE_LABEL[id]}</option>)}
          </select>
        </label>
      )}
      {usesP1Toggle && (
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
          <input type="checkbox" className="size-3.5 accent-(--accent)" checked={p1Only} onChange={(event) => onSettingsChange({ p1Only: event.target.checked })} />
          {'P1 only'}
        </label>
      )}
    </div>
  );
}

/** The alerts behind the picked bar or row, a page at a time; else the hint to pick one. */
function Drilldown({ selection, chips, page, onPageChange, pageContext, showHint, picked, hint }: Readonly<{
  selection: Selection | null;
  chips: string[];
  page: number;
  onPageChange: (page: number) => void;
  /** Identifies the selection, so the table starts at the top for each one. */
  pageContext: string;
  /** False when no alert is in scope. */
  showHint: boolean;
  picked: string | null;
  hint: string;
}>) {
  if (selection && selection.alerts.length > 0) {
    return (
      <>
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line p-3">
          <h3 className="mr-auto flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
            <span className="truncate" data-tip={selection.title}>{selection.title}</span>
            <span className="text-xs tabular-nums text-muted">{selection.alerts.length.toLocaleString()}</span>
            {chips.map((chip) => (
              <span key={chip} className="rounded border border-line px-1.5 text-[11px] font-normal text-muted">{chip}</span>
            ))}
          </h3>
          <button type="button" className={button} disabled={page === 0} onClick={() => onPageChange(page - 1)}>Previous page</button>
          <button type="button" className={button} disabled={(page + 1) * HISTORY_PAGE_SIZE >= selection.alerts.length} onClick={() => onPageChange(page + 1)}>Next page</button>
        </div>
        <HistoryTable key={`${pageContext}/${page}`} alerts={selection.alerts.slice(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE)} />
      </>
    );
  }
  if (!showHint) return null;
  return <p className="p-3 text-sm text-muted">{picked ? 'No matching alerts in the loaded data.' : hint}</p>;
}

/** Alerts created per month as a bar chart; months that hit the read limit are marked. */
function MonthHistogram({ months, picked, onPick }: Readonly<{ months: HistoryMonth[]; picked: string | null; onPick: (key: string) => void }>) {
  const max = Math.max(1, ...months.map((month) => month.alerts.length));
  return (
    <div className="overflow-x-auto">
      <ul className="flex min-w-max gap-1" aria-label="Monthly alert histogram">
        {months.map((m) => {
          const label = monthFormat.format(parseUtcDate(m.from)!);
          const count = m.alerts.length;
          return (
            <li key={m.key} className="min-w-14 flex-1">
              <button
                type="button"
                aria-label={`${label}, ${m.partial ? 'at least ' : ''}${count} alerts`}
                aria-pressed={m.key === picked}
                onClick={() => onPick(m.key)}
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
}

/** Alerts per customer, with a legend for the P1 part of each bar. */
function CustomerRanking({ ranking, p1Only, picked, onPick }: Readonly<{
  ranking: Rankings['perCustomer'];
  p1Only: boolean;
  picked: string | null;
  onPick: (key: string) => void;
}>) {
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>Alerts with several customers count once per customer.</span>
        {ranking.withoutCustomer > 0 && <span className="tabular-nums">{ranking.withoutCustomer.toLocaleString()} without customer</span>}
        {!p1Only && (
          <span className="flex items-center gap-2" aria-hidden>
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-crit" />P1</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-accent" />Other</span>
          </span>
        )}
      </p>
      <BarList entries={ranking.entries} picked={picked} onPick={onPick} variant={p1Only ? 'p1' : 'stacked'} label="Alerts per customer" />
    </>
  );
}

function RankingEmpty() {
  return <p className="text-sm text-muted">No matching alerts.</p>;
}

function MoreRows({ shown, total }: Readonly<{ shown: number; total: number }>) {
  if (total <= shown) return null;
  return <p className="px-2 pt-1 text-xs tabular-nums text-subtle">Top {shown} of {total.toLocaleString()}</p>;
}

function RecurringTable({ groups, picked, onPick, activityEnd }: Readonly<{ groups: AlertGroup[]; picked: string | null; onPick: (key: string) => void; activityEnd: number }>) {
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
              <th scope="col" className="whitespace-nowrap px-3 py-1.5" data-tip="Alerts created per hour in the last 24 hours of the range" data-tip-always="">24 h</th>
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
                  <td className="px-3 py-1.5"><ActivityStrip alerts={group.alerts} end={activityEnd} /></td>
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
function BarList({ entries, picked, onPick, variant, label }: Readonly<{
  entries: RankedEntry[];
  picked: string | null;
  onPick: (key: string) => void;
  variant: 'stacked' | 'p1';
  label: string;
}>) {
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

function DurationCell({ stats, kind, strong }: Readonly<{ stats: DurationStats; kind: 'ack' | 'close'; strong?: boolean }>) {
  const verb = kind === 'ack' ? 'acknowledged' : 'closed';
  const missing = stats.missing ? ` · ${stats.missing.toLocaleString()} not ${verb}, left out` : '';
  const tip = `Based on ${stats.count.toLocaleString()} alerts${missing}`;
  return (
    <>
      <td className={cn('whitespace-nowrap px-3 py-1.5 text-right tabular-nums', strong && 'font-semibold', stats.median === null && 'text-subtle')} data-tip={tip} data-tip-always="">
        {formatDuration(stats.median)}
      </td>
      <td className={cn('whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted', stats.p90 === null && 'text-subtle')} data-tip={tip} data-tip-always="">
        {formatDuration(stats.p90)}
      </td>
    </>
  );
}

/** Median and 90th percentile time to acknowledge and to close, overall and per row. */
function ResponseTable({ overall, rows, picked, onPick, by }: Readonly<{
  overall: ResponseStats;
  rows: ResponseRow[];
  picked: string | null;
  onPick: (key: string) => void;
  by: ResponseDimension;
}>) {
  if (overall.alerts === 0) return <RankingEmpty />;
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div>
      <div className="max-h-80 overflow-auto rounded border border-line">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-panel text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-1.5">{RESPONSE_LABEL[by]}</th>
              <th scope="col" className="px-3 py-1.5 text-right">Alerts</th>
              <th scope="col" className="whitespace-nowrap px-3 py-1.5 text-right" data-tip="Median time from creation to acknowledgement" data-tip-always="">MTTA</th>
              <th scope="col" className="px-3 py-1.5 text-right" data-tip="90% of acknowledgements were faster" data-tip-always="">p90</th>
              <th scope="col" className="whitespace-nowrap px-3 py-1.5 text-right" data-tip="Median time from creation to close" data-tip-always="">MTTR</th>
              <th scope="col" className="px-3 py-1.5 text-right" data-tip="90% of closes were faster" data-tip-always="">p90</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line bg-raised">
              <th scope="row" className="px-3 py-1.5 font-semibold">All</th>
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{overall.alerts.toLocaleString()}</td>
              <DurationCell stats={overall.ack} kind="ack" strong />
              <DurationCell stats={overall.close} kind="close" strong />
            </tr>
            {shown.map((row) => {
              const active = row.key === picked;
              return (
                <tr key={row.key} onClick={() => onPick(row.key)} className={cn('cursor-pointer border-t border-line hover:bg-hover', active && 'bg-accent-soft')}>
                  <th scope="row" className="max-w-0 w-full min-w-48 px-3 py-1.5 text-left font-normal">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={(event) => {
                        event.stopPropagation();
                        onPick(row.key);
                      }}
                      className="block w-full truncate text-left hover:underline"
                      data-tip={row.label}
                    >
                      {row.label}
                    </button>
                  </th>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.alerts.length.toLocaleString()}</td>
                  <DurationCell stats={row.stats.ack} kind="ack" />
                  <DurationCell stats={row.stats.close} kind="close" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <MoreRows shown={shown.length} total={rows.length} />
    </div>
  );
}

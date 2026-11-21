import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CalendarDays, Flame, Info, LoaderCircle, Repeat, Timer, Users, type LucideIcon } from 'lucide-react';
import type { Alert } from '../../shared/types';
import { DAY_MS, HISTORY_PAGE_SIZE, parseUtcDate } from '../../shared/history';
import type { HistoryAnalysisStatus } from '../../shared/historyAnalysis';
import { cancelHistoryAnalysis, fetchHistoryAnalysis, fetchHistoryAnalysisResults, startHistoryAnalysis } from '../api/client';
import type { AlertGroup } from '../lib/alertGroups';
import { cn } from '../lib/cn';
import { formatUtcDay, formatUtcMonth, formatUtcRange, type HistoryMonth } from '../lib/historyAnalysis';
import { dailyHistory, filterAnalysis, historyTags, rankHistory } from '../lib/historyMetrics';
import { HistoryDaily, HistoryFilters, HistoryOverview, overviewBuckets, statusTitle } from './HistoryMetrics';
import {
  RANK_BY,
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

const button = 'rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium hover:bg-hover disabled:opacity-50';
const linkButton = 'font-medium text-accent hover:underline';
const select = 'max-w-64 rounded-md border border-line-strong bg-panel px-2 py-1 text-sm';
const EMPTY: HistoryMonth[] = [];
/** Rankings show the top entries; the drill-down still has every alert. */
const MAX_ROWS = 100;
const STATUS_KEY = ['history-analysis-status'];
const POLL_MS = 2000;

const SCOPE_NOTE = 'Retained alerts with their current data, as read during the scan: not a snapshot of the past.\nCustomers or services stored only in alert details may be missing.';
const CUSTOMER_NOTE = 'An alert with several customers counts once for each of them.';
const PARTIAL_NOTE = "Counts marked + are incomplete: Jira's pagination limit, unreadable records, or duplicate or out-of-range records prevented a complete scan.";
const RECORDS_NOTE = "Records read from Jira, including ranges read again after a split at Jira's pagination limit.";

const BREAKDOWN_INFO: Record<Breakdown, { label: string; title: string; icon: LucideIcon }> = {
  month: { label: 'Per month', title: 'Alerts created per month', icon: CalendarDays },
  overview: { label: 'Overview', title: 'Historical overview', icon: BarChart3 },
  daily: { label: 'Daily trends', title: 'Daily trends', icon: CalendarDays },
  rankings: { label: 'Rankings', title: 'Historical rankings', icon: BarChart3 },
  recurring: { label: 'Recurring', title: 'Recurring alerts', icon: Repeat },
  hotspots: { label: 'P1 hotspots', title: 'P1 hotspots', icon: Flame },
  customers: { label: 'Per customer', title: 'Alerts per customer', icon: Users },
  response: { label: 'Response', title: 'Time to acknowledge and close', icon: Timer },
};

const RESPONSE_LABEL: Record<ResponseDimension, string> = { priority: 'Priority', customer: 'Customer', group: 'Alert group' };

const DIMENSION_LABEL: Record<HotspotDimension, string> = { customer: 'Customer', service: 'Service', group: 'Alert group' };

interface DateRange {
  from: string;
  to: string;
}

interface Props {
  from: string;
  to: string;
  settings: AnalysisSettings;
  onSettingsChange: (patch: Partial<AnalysisSettings>) => void;
  /** Shows the analysis of another range: the one now current on the server. */
  onOpenRange: (range: DateRange) => void;
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
  from: string;
  to: string;
  alerts: Alert[];
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
      for (const name of historyTags(alert)) tags.add(name);
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

function filterChipsFor(s: AnalysisSettings, p1: boolean): string[] {
  const chips = [
    ['Customer', s.customer], ['Tag', s.tag], ['Exclude tag', s.excludeTag], ['Source', s.source], ['Exclude source', s.excludeSource],
    ['Integration', s.integration], ['Current status', s.status && statusTitle[s.status]], ['Priority', s.priority],
    ['Message includes', s.message], ['Message excludes', s.excludeMessage], ['Detail key', s.propertyKey], ['Detail value includes', s.propertyValue],
  ].flatMap(([name, value]) => value?.trim() ? [`${name}: ${value}`] : []);
  if (p1) chips.push('P1 only');
  return chips;
}

/** The picked bar or row, and the page of its alerts. */
function useDrilldown(settings: AnalysisSettings) {
  const { breakdown, responseBy, dimension, dayBy, rankBy } = settings;
  // The selected bar or row belongs to one breakdown; the page to one selection.
  const selectionContext = `${breakdown}|${responseBy}|${dimension}|${dayBy}|${rankBy}`;
  const [pick, setPick] = useState<{ context: string; key: string } | null>(null);
  const picked = pick?.context === selectionContext ? pick.key : null;
  const pageContext = JSON.stringify([picked, settings]);
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

/**
 * The analysis job of one range. The server keeps a single job: starting the
 * range joins its running or finished job, or starts a new one. Its status is
 * polled only while it runs, then its results are loaded once and kept, even
 * after another tab starts a different analysis or the server restarts.
 */
function useAnalysisJob(from: string, to: string) {
  const queryClient = useQueryClient();
  const start = useQuery({
    queryKey: ['history-analysis-start', from, to],
    queryFn: async ({ signal }) => {
      const status = await startHistoryAnalysis(from, to, signal);
      // The answer is the current status: no status of an earlier job shows in between.
      queryClient.setQueryData(STATUS_KEY, status);
      return status;
    },
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const ownId = start.data?.id;
  const resultsKey = ['history-analysis-results', ownId];
  const progress = useQuery({
    queryKey: STATUS_KEY,
    queryFn: ({ signal }) => fetchHistoryAnalysis(signal),
    enabled: !start.isFetching,
    // Only a running job is polled: this tab's own, or the one it waits for while it has nothing to show.
    refetchInterval: ({ state }) => {
      const current = state.data;
      if (current?.state !== 'running') return false;
      return current.id === ownId || queryClient.getQueryData(resultsKey) === undefined ? POLL_MS : false;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const job = progress.data ?? null;
  const sameJob = !!job && job.id === ownId;
  const results = useQuery({
    queryKey: resultsKey,
    queryFn: async ({ signal }) => {
      try {
        return await fetchHistoryAnalysisResults(ownId!, signal);
      } catch (error) {
        // Usually replaced by another analysis or lost in a restart: read the status to tell which.
        if (!signal.aborted) void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
        throw error;
      }
    },
    enabled: sameJob && job.state === 'completed',
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return { start, progress, job, sameJob, results };
}

function monthView({ months, picked, choose }: BreakdownInput): BreakdownView {
  const month = months.find((m) => m.key === picked);
  return {
    ranking: <MonthHistogram months={months} picked={picked} onPick={choose} />,
    selection: month ? { title: `${formatUtcRange(month.from, month.to)} (UTC)`, alerts: month.alerts } : null,
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
  overview: ({ alerts, picked, choose }) => ({
    ranking: <HistoryOverview alerts={alerts} picked={picked} choose={choose} />,
    selection: overviewBuckets(alerts).flatMap(g => g.buckets).find(b => b.key === picked) ?? null,
    hint: 'Select a status or priority to inspect its alerts.',
  }),
  daily: ({ alerts, from, to, settings, picked, choose }) => {
    const by = settings.dayBy ?? 'priority';
    const [date, key] = picked?.split('|') ?? [];
    const day = date && dailyHistory(alerts, date, date).days[0];
    const values = day ? key === 'created' ? day.created : key === 'closed-at' ? day.closed : day.created.filter(a => a[by] === key) : [];
    return {
      ranking: <HistoryDaily alerts={alerts} from={from} to={to} by={by} picked={picked} choose={choose} />,
      selection: day ? { title: `${formatUtcDay(parseUtcDate(date)!)} (UTC) · ${key === 'closed-at' ? 'Closed that day' : statusTitle[key as keyof typeof statusTitle] ?? key}`, alerts: values } : null,
      hint: 'Select a day count to inspect its alerts.',
    };
  },
  rankings: ({ alerts, settings, picked, choose }) => {
    const by = settings.rankBy ?? 'source';
    const entries = rankHistory(alerts, by);
    const entry = entries.find(e => e.key === picked);
    return {
      ranking: <><p className="mb-2 text-xs text-muted">One count per alert per {by}. Alerts with several teams or tags can appear in more than one bar.</p>
        <BarList entries={entries} picked={picked} onPick={choose} variant="stacked" label={`Alerts per ${by}`} /></>,
      selection: entry ? { title: entry.label, alerts: entry.alerts } : null,
      hint: `Select a ${by} to inspect its alerts.`,
    };
  },
  recurring: recurringView,
  hotspots: hotspotsView,
  response: responseView,
  customers: customersView,
};

export function HistoryAnalysis({ from, to, settings, onSettingsChange, onOpenRange }: Readonly<Props>) {
  const { customer, tag, breakdown, p1Only } = settings;
  const { picked, choose, pageContext, page, setPage } = useDrilldown(settings);

  const [cancelError, setCancelError] = useState('');
  const { start, progress, job, sameJob, results } = useAnalysisJob(from, to);
  const months = results.data ?? EMPTY;
  const options = useMemo(() => filterOptions(months, customer, tag), [months, customer, tag]);

  const filtered = useMemo(() => filterAnalysis(months, settings), [months, settings]);
  const alerts = useMemo(() => filtered.months.flatMap(m => m.alerts).sort((a, b) => b.createdAt - a.createdAt), [filtered]);
  const allAlerts = useMemo(() => months.flatMap(m => m.alerts), [months]);
  const rankings = useRankings(alerts, settings);
  // Activity strips in Recurring end with the selected range (or now, if earlier).
  const activityEnd = Math.min(Date.now(), (parseUtcDate(to) ?? Date.now()) + DAY_MS);

  const partial = months.some((month) => month.partial);
  const usesP1Toggle = breakdown === 'recurring' || breakdown === 'customers';
  const p1Filter = breakdown === 'hotspots' || (usesP1Toggle && p1Only);
  const scoped = p1Filter ? alerts.filter((a) => a.priority === 'P1') : alerts;

  const cancel = async (id: string) => {
    setCancelError('');
    try {
      await cancelHistoryAnalysis(id);
      await progress.refetch();
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : 'Could not cancel the analysis.');
    }
  };

  if (!results.data) {
    return (
      <JobState
        starting={start.isFetching || progress.isPending}
        startError={start.error}
        statusError={progress.error}
        resultsError={results.error}
        job={job}
        sameJob={sameJob}
        cancelError={cancelError}
        onCancel={(id) => void cancel(id)}
        onStartAgain={() => void start.refetch()}
        onRetryStatus={() => void progress.refetch()}
        onRetryResults={() => void results.refetch()}
        onOpenRange={onOpenRange}
      />
    );
  }

  const { ranking, selection, hint } = BREAKDOWN_VIEW[breakdown]({ from, to, alerts, months: filtered.months, rankings, settings, picked, choose, activityEnd });
  const filterChips = filterChipsFor(settings, p1Filter);
  // Results stay once loaded. A job of another range may have replaced this one on the server since.
  const newer = job && !sameJob ? job : null;

  return (
    <section aria-labelledby="history-analysis-title" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex-none space-y-3 border-b border-line p-3">
        {newer && (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>
              Another analysis is now current: {formatUtcRange(newer.from, newer.to)}
              {newer.state === 'running' ? ', running' : ''}.
            </span>
            <button type="button" className={linkButton} onClick={() => onOpenRange({ from: newer.from, to: newer.to })}>Open it</button>
          </p>
        )}
        <AnalysisHeader
          title={BREAKDOWN_INFO[breakdown].title}
          from={from}
          to={to}
          partial={partial}
          count={scoped.length}
          p1={p1Filter}
          note={breakdown === 'customers' ? `${CUSTOMER_NOTE}\n${SCOPE_NOTE}` : SCOPE_NOTE}
          options={options}
          settings={settings}
          onSettingsChange={onSettingsChange}
        />
        <HistoryFilters alerts={allAlerts} settings={settings} onChange={onSettingsChange} />
        {filtered.incomplete && <p className="text-xs text-warn">Filter results may be incomplete: some Jira list records did not include alert details.</p>}
        <BreakdownControls settings={settings} usesP1Toggle={usesP1Toggle} onSettingsChange={onSettingsChange} />
        {results.error && <p role="alert" className="text-xs text-crit">Could not refresh the analysis; showing the previous results. {results.error.message}</p>}
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

/** An explanation kept out of the layout: an icon with a tooltip, readable by keyboard and screen reader too. */
export function InfoTip({ text, className }: Readonly<{ text: string; className?: string }>) {
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={text}
      data-tip={text}
      data-tip-always=""
      className={cn('inline-flex flex-none cursor-help items-center rounded-full text-subtle hover:text-fg', className)}
    >
      <Info size={13} aria-hidden />
    </span>
  );
}

function BusyLine({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <output className="flex items-center gap-2 p-3 text-sm text-muted">
      <LoaderCircle size={14} aria-hidden className="spin flex-none text-accent" />
      {children}
    </output>
  );
}

function ErrorLine({ message, children }: Readonly<{ message: string; children?: ReactNode }>) {
  return (
    <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
      <p role="alert" className="text-crit">{message}</p>
      {children}
    </div>
  );
}

/** Months scanned of the range, as a bar. */
function MonthProgress({ done, total }: Readonly<{ done: number; total: number }>) {
  return (
    <span
      role="progressbar"
      aria-label="Months scanned"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total} months`}
      className="block h-1.5 w-24 flex-none overflow-hidden rounded-full bg-line"
    >
      <span
        className="block h-full rounded-full bg-accent transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.max(4, (done / total) * 100)}%` }}
      />
    </span>
  );
}

/** One line while the job runs: progress, counts and Cancel. */
function RunningLine({ job, cancelError, onCancel }: Readonly<{ job: HistoryAnalysisStatus; cancelError: string; onCancel: () => void }>) {
  const total = job.monthsTotal;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 p-3 text-sm">
      {total > 0 ? <MonthProgress done={job.monthsDone} total={total} /> : <LoaderCircle size={14} aria-hidden className="spin flex-none text-accent" />}
      <output className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">Analyzing…</span>
        <span className="tabular-nums text-muted">
          {total > 0 && `${job.monthsDone}/${total} months · `}
          {job.pages.toLocaleString()} pages · {job.recordsRead.toLocaleString()} records
        </span>
      </output>
      <InfoTip text={RECORDS_NOTE} />
      {job.message && <span className="text-xs text-warn">{job.message}</span>}
      <button type="button" className={button} onClick={onCancel}>Cancel</button>
      {cancelError && <span role="alert" className="text-xs text-crit">{cancelError}</span>}
    </div>
  );
}

/** Everything before the results are shown: starting, running, failures, and a job replaced by another. */
function JobState({
  starting, startError, statusError, resultsError, job, sameJob, cancelError, onCancel, onStartAgain, onRetryStatus, onRetryResults, onOpenRange,
}: Readonly<{
  starting: boolean;
  startError: Error | null;
  statusError: Error | null;
  resultsError: Error | null;
  job: HistoryAnalysisStatus | null;
  sameJob: boolean;
  cancelError: string;
  onCancel: (id: string) => void;
  onStartAgain: () => void;
  onRetryStatus: () => void;
  onRetryResults: () => void;
  onOpenRange: (range: DateRange) => void;
}>) {
  const analyzeAgain = <button type="button" className={button} onClick={onStartAgain}>Analyze again</button>;
  if (starting) return <BusyLine>Starting analysis…</BusyLine>;
  if (statusError) {
    return (
      <ErrorLine message={statusError.message}>
        <button type="button" className={button} onClick={onRetryStatus}>Retry</button>
      </ErrorLine>
    );
  }
  if (startError || !sameJob) {
    return <ReplacedState startError={startError} job={job} cancelError={cancelError} onCancel={onCancel} onStartAgain={onStartAgain} onOpenRange={onOpenRange} />;
  }
  if (!job) return null;
  if (job.state === 'running') return <RunningLine job={job} cancelError={cancelError} onCancel={() => onCancel(job.id)} />;
  if (job.state === 'failed') return <ErrorLine message={job.message ?? 'The analysis failed.'}>{analyzeAgain}</ErrorLine>;
  if (job.state === 'cancelled') {
    return (
      <div className="flex flex-wrap items-center gap-2 p-3 text-sm text-muted">
        <output>Analysis cancelled.</output>
        {analyzeAgain}
      </div>
    );
  }
  if (resultsError) {
    return (
      <ErrorLine message={`Could not load the results. ${resultsError.message}`}>
        <button type="button" className={button} onClick={onRetryResults}>Retry</button>
      </ErrorLine>
    );
  }
  return <BusyLine>Loading results…</BusyLine>;
}

/**
 * This range has no job on the server: another range runs and blocks it, another
 * analysis replaced it, or the server restarted and lost it.
 */
function ReplacedState({ startError, job, cancelError, onCancel, onStartAgain, onOpenRange }: Readonly<{
  startError: Error | null;
  job: HistoryAnalysisStatus | null;
  cancelError: string;
  onCancel: (id: string) => void;
  onStartAgain: () => void;
  onOpenRange: (range: DateRange) => void;
}>) {
  const open = job && <button type="button" className={button} onClick={() => onOpenRange({ from: job.from, to: job.to })}>Open it</button>;
  if (startError) {
    return (
      <div className="space-y-2 p-3 text-sm">
        <p role="alert" className="text-crit">{startError.message}</p>
        {job?.state === 'running' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums text-muted">
              Running: {formatUtcRange(job.from, job.to)} · {job.pages.toLocaleString()} pages · {job.recordsRead.toLocaleString()} records
            </span>
            {open}
            <button type="button" className={button} onClick={() => onCancel(job.id)}>Cancel it</button>
          </div>
        )}
        <button type="button" className={button} onClick={onStartAgain}>Retry</button>
        {cancelError && <p role="alert" className="text-xs text-crit">{cancelError}</p>}
      </div>
    );
  }
  const message = job
    ? `Another analysis replaced this one: ${formatUtcRange(job.from, job.to)}${job.state === 'running' ? ', running' : ''}.`
    : 'The server restarted, and this analysis was lost.';
  return (
    <div className="flex flex-wrap items-center gap-2 p-3 text-sm text-muted">
      <output>{message}</output>
      {open}
      <button type="button" className={button} onClick={onStartAgain}>Analyze again</button>
    </div>
  );
}

/** Title, number of alerts in scope, and the customer and tag filters. */
function AnalysisHeader({ title, from, to, partial, count, p1, note, options, settings, onSettingsChange }: Readonly<{
  title: string;
  from: string;
  to: string;
  partial: boolean;
  count: number;
  p1: boolean;
  /** What the figures cover, behind the ⓘ beside the range. */
  note: string;
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
              // Focusable, so the tooltip that explains the + marks opens from the keyboard too.
              tabIndex={0}
              className="rounded bg-warn-soft px-1.5 text-[11px] font-semibold text-warn"
              data-tip={PARTIAL_NOTE}
              data-tip-always=""
            >
              Partial
            </span>
          )}
        </h2>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          <span>
            {formatUtcRange(from, to)} (inclusive, UTC) · {partial ? 'At least ' : ''}{count.toLocaleString()} {p1 ? 'P1 alerts' : 'matching alerts'}
          </span>
          <InfoTip text={note} />
        </p>
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
      {breakdown === 'daily' && <label className="text-xs">Group created by{' '}
        <select className={select} value={settings.dayBy ?? 'priority'} onChange={e => onSettingsChange({ dayBy: e.target.value as 'priority' | 'status' })}>
          <option value="priority">Priority</option><option value="status">Current status</option>
        </select>
      </label>}
      {breakdown === 'rankings' && <label className="text-xs">Rank by{' '}
        <select className={select} value={settings.rankBy ?? 'source'} onChange={e => onSettingsChange({ rankBy: e.target.value as AnalysisSettings['rankBy'] })}>
          {RANK_BY.map(by => <option key={by}>{by}</option>)}
        </select>
      </label>}
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
          const label = formatUtcMonth(m.from);
          const count = m.alerts.length;
          return (
            <li key={m.key} className="min-w-14 flex-1">
              <button
                type="button"
                aria-label={`${label.long}, ${m.partial ? 'at least ' : ''}${count} alerts`}
                aria-pressed={m.key === picked}
                onClick={() => onPick(m.key)}
                className={cn('flex w-full flex-col items-center gap-1 rounded px-1 py-1 text-xs hover:bg-hover', m.key === picked && 'bg-accent-soft')}
              >
                <span className="flex h-24 w-full flex-col justify-end gap-1 border-b border-line-strong" aria-hidden>
                  <span className={cn('font-semibold tabular-nums', m.partial && 'text-warn')}>{count}{m.partial ? '+' : ''}</span>
                  <span className={cn('mx-auto w-2/3 max-w-16 rounded-t bg-accent', m.partial && 'bg-warn')} style={{ height: `${count / max * 74}%` }} />
                </span>
                <span className="whitespace-nowrap text-muted">{label.short}</span>
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
      {(ranking.withoutCustomer > 0 || !p1Only) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {!p1Only && (
            <span className="flex items-center gap-2" aria-hidden>
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-crit" />P1</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-accent" />Other</span>
            </span>
          )}
          {ranking.withoutCustomer > 0 && <span className="tabular-nums">{ranking.withoutCustomer.toLocaleString()} without customer</span>}
        </p>
      )}
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
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted">{formatUtcDay(group.firstCreatedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted">{formatUtcDay(group.lastCreatedAt)}</td>
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

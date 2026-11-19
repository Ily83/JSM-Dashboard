import { useState } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { DAY_MS, HISTORY_PAGE_SIZE, historyDateLimits, historyWindows, parseUtcDate, utcDate } from '../../shared/history';
import { fetchHistory } from '../api/client';
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisSettings } from '../lib/historyBreakdowns';
import type { HistoryInvestigation } from '../state/historyInvestigations';
import { HistoryAnalysis } from './HistoryAnalysis';
import { HistoryInvestigationsMenu } from './HistoryInvestigationsMenu';
import { HistoryTable } from './HistoryTable';

const button = 'rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium hover:bg-hover disabled:opacity-50';
const dateInput = 'rounded-md border border-line-strong bg-panel px-2 py-1 text-fg';

export function HistoryView() {
  const { earliest, today } = historyDateLimits(Date.now());
  const [from, setFrom] = useState(() => utcDate(parseUtcDate(today)! - 29 * DAY_MS));
  const [to, setTo] = useState(today);
  const [windows, setWindows] = useState<ReturnType<typeof historyWindows>>([]);
  const [period, setPeriod] = useState(0);
  const [offset, setOffset] = useState(0);
  const [inputError, setInputError] = useState('');
  const [analysis, setAnalysis] = useState(false);
  const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_ANALYSIS_SETTINGS);
  const [activeInvestigation, setActiveInvestigation] = useState<string | null>(null);
  const selected = windows[period];
  const query = useQuery({
    queryKey: ['history', selected?.from, selected?.to, offset],
    queryFn: selected && !analysis ? ({ signal }) => fetchHistory(selected, offset, signal) : skipToken,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const result = query.data;

  const changePeriod = (index: number) => {
    setPeriod(index);
    setOffset(0);
  };

  const analysedRange = analysis && windows.length > 0 ? { from: windows.at(-1)!.from, to: windows[0]!.to } : { from, to };

  const openInvestigation = (investigation: HistoryInvestigation) => {
    // Saved dates may have fallen out of the 12-month window since they were saved.
    const start = Math.max(parseUtcDate(investigation.from)!, parseUtcDate(earliest)!);
    const end = Math.min(parseUtcDate(investigation.to)!, parseUtcDate(today)!);
    const { id: _id, name: _name, from: _from, to: _to, ...saved } = investigation;
    setActiveInvestigation(investigation.id);
    setSettings(saved);
    setFrom(utcDate(start));
    setTo(utcDate(end));
    if (start > end) {
      setInputError('The saved dates are older than 12 months. Choose new dates.');
      setAnalysis(false);
      setWindows([]);
      return;
    }
    setInputError('');
    setAnalysis(true);
    setWindows(historyWindows(start, end));
    changePeriod(0);
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none space-y-3 border-b border-line p-3">
        <p className="text-sm text-muted">
          Search retained alerts by creation date, including closed alerts. Dates are in UTC. History loads on demand and does not change the live dashboard.
        </p>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={(event) => {
            event.preventDefault();
            const start = parseUtcDate(from);
            const end = parseUtcDate(to);
            if (start === null || end === null || start > end || from < earliest || to > today) {
              setInputError('Choose valid dates within the past 12 months. From must be on or before To.');
              return;
            }
            setInputError('');
            const submitter = (event.nativeEvent as SubmitEvent).submitter;
            const analyze = submitter instanceof HTMLButtonElement && submitter.value === 'analysis';
            setAnalysis(analyze);
            const next = historyWindows(start, end);
            setWindows(next);
            changePeriod(0);
            if (!analysis && !analyze && next[0]?.from === selected?.from && next[0]?.to === selected?.to && offset === 0) void query.refetch();
          }}>
            <label className="grid gap-1">
              From
              <input type="date" className={dateInput} min={earliest} max={today} required value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="grid gap-1">
              To
              <input type="date" className={dateInput} min={earliest} max={today} required value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <button type="button" className={button} onClick={() => { setFrom(earliest); setTo(today); setInputError(''); }}>Past 12 months</button>
            <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent">Load history</button>
            <button type="submit" value="analysis" className={button}>Analyze</button>
          </form>
          <HistoryInvestigationsMenu
            current={{ ...analysedRange, ...settings }}
            activeId={activeInvestigation}
            onOpen={openInvestigation}
            onActiveChange={setActiveInvestigation}
          />
        </div>
        {inputError && <p role="alert" className="text-sm text-crit">{inputError}</p>}
      </div>

      {selected && analysis ? (
        <HistoryAnalysis
          key={`${windows.at(-1)!.from}/${windows[0]!.to}`}
          from={windows.at(-1)!.from}
          to={windows[0]!.to}
          settings={settings}
          onSettingsChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
        />
      ) : selected && (
        <>
          <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line p-3">
            <strong className="mr-auto text-sm">{selected.from} to {selected.to} (UTC)</strong>
            {windows.length > 1 && (
              <>
                <button type="button" className={button} disabled={period === 0} onClick={() => changePeriod(period - 1)}>Newer dates</button>
                <button type="button" className={button} disabled={period + 1 >= windows.length} onClick={() => changePeriod(period + 1)}>Older dates</button>
              </>
            )}
            <button type="button" className={button} disabled={offset === 0} onClick={() => setOffset(offset - HISTORY_PAGE_SIZE)}>Previous page</button>
            <span className="text-xs tabular-nums text-muted">Page {offset / HISTORY_PAGE_SIZE + 1}</span>
            <button type="button" className={button} disabled={!result?.hasNext} onClick={() => setOffset(offset + HISTORY_PAGE_SIZE)}>Next page</button>
          </div>
          {query.isFetching && <p role="status" className="p-3 text-sm text-muted">Loading history…</p>}
          {query.error && (
            <div role="alert" className="flex flex-wrap items-center gap-2 p-3 text-sm text-crit">
              {query.error.message}
              <button type="button" className={button} disabled={query.isFetching} onClick={() => void query.refetch()}>Retry</button>
            </div>
          )}
          {result?.truncated && (
            <p role="status" className="bg-warn-soft p-3 text-sm text-warn">
              This date window exceeds the pagination limit. Select a shorter range to see all available alerts.
            </p>
          )}
          {!!result?.skipped && <p role="status" className="p-3 text-sm text-warn">Some alert records could not be read on this page.</p>}
          {result && (result.alerts.length === 0 ? (
            <p className="p-3 text-sm text-muted">No displayable alerts on this page.</p>
          ) : (
            <HistoryTable key={`${selected.from}/${selected.to}/${offset}`} alerts={result.alerts} />
          ))}
        </>
      )}
    </main>
  );
}

import { useMemo } from 'react';
import { PRIORITIES, STATUSES, type Alert } from '../../shared/types';
import { parseUtcDate } from '../../shared/history';
import type { AnalysisSettings } from '../lib/historyBreakdowns';
import { formatUtcDay } from '../lib/historyAnalysis';
import { dailyHistory, historySource, historyTags } from '../lib/historyMetrics';

const select = 'max-w-48 rounded border border-line-strong bg-panel px-2 py-1 text-xs';
const metric = 'rounded border border-line-strong px-2 py-1 text-xs hover:bg-hover aria-pressed:border-accent aria-pressed:bg-accent-soft';
export const statusTitle = { open: 'Open', acked: 'Acknowledged', snoozed: 'Snoozed', closed: 'Closed' } as const;
const label = (value: string) => statusTitle[value as keyof typeof statusTitle] ?? value;

type Controls = { settings: AnalysisSettings; onChange: (value: Partial<AnalysisSettings>) => void };

export function HistoryFilters({ alerts, settings, onChange }: Readonly<Controls & { alerts: Alert[] }>) {
  const { tags, sources, integrations } = useMemo(() => {
    const tags = new Set<string>();
    const sources = new Set<string>();
    const integrations = new Set<string>();
    for (const alert of alerts) {
      historyTags(alert).forEach(tag => tags.add(tag));
      sources.add(historySource(alert));
      if (alert.integrationName) integrations.add(alert.integrationName);
    }
    return { tags, sources, integrations };
  }, [alerts]);
  const dropdown = (field: keyof AnalysisSettings, title: string, values: Iterable<string>) => {
    const current = String(settings[field] ?? '');
    const options = [...new Set([...values, ...(current ? [current] : [])])].sort((a, b) => a.localeCompare(b));
    return <label key={field} className="grid gap-1 text-xs">{title}
      <select className={select} value={current} onChange={e => onChange({ [field]: e.target.value || undefined })}>
        <option value="">Any</option>
        {options.map(v => <option key={v} value={v}>{field === 'status' ? label(v) : v}</option>)}
      </select>
    </label>;
  };
  return <details className="rounded border border-line px-2 py-1.5">
    <summary className="cursor-pointer text-xs font-medium">More filters</summary>
    <div className="mt-2 flex flex-wrap gap-2">
      {dropdown('excludeTag', 'Exclude tag', tags)}
      {dropdown('source', 'Source', sources)}
      {dropdown('excludeSource', 'Exclude source', sources)}
      {dropdown('integration', 'Integration', integrations)}
      {dropdown('status', 'Current status', STATUSES)}
      {dropdown('priority', 'Priority', PRIORITIES)}
      {([['message', 'Message includes'], ['excludeMessage', 'Message excludes'], ['propertyKey', 'Detail key'], ['propertyValue', 'Detail value includes']] as const)
        .map(([field, title]) => <label key={field} className="grid gap-1 text-xs">{title}
          <input className={select} maxLength={200} value={settings[field] ?? ''} onChange={e => onChange({ [field]: e.target.value })} />
        </label>)}
    </div>
  </details>;
}

type MetricProps = { alerts: Alert[]; picked: string | null; choose: (key: string) => void };
export function overviewBuckets(alerts: Alert[]): Array<{ title: string; buckets: Array<{ key: string; title: string; alerts: Alert[] }> }> {
  return [
    { title: 'Current status', buckets: STATUSES.map(value => ({ key: `status:${value}`, title: label(value), alerts: alerts.filter(a => a.status === value) })) },
    { title: 'Current priority', buckets: PRIORITIES.map(value => ({ key: `priority:${value}`, title: value, alerts: alerts.filter(a => a.priority === value) })) },
  ];
}

export function HistoryOverview({ alerts, picked, choose }: Readonly<MetricProps>) {
  return <div className="grid gap-2">
    {overviewBuckets(alerts).map(group => <div key={group.title} className="flex flex-wrap items-center gap-1.5">
      <span className="w-28 text-xs text-muted">{group.title}</span>
      {group.buckets.map(b => <button type="button" key={b.key} className={metric} aria-pressed={picked === b.key} onClick={() => choose(b.key)}>
        {b.title}: {b.alerts.length.toLocaleString()}
      </button>)}
    </div>)}
  </div>;
}

export function HistoryDaily({ alerts, from, to, by, picked, choose }: Readonly<MetricProps & { from: string; to: string; by: 'status' | 'priority' }>) {
  const { days, missing } = dailyHistory(alerts, from, to);
  const groups = by === 'status' ? STATUSES : PRIORITIES;
  const max = Math.max(1, ...days.map(day => Math.max(day.created.length, day.closed.length)));
  return <div className="space-y-2 text-xs">
    <p className="text-muted">{(alerts.length / Math.max(1, days.length)).toFixed(1)} created per UTC day on average. Closed counts only include the selected creation cohort with a usable close time{missing > 0 ? ` (${missing} closed alerts missing a usable time)` : ''}.</p>
    <div className="max-h-56 overflow-auto">
      <table className="w-full text-left tabular-nums">
        <thead><tr><th>UTC day</th><th>Created</th>{groups.map(g => <th key={g}>{label(g)}</th>)}<th>Closed that day</th></tr></thead>
        <tbody>{days.map(({ day, created, closed }) => {
          const cell = (key: string, values: Alert[], bar = false) => <td key={key} className="border-t border-line p-0.5">
            <button type="button" className={`${metric} flex items-center gap-1.5 disabled:opacity-60`} aria-pressed={picked === key} disabled={!values.length} onClick={() => choose(key)}>
              {bar && <span aria-hidden className="hidden h-1.5 w-20 rounded bg-line sm:block">
                <span className="block h-full rounded bg-accent" style={{ width: `${100 * values.length / max}%` }} />
              </span>}
              <span>{values.length}</span>
            </button>
          </td>;
          return <tr key={day}>
            <th scope="row" className="border-t border-line font-normal">{formatUtcDay(parseUtcDate(day)!)}</th>
            {cell(`${day}|created`, created, true)}
            {groups.map(g => cell(`${day}|${g}`, created.filter(a => a[by] === g)))}
            {cell(`${day}|closed-at`, closed, true)}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

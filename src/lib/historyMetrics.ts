import { DAY_MS, parseUtcDate, utcDate } from '../../shared/history';
import type { HistoryMonth } from '../../shared/historyAnalysis';
import type { Alert } from '../../shared/types';
import type { AnalysisSettings, RankedEntry } from './historyBreakdowns';

export const historyTags = (alert: Alert) => alert.historyFields?.tags ?? alert.tags;
export const historySource = (alert: Alert) => alert.rawSource ?? alert.source;
const contains = (value: string, query: string) => value.toLowerCase().includes(query.trim().toLowerCase());

export function filterAnalysis(months: readonly HistoryMonth[], s: AnalysisSettings) {
  const excluded = new Set<string>();
  return {
    months: months.map(month => ({
      ...month,
      alerts: month.alerts.filter(a => {
        if (excluded.has(a.id)) return false;
        excluded.add(a.id);
        const tags = historyTags(a);
        if ((s.customer && !a.customers.includes(s.customer)) || (s.tag && !tags.includes(s.tag)) ||
            (s.excludeTag && tags.includes(s.excludeTag)) || (s.source && historySource(a) !== s.source) ||
            (s.excludeSource && historySource(a) === s.excludeSource) || (s.integration && a.integrationName !== s.integration) ||
            (s.status && a.status !== s.status) || (s.priority && a.priority !== s.priority) ||
            (s.message?.trim() && !contains(a.summary, s.message)) || (s.excludeMessage?.trim() && contains(a.summary, s.excludeMessage))) return false;
        if (!s.propertyKey?.trim() && !s.propertyValue?.trim()) return true;
        return Object.entries(a.historyFields?.properties ?? {}).some(([key, value]) =>
          (!s.propertyKey?.trim() || key.toLowerCase() === s.propertyKey.trim().toLowerCase()) &&
          (!s.propertyValue?.trim() || contains(value, s.propertyValue)));
      }),
    })),
    incomplete: months.some(m => m.alerts.some(a =>
      (s.propertyKey?.trim() || s.propertyValue?.trim() || s.customer) && !a.historyFields?.properties)),
  };
}

function entry(key: string, label: string, alerts: Alert[]): RankedEntry {
  return { key, label, count: alerts.length, total: alerts.length, alerts, p1: alerts.filter(a => a.priority === 'P1').length };
}

export function rankHistory(alerts: Alert[], by: NonNullable<AnalysisSettings['rankBy']>) {
  const groups = new Map<string, { label: string; alerts: Alert[] }>();
  for (const a of alerts) {
    const keys = new Map<string, string>();
    if (by === 'source') keys.set(historySource(a), historySource(a));
    else if (by === 'tag') for (const tag of historyTags(a)) keys.set(tag, tag);
    else for (const r of a.responders) if (r.type === 'team') keys.set(r.id, r.name ?? r.id);
    if (!keys.size) keys.set('', by === 'tag' ? 'No tags' : 'No team responder');
    for (const [key, label] of keys) {
      if (!groups.has(key)) groups.set(key, { label, alerts: [] });
      groups.get(key)!.alerts.push(a);
    }
  }
  return [...groups].map(([key, group]) => entry(key, group.label, group.alerts))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function dailyHistory(alerts: Alert[], from: string, to: string) {
  const days = new Map<string, { day: string; created: Alert[]; closed: Alert[] }>();
  const first = parseUtcDate(from);
  const last = parseUtcDate(to);
  if (first === null || last === null) return { days: [], missing: 0 };
  for (let t = first; t <= last; t += DAY_MS) {
    const day = utcDate(t);
    days.set(day, { day, created: [], closed: [] });
  }
  let missing = 0;
  for (const alert of alerts) {
    days.get(utcDate(alert.createdAt))?.created.push(alert);
    if (alert.status !== 'closed') continue;
    if (alert.closeTime === null || alert.closeTime < alert.createdAt) { missing++; continue; }
    days.get(utcDate(alert.closeTime))?.closed.push(alert);
  }
  return { days: [...days.values()], missing };
}

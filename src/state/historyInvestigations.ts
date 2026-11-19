import { parseUtcDate } from '../../shared/history';
import {
  DEFAULT_ANALYSIS_SETTINGS,
  isBreakdown,
  isHotspotDimension,
  type AnalysisSettings,
} from '../lib/historyBreakdowns';
import { isResponseDimension } from '../lib/responseTimes';
import { createPersistentStore, deepEqual, isRecord } from '../lib/store';

/** A saved History analysis: date range (UTC), filters and breakdown. */
export interface HistoryInvestigation extends AnalysisSettings {
  id: string;
  name: string;
  from: string;
  to: string;
}

export interface HistoryInvestigationsData {
  saved: HistoryInvestigation[];
}

export const MAX_INVESTIGATIONS = 100;
const MAX_NAME = 80;
const MAX_FILTER = 200;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function sanitizeInvestigation(stored: unknown): HistoryInvestigation | null {
  if (!isRecord(stored) || typeof stored.id !== 'string' || !stored.id) return null;
  const from = parseUtcDate(stored.from);
  const to = parseUtcDate(stored.to);
  if (from === null || to === null || from > to) return null;
  const defaults = DEFAULT_ANALYSIS_SETTINGS();
  return {
    id: stored.id.slice(0, 100),
    name: text(stored.name, MAX_NAME) || 'Untitled investigation',
    from: stored.from as string,
    to: stored.to as string,
    customer: text(stored.customer, MAX_FILTER),
    tag: text(stored.tag, MAX_FILTER),
    breakdown: isBreakdown(stored.breakdown) ? stored.breakdown : defaults.breakdown,
    p1Only: stored.p1Only === true,
    dimension: isHotspotDimension(stored.dimension) ? stored.dimension : defaults.dimension,
    responseBy: isResponseDimension(stored.responseBy) ? stored.responseBy : defaults.responseBy,
  };
}

export function sanitizeHistoryInvestigations(stored: unknown, fallback: HistoryInvestigationsData = { saved: [] }): HistoryInvestigationsData {
  if (!isRecord(stored) || !Array.isArray(stored.saved)) return fallback;
  const ids = new Set<string>();
  const saved: HistoryInvestigation[] = [];
  for (const item of stored.saved) {
    const investigation = sanitizeInvestigation(item);
    if (!investigation || ids.has(investigation.id)) continue;
    ids.add(investigation.id);
    saved.push(investigation);
    if (saved.length >= MAX_INVESTIGATIONS) break;
  }
  return { saved };
}

export const historyStore = createPersistentStore<HistoryInvestigationsData>(
  'history:v1',
  () => ({ saved: [] }),
  sanitizeHistoryInvestigations,
);

export interface InvestigationInput extends AnalysisSettings {
  from: string;
  to: string;
}

function pick(input: InvestigationInput): InvestigationInput {
  return {
    from: input.from,
    to: input.to,
    customer: input.customer,
    tag: input.tag,
    breakdown: input.breakdown,
    p1Only: input.p1Only,
    dimension: input.dimension,
    responseBy: input.responseBy,
  };
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Saves a new investigation and returns its id, or null when the input is invalid or the list is full. */
export function saveInvestigation(name: string, input: InvestigationInput): string | null {
  const investigation = sanitizeInvestigation({ ...pick(input), id: newId(), name });
  if (!investigation || historyStore.get().saved.length >= MAX_INVESTIGATIONS) return null;
  historyStore.set((data) => ({ saved: [...data.saved, investigation] }));
  return investigation.id;
}

export function updateInvestigation(id: string, input: InvestigationInput): void {
  historyStore.set((data) => ({
    saved: data.saved.map((item) => {
      if (item.id !== id) return item;
      return sanitizeInvestigation({ ...item, ...pick(input) }) ?? item;
    }),
  }));
}

export function renameInvestigation(id: string, name: string): void {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) return;
  historyStore.set((data) => ({ saved: data.saved.map((item) => (item.id === id ? { ...item, name: clean } : item)) }));
}

export function deleteInvestigation(id: string): void {
  historyStore.set((data) => ({ saved: data.saved.filter((item) => item.id !== id) }));
}

export function isInvestigationModified(saved: HistoryInvestigation, input: InvestigationInput): boolean {
  const { id: _id, name: _name, ...rest } = saved;
  return !deepEqual(rest, pick(input));
}

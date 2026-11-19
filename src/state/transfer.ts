import {
  buildPreferencesFile,
  buildViewFile,
  mergeViews,
  type ConflictChoice,
  type ImportPayload,
  type PreferencesFile,
  type TransferPart,
  type ViewFile,
} from '../lib/preferencesTransfer';
import type { PersistentStore } from '../lib/store';
import { dashboardStore, sanitizeDashboard } from './dashboard';
import { historyStore, sanitizeHistoryInvestigations } from './historyInvestigations';
import { prefsStore, sanitizePrefs } from './prefs';
import { sanitizeTableLayout, tableLayoutStore } from './tableLayout';
import { viewsStore } from './views';

function storePart<T>(key: string, label: string, store: PersistentStore<T>, sanitize: (raw: unknown) => T): TransferPart<T> {
  return { key, label, read: store.get, sanitize, write: (value) => store.set(value) };
}

/**
 * Stores included in a preferences backup and replaced by an import. To add
 * a store, add one line. Saved views (views:v1) are always included and are
 * merged rather than replaced, see mergeViews().
 */
export const TRANSFER_PARTS: TransferPart[] = [
  storePart('prefs:v1', 'General and profile', prefsStore, (raw) => sanitizePrefs(raw)),
  storePart('table:v1', 'Table columns', tableLayoutStore, (raw) => sanitizeTableLayout(raw)),
  storePart('dashboard:v1', 'Dashboard', dashboardStore, (raw) => sanitizeDashboard(raw)),
  storePart('history:v1', 'History investigations', historyStore, (raw) => sanitizeHistoryInvestigations(raw)),
];

export function exportPreferences(): PreferencesFile {
  return buildPreferencesFile(TRANSFER_PARTS, viewsStore.get());
}

export function exportView(id: string): ViewFile | null {
  const view = viewsStore.get().saved.find((v) => v.id === id);
  return view ? buildViewFile(view) : null;
}

export interface ImportSelection {
  /** Keys of the parts to replace. */
  parts: string[];
  views: boolean;
  choice: ConflictChoice;
}

export interface ImportOutcome {
  replacedParts: string[];
  viewsAdded: number;
  viewsReplaced: number;
}

/** Applies a validated import. Nothing is written for parts that were not selected. */
export function applyImport(payload: ImportPayload, selection: ImportSelection): ImportOutcome {
  const outcome: ImportOutcome = { replacedParts: [], viewsAdded: 0, viewsReplaced: 0 };
  for (const imported of payload.parts) {
    if (!selection.parts.includes(imported.key)) continue;
    const part = TRANSFER_PARTS.find((p) => p.key === imported.key);
    if (!part) continue;
    part.write(imported.value);
    outcome.replacedParts.push(part.label);
  }
  if (selection.views && payload.views.length > 0) {
    const result = mergeViews(viewsStore.get(), payload.views, payload.defaultViewId, selection.choice);
    viewsStore.set(result.data);
    outcome.viewsAdded = result.added;
    outcome.viewsReplaced = result.replaced;
  }
  return outcome;
}

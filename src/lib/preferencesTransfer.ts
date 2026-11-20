import { newId, sanitizeSavedView, uniqueName, type SavedView, type ViewsData } from '../state/views';
import { deepEqual, isRecord } from './store';

/**
 * Export and import of preferences as versioned JSON files.
 *
 * Two file formats:
 *   preferences  every registered store, plus the saved views
 *   view         one saved view
 *
 * Only registered store keys are written, so a file can never contain Jira
 * credentials or alert records. On import, every part goes through the
 * store's own sanitize function before anything is applied, and saved views
 * are merged into the existing ones instead of replacing them.
 */

export const PREFERENCES_FORMAT = 'jsm-alert-center-preferences';
export const VIEW_FORMAT = 'jsm-alert-center-view';
export const TRANSFER_VERSION = 1;
export const MAX_IMPORT_BYTES = 512 * 1024;
export const MAX_IMPORTED_VIEWS = 200;
export const VIEWS_KEY = 'views:v1';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,100}$/;

/** A store that an import replaces as a whole. */
export interface TransferPart<T = unknown> {
  /** Storage key, also the key in the file. */
  key: string;
  label: string;
  read(): T;
  /** Turns imported data into a valid value. Only called with an object. */
  sanitize(raw: unknown): T;
  write(value: T): void;
}

export interface PreferencesFile {
  format: typeof PREFERENCES_FORMAT;
  version: typeof TRANSFER_VERSION;
  exportedAt: string;
  data: Record<string, unknown>;
}

export interface ViewFile {
  format: typeof VIEW_FORMAT;
  version: typeof TRANSFER_VERSION;
  exportedAt: string;
  view: SavedView;
}

export function buildPreferencesFile(parts: readonly TransferPart[], views: Pick<ViewsData, 'saved' | 'defaultViewId'>, now = new Date()): PreferencesFile {
  const data: Record<string, unknown> = {};
  for (const part of parts) data[part.key] = part.read();
  // Saved views only: the live screen state is not part of a backup.
  data[VIEWS_KEY] = { saved: views.saved, defaultViewId: views.defaultViewId };
  return { format: PREFERENCES_FORMAT, version: TRANSFER_VERSION, exportedAt: now.toISOString(), data };
}

export function buildViewFile(view: SavedView, now = new Date()): ViewFile {
  return { format: VIEW_FORMAT, version: TRANSFER_VERSION, exportedAt: now.toISOString(), view };
}

// ---- Import: parse and validate ---------------------------------------------

export interface ImportedPart {
  key: string;
  label: string;
  /** Already sanitized. */
  value: unknown;
}

export interface ImportPayload {
  kind: 'preferences' | 'view';
  exportedAt: string | null;
  parts: ImportedPart[];
  /** Sanitized, unique ids. */
  views: SavedView[];
  /** Id of the imported default view, if it is among `views`. */
  defaultViewId: string | null;
  /** Parts or items that were not imported. Shown to the user, never applied. */
  ignored: string[];
}

export type ParseResult = { ok: true; payload: ImportPayload } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });
const shorten = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function importViews(raw: unknown, ignored: string[]): { views: SavedView[]; defaultViewId: string | null } {
  if (!isRecord(raw) || !Array.isArray(raw.saved)) {
    ignored.push('Saved views');
    return { views: [], defaultViewId: null };
  }
  const views: SavedView[] = [];
  const ids = new Set<string>();
  let invalid = 0;
  for (const item of raw.saved) {
    const view = sanitizeSavedView(item);
    if (!view) {
      invalid += 1;
      continue;
    }
    if (views.length >= MAX_IMPORTED_VIEWS) {
      invalid += 1;
      continue;
    }
    // An odd or repeated id is replaced; the view itself is still imported.
    if (!SAFE_ID.test(view.id) || ids.has(view.id)) view.id = newId();
    ids.add(view.id);
    views.push(view);
  }
  if (invalid > 0) ignored.push(`${invalid} saved ${invalid === 1 ? 'view' : 'views'}`);
  const defaultViewId = typeof raw.defaultViewId === 'string' && ids.has(raw.defaultViewId) ? raw.defaultViewId : null;
  return { views, defaultViewId };
}

/** Checks size, JSON, format and version of a file. Returns its content, or the error message. */
function readTransferFile(text: string): Record<string, unknown> | string {
  if (byteLength(text) > MAX_IMPORT_BYTES) return `File is larger than ${MAX_IMPORT_BYTES / 1024} KB.`;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return 'Not a valid JSON file.';
  }
  if (!isRecord(json) || (json.format !== PREFERENCES_FORMAT && json.format !== VIEW_FORMAT)) {
    return 'Not an Alert Center preferences or view file.';
  }
  if (typeof json.version !== 'number') return 'The file has no version.';
  if (json.version > TRANSFER_VERSION) return 'The file was made by a newer version of the Alert Center.';
  if (json.version !== TRANSFER_VERSION) return `Unsupported file version ${String(json.version)}.`;
  return json;
}

function importViewFile(view: unknown, exportedAt: string | null): ParseResult {
  const { views } = importViews({ saved: [view] }, []);
  if (views.length === 0) return fail('The view in this file is not valid.');
  return { ok: true, payload: { kind: 'view', exportedAt, parts: [], views, defaultViewId: null, ignored: [] } };
}

/** One part of a preferences file, sanitized by its store. Null, and noted in `ignored`, when it cannot be used. */
function importPart(key: string, raw: unknown, part: TransferPart | undefined, ignored: string[]): ImportedPart | null {
  if (!part) {
    ignored.push(shorten(key));
    return null;
  }
  if (!isRecord(raw)) {
    ignored.push(part.label);
    return null;
  }
  try {
    return { key, label: part.label, value: part.sanitize(raw) };
  } catch {
    ignored.push(part.label);
    return null;
  }
}

function importPreferences(data: Record<string, unknown>, parts: readonly TransferPart[], exportedAt: string | null): ParseResult {
  const known = new Map(parts.map((part) => [part.key, part]));
  const ignored: string[] = [];
  const imported: ImportedPart[] = [];
  let views: SavedView[] = [];
  let defaultViewId: string | null = null;
  for (const [key, raw] of Object.entries(data)) {
    if (key === VIEWS_KEY) {
      ({ views, defaultViewId } = importViews(raw, ignored));
      continue;
    }
    const part = importPart(key, raw, known.get(key), ignored);
    if (part) imported.push(part);
  }
  if (imported.length === 0 && views.length === 0) return fail('Nothing to import in this file.');
  return {
    ok: true,
    payload: { kind: 'preferences', exportedAt, parts: imported, views, defaultViewId, ignored: ignored.slice(0, 10) },
  };
}

export function parseImportFile(text: string, parts: readonly TransferPart[]): ParseResult {
  const json = readTransferFile(text);
  if (typeof json === 'string') return fail(json);
  const exportedAt = typeof json.exportedAt === 'string' && Number.isFinite(Date.parse(json.exportedAt)) ? json.exportedAt : null;
  if (json.format === VIEW_FORMAT) return importViewFile(json.view, exportedAt);
  if (!isRecord(json.data)) return fail('The file contains no preferences.');
  return importPreferences(json.data, parts, exportedAt);
}

// ---- Import: saved views -------------------------------------------------------

export type ConflictChoice = 'keepBoth' | 'replace';

export interface ViewConflict {
  imported: SavedView;
  existing: SavedView;
  /** What the two views share. */
  reason: 'id' | 'name';
}

export interface ViewPlan {
  added: SavedView[];
  conflicts: ViewConflict[];
  /** Already present with the same content: skipped. */
  identical: SavedView[];
}

const sameName = (a: SavedView, b: SavedView) => a.name.toLowerCase() === b.name.toLowerCase();

function sameContent(a: SavedView, b: SavedView): boolean {
  return a.name === b.name && a.section === b.section && deepEqual(a.state, b.state) && deepEqual(a.layout, b.layout);
}

type Match = { kind: 'new' } | { kind: 'identical'; existing: SavedView } | { kind: 'conflict'; existing: SavedView; reason: 'id' | 'name' };

function match(view: SavedView, saved: readonly SavedView[]): Match {
  const byId = saved.find((s) => s.id === view.id);
  if (byId) return sameContent(byId, view) ? { kind: 'identical', existing: byId } : { kind: 'conflict', existing: byId, reason: 'id' };
  const byName = saved.find((s) => sameName(s, view));
  if (byName) return sameContent(byName, view) ? { kind: 'identical', existing: byName } : { kind: 'conflict', existing: byName, reason: 'name' };
  return { kind: 'new' };
}

/** What importing these views would do, for the preview. */
export function planViewImport(existing: readonly SavedView[], imported: readonly SavedView[]): ViewPlan {
  const plan: ViewPlan = { added: [], conflicts: [], identical: [] };
  for (const view of imported) {
    const result = match(view, existing);
    if (result.kind === 'new') plan.added.push(view);
    else if (result.kind === 'identical') plan.identical.push(view);
    else plan.conflicts.push({ imported: view, existing: result.existing, reason: result.reason });
  }
  return plan;
}

export interface MergeResult {
  data: ViewsData;
  added: number;
  replaced: number;
}

/**
 * Merges imported views into the saved ones.
 *   keepBoth  a conflicting view is added as a copy with a new id and, if the
 *             name is taken, a name ending in "(imported)"
 *   replace   a conflicting view overwrites the existing one, which keeps its
 *             id and position (so default and active view stay valid)
 * The current default view is kept; the imported default is adopted only when
 * none is set.
 */
export function mergeViews(
  data: ViewsData,
  imported: readonly SavedView[],
  importedDefaultId: string | null,
  choice: ConflictChoice,
  makeId: () => string = newId,
): MergeResult {
  const saved = [...data.saved];
  const finalId = new Map<string, string>();
  let added = 0;
  let replaced = 0;

  for (const view of imported) {
    const result = match(view, saved);
    if (result.kind === 'identical') {
      finalId.set(view.id, result.existing.id);
    } else if (result.kind === 'new') {
      saved.push({ ...view, name: uniqueName(view.name, saved) });
      finalId.set(view.id, view.id);
      added += 1;
    } else if (choice === 'replace') {
      const index = saved.indexOf(result.existing);
      const id = result.existing.id;
      saved[index] = { ...view, id, name: uniqueName(view.name, saved, id) };
      finalId.set(view.id, id);
      replaced += 1;
    } else {
      const id = saved.some((s) => s.id === view.id) ? makeId() : view.id;
      const name = saved.some((s) => sameName(s, view)) ? uniqueName(`${view.name} (imported)`, saved) : uniqueName(view.name, saved);
      saved.push({ ...view, id, name });
      finalId.set(view.id, id);
      added += 1;
    }
  }

  const adoptedDefault = data.defaultViewId ?? (importedDefaultId ? (finalId.get(importedDefaultId) ?? null) : null);
  return { data: { ...data, saved, defaultViewId: adoptedDefault }, added, replaced };
}

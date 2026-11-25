import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_BYTES,
  PREFERENCES_FORMAT,
  VIEW_FORMAT,
  VIEWS_KEY,
  buildPreferencesFile,
  buildViewFile,
  mergeViews,
  parseImportFile,
  planViewImport,
  type ImportPayload,
} from '../src/lib/preferencesTransfer';
import { setPreferenceStorage, type PreferenceStorage } from '../src/lib/storage';
import { DEFAULT_DASHBOARD, dashboardStore } from '../src/state/dashboard';
import { DEFAULT_PREFS, prefsStore } from '../src/state/prefs';
import { DEFAULT_TABLE_LAYOUT, tableLayoutStore } from '../src/state/tableLayout';
import { TRANSFER_PARTS, applyImport, exportPreferences } from '../src/state/transfer';
import { EMPTY_VIEW_STATE, viewsStore, type SavedView, type ViewsData } from '../src/state/views';

// Stores load lazily, so an in-memory adapter installed here is used by all of them.
const memory = new Map<string, unknown>();
const memoryStorage: PreferenceStorage = {
  read: (key) => memory.get(key),
  write: (key, value) => void memory.set(key, value),
  remove: (key) => void memory.delete(key),
};
setPreferenceStorage(memoryStorage);

function view(id: string, name: string, patch: Partial<SavedView> = {}): SavedView {
  return { id, name, section: 'active', state: EMPTY_VIEW_STATE(), layout: null, ...patch };
}

function viewsData(saved: SavedView[], defaultViewId: string | null = null): ViewsData {
  return { current: EMPTY_VIEW_STATE(), activeViewId: null, saved, defaultViewId };
}

function parse(value: unknown) {
  return parseImportFile(JSON.stringify(value), TRANSFER_PARTS);
}

function payloadOf(value: unknown): ImportPayload {
  const result = parse(value);
  if (!result.ok) throw new Error(result.error);
  return result.payload;
}

const file = (data: Record<string, unknown>) => ({ format: PREFERENCES_FORMAT, version: 1, exportedAt: '2026-11-19T10:00:00.000Z', data });

describe('buildPreferencesFile', () => {
  it('contains exactly the registered stores and the saved views', () => {
    const backup = buildPreferencesFile(TRANSFER_PARTS, viewsData([view('a', 'A')], 'a'), new Date('2026-11-19T10:00:00Z'));
    expect(backup.format).toBe(PREFERENCES_FORMAT);
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBe('2026-11-19T10:00:00.000Z');
    expect(Object.keys(backup.data).sort()).toEqual(['dashboard:v1', 'history:v1', 'prefs:v1', 'table:v1', VIEWS_KEY].sort());
    // Only saved views and the default: no live screen state.
    expect(backup.data[VIEWS_KEY]).toEqual({ saved: [view('a', 'A')], defaultViewId: 'a' });
  });

  it('exports copies, so changing an exported file leaves the live settings alone', () => {
    const live = view('a', 'A');
    const single = buildViewFile(live);
    single.view.name = 'changed';
    expect(live.name).toBe('A');
    const saved = [view('b', 'B')];
    const backup = buildPreferencesFile([], { saved, defaultViewId: null });
    (backup.data[VIEWS_KEY] as { saved: Array<{ name: string }> }).saved[0].name = 'changed';
    expect(saved[0].name).toBe('B');
  });

  it('builds a single-view file', () => {
    const exported = buildViewFile(view('a', 'A'));
    expect(exported.format).toBe(VIEW_FORMAT);
    expect(exported.view.name).toBe('A');
  });
});

describe('parseImportFile', () => {
  it('rejects files that are not valid', () => {
    expect(parseImportFile('{not json', TRANSFER_PARTS)).toEqual({ ok: false, error: 'Not a valid JSON file.' });
    expect(parse({ format: 'something-else', version: 1, data: {} })).toMatchObject({ ok: false, error: expect.stringContaining('Not an Alert Center') });
    expect(parse([1, 2])).toMatchObject({ ok: false });
    expect(parse({ format: PREFERENCES_FORMAT, data: {} })).toMatchObject({ ok: false, error: 'The file has no version.' });
    expect(parse({ format: PREFERENCES_FORMAT, version: '1', data: {} })).toMatchObject({ ok: false, error: 'The file has no version.' });
    expect(parse({ format: PREFERENCES_FORMAT, version: 2, data: {} })).toMatchObject({ ok: false, error: expect.stringContaining('newer version') });
    expect(parse({ format: PREFERENCES_FORMAT, version: 0, data: {} })).toMatchObject({ ok: false, error: expect.stringContaining('Unsupported') });
    expect(parse({ format: PREFERENCES_FORMAT, version: 1 })).toMatchObject({ ok: false, error: 'The file contains no preferences.' });
    expect(parse(file({}))).toMatchObject({ ok: false, error: 'Nothing to import in this file.' });
  });

  it('rejects oversized files before parsing', () => {
    const big = JSON.stringify(file({ 'prefs:v1': { padding: 'x'.repeat(MAX_IMPORT_BYTES) } }));
    expect(parseImportFile(big, TRANSFER_PARTS)).toMatchObject({ ok: false, error: expect.stringContaining('larger than') });
  });

  it('imports a partial file and ignores unknown or invalid parts', () => {
    const payload = payloadOf(
      file({
        'table:v1': { columnOrder: ['summary', 'nope'], columnSizing: { summary: 999999 } },
        'dashboard:v1': ['not', 'an', 'object'],
        'jira:credentials': { token: 'x' },
      }),
    );
    expect(payload.parts.map((p) => p.key)).toEqual(['table:v1']);
    expect(payload.ignored).toEqual(['Dashboard', 'jira:credentials']);
    expect(payload.views).toEqual([]);
    const table = payload.parts[0]!.value as ReturnType<typeof DEFAULT_TABLE_LAYOUT>;
    // Sanitized by the store's own function: unknown column dropped, absurd width discarded, missing columns appended.
    expect(table.columnOrder[0]).toBe('summary');
    expect(table.columnOrder).not.toContain('nope');
    expect(table.columnOrder.length).toBe(DEFAULT_TABLE_LAYOUT().columnOrder.length);
    expect(table.columnSizing).toEqual({});
  });

  it('sanitizes general preferences, including the customer scope', () => {
    const payload = payloadOf(file({ 'prefs:v1': { theme: 'neon', density: 'spacious', customerScope: ['Contoso', 7, ' contoso ', '', 'Fabrikam'] } }));
    const prefs = payload.parts[0]!.value as ReturnType<typeof DEFAULT_PREFS>;
    expect(prefs.theme).toBe('dark');
    expect(prefs.density).toBe('spacious');
    expect(prefs.customerScope).toEqual(['Contoso', 'Fabrikam']);
  });

  it('validates saved views one by one', () => {
    const payload = payloadOf(
      file({
        [VIEWS_KEY]: {
          saved: [view('a', 'A'), { name: 'no id' }, 'junk', view('a', 'Duplicate id'), view('bad id with spaces', 'Odd id')],
          defaultViewId: 'a',
        },
      }),
    );
    expect(payload.views.map((v) => v.name)).toEqual(['A', 'Duplicate id', 'Odd id']);
    expect(payload.views[0]!.id).toBe('a');
    expect(payload.views[1]!.id).not.toBe('a');
    expect(payload.views[2]!.id).not.toBe('bad id with spaces');
    expect(payload.defaultViewId).toBe('a');
    expect(payload.ignored).toEqual(['2 saved views']);
  });

  it('reads a single-view file', () => {
    const payload = payloadOf(buildViewFile(view('v1', 'Shared view')));
    expect(payload.kind).toBe('view');
    expect(payload.parts).toEqual([]);
    expect(payload.views.map((v) => v.name)).toEqual(['Shared view']);
    expect(parse({ format: VIEW_FORMAT, version: 1, view: { name: 'no id' } })).toMatchObject({ ok: false, error: 'The view in this file is not valid.' });
  });
});

describe('planViewImport', () => {
  it('separates new, conflicting and identical views', () => {
    const existing = [view('a', 'Alpha'), view('b', 'Beta'), view('c', 'Gamma')];
    const plan = planViewImport(existing, [
      view('a', 'Alpha'), // identical
      view('b', 'Beta', { section: 'critical' }), // same id, different content
      view('x', 'gamma', { section: 'resolved' }), // same name, other id
      view('y', 'Delta'), // new
    ]);
    expect(plan.identical.map((v) => v.id)).toEqual(['a']);
    expect(plan.conflicts.map((c) => [c.imported.id, c.existing.id, c.reason])).toEqual([
      ['b', 'b', 'id'],
      ['x', 'c', 'name'],
    ]);
    expect(plan.added.map((v) => v.id)).toEqual(['y']);
  });
});

describe('mergeViews', () => {
  const existing = () => viewsData([view('a', 'Alpha'), view('b', 'Beta')], 'b');
  const imported = [view('a', 'Alpha', { section: 'critical' }), view('z', 'beta', { section: 'resolved' }), view('n', 'New')];
  let counter = 0;
  const makeId = () => `new-${++counter}`;
  beforeEach(() => {
    counter = 0;
  });

  it('keeps both: conflicting views become copies with a new id or a distinguishable name', () => {
    const { data, added, replaced } = mergeViews(existing(), imported, null, 'keepBoth', makeId);
    expect(added).toBe(3);
    expect(replaced).toBe(0);
    expect(data.saved.map((v) => [v.id, v.name])).toEqual([
      ['a', 'Alpha'],
      ['b', 'Beta'],
      ['new-1', 'Alpha (imported)'],
      ['z', 'beta (imported)'],
      ['n', 'New'],
    ]);
    expect(data.defaultViewId).toBe('b');
  });

  it('replace: conflicting views overwrite the existing ones in place and keep their ids', () => {
    const { data, added, replaced } = mergeViews(existing(), imported, null, 'replace', makeId);
    expect(added).toBe(1);
    expect(replaced).toBe(2);
    expect(data.saved.map((v) => [v.id, v.name, v.section])).toEqual([
      ['a', 'Alpha', 'critical'],
      ['b', 'beta', 'resolved'],
      ['n', 'New', 'active'],
    ]);
    expect(data.defaultViewId).toBe('b');
  });

  it('adopts the imported default only when none is set', () => {
    const none = viewsData([view('a', 'Alpha')]);
    expect(mergeViews(none, [view('a', 'Alpha', { section: 'critical' })], 'a', 'keepBoth', makeId).data.defaultViewId).toBe('new-1');
    expect(mergeViews(none, [view('n', 'New')], 'n', 'keepBoth', makeId).data.defaultViewId).toBe('n');
    expect(mergeViews(viewsData([view('a', 'Alpha')], 'a'), [view('n', 'New')], 'n', 'keepBoth', makeId).data.defaultViewId).toBe('a');
  });

  it('skips identical views', () => {
    const { data, added } = mergeViews(existing(), [view('a', 'Alpha')], null, 'keepBoth', makeId);
    expect(added).toBe(0);
    expect(data.saved).toHaveLength(2);
  });
});

describe('export and import round trip', () => {
  beforeEach(() => {
    memory.clear();
    prefsStore.set(DEFAULT_PREFS());
    tableLayoutStore.set(DEFAULT_TABLE_LAYOUT());
    dashboardStore.set(DEFAULT_DASHBOARD());
  });

  it('restores every store from an exported file', () => {
    prefsStore.set((p) => ({ ...p, theme: 'light', customerScope: ['Contoso'] }));
    tableLayoutStore.set((t) => ({ ...t, columnSizing: { summary: 640 } }));
    dashboardStore.set((d) => ({ ...d, collapsed: true }));
    const savedBefore = viewsStore.get().saved;
    const text = JSON.stringify(exportPreferences());
    expect(text).not.toMatch(/apiToken|JIRA_|"alerts"/);

    prefsStore.set(DEFAULT_PREFS());
    tableLayoutStore.set(DEFAULT_TABLE_LAYOUT());
    dashboardStore.set(DEFAULT_DASHBOARD());

    const result = parseImportFile(text, TRANSFER_PARTS);
    if (!result.ok) throw new Error(result.error);
    const outcome = applyImport(result.payload, { parts: result.payload.parts.map((p) => p.key), views: true, choice: 'keepBoth' });

    expect(prefsStore.get().theme).toBe('light');
    expect(prefsStore.get().customerScope).toEqual(['Contoso']);
    expect(tableLayoutStore.get().columnSizing).toEqual({ summary: 640 });
    expect(dashboardStore.get().collapsed).toBe(true);
    expect(outcome.replacedParts).toHaveLength(TRANSFER_PARTS.length);
    // The same views were already there: nothing added.
    expect(outcome.viewsAdded).toBe(0);
    expect(viewsStore.get().saved).toEqual(savedBefore);
  });

  it('applies only the selected parts', () => {
    const payload = payloadOf(file({ 'prefs:v1': { theme: 'light' }, 'dashboard:v1': { collapsed: true, widgets: [] } }));
    applyImport(payload, { parts: ['dashboard:v1'], views: false, choice: 'keepBoth' });
    expect(prefsStore.get().theme).toBe('dark');
    expect(dashboardStore.get().collapsed).toBe(true);
  });
});

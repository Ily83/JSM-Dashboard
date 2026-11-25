// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_IDS } from '../../shared/actions';
import type { StatusResponse } from '../../shared/types';
import { SettingsView } from '../../src/components/SettingsView';
import { DEFAULT_DASHBOARD, dashboardStore } from '../../src/state/dashboard';
import { DEFAULT_PREFS, prefsStore } from '../../src/state/prefs';
import { DEFAULT_TABLE_LAYOUT, tableLayoutStore } from '../../src/state/tableLayout';
import { exportPreferences } from '../../src/state/transfer';
import { viewsStore } from '../../src/state/views';
import { makeStatus, renderWithClient } from './helpers';

// Downloads: jsdom has no object URLs and does not follow links.
const downloads: string[] = [];
Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:test' });
Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });

function renderSettings(status: StatusResponse | undefined = makeStatus(), props: { assignees?: string[]; customers?: string[] } = {}) {
  const user = userEvent.setup();
  renderWithClient(<SettingsView status={status} assignees={props.assignees ?? ['Priya Nair']} customers={props.customers ?? ['Globex', 'Acme']} />);
  return { user };
}

const card = (title: string) => screen.getByRole('region', { name: title });
const saveButton = () => screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement;
const checkbox = (scope: HTMLElement, name: string | RegExp) => within(scope).getByRole('checkbox', { name }) as HTMLInputElement;

function jsonFile(value: unknown, name = 'backup.json'): File {
  return new File([JSON.stringify(value)], name, { type: 'application/json' });
}

beforeEach(() => {
  prefsStore.set(DEFAULT_PREFS());
  tableLayoutStore.set(DEFAULT_TABLE_LAYOUT());
  dashboardStore.set(DEFAULT_DASHBOARD());
  viewsStore.reset();
  window.location.hash = '';
  downloads.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SettingsView', () => {
  it('saves changed settings in the browser', async () => {
    const { user } = renderSettings();
    expect(saveButton().disabled).toBe(true);

    await user.click(within(screen.getByRole('radiogroup', { name: 'Theme' })).getByRole('radio', { name: 'Light' }));
    expect(prefsStore.get().theme).toBe('light');
    expect(saveButton().disabled).toBe(false);

    await user.click(saveButton());
    expect(screen.getByText('Settings saved in this browser.')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem('jsm-alert-center:prefs:v1') ?? '{}').theme).toBe('light');
  });

  it('says when the settings cannot be saved', async () => {
    const { user } = renderSettings();
    await user.click(within(screen.getByRole('radiogroup', { name: 'Density' })).getByRole('radio', { name: 'Spacious' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await user.click(saveButton());
    expect(screen.getByText('Could not save settings in this browser.')).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
  });

  it('switches the display options', async () => {
    const { user } = renderSettings();
    for (const name of ['Highlight critical alerts', 'Tags next to customers', 'Occurrence counter', 'Quick-filter bar']) {
      const toggle = screen.getByRole('switch', { name });
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      await user.click(toggle);
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    }
    expect(prefsStore.get()).toMatchObject({ highlightCritical: false, showTags: false, showOccurrences: false, showQuickFilters: false });

    await user.click(screen.getByRole('switch', { name: 'Dashboard' }));
    expect(dashboardStore.get().collapsed).toBe(true);
    await user.click(within(screen.getByRole('radiogroup', { name: 'Timestamps' })).getByRole('radio', { name: 'Date and time' }));
    expect(prefsStore.get().timeFormat).toBe('absolute');
  });

  it('sets the auto-refresh interval, or goes back to the server default', async () => {
    prefsStore.set({ ...DEFAULT_PREFS(), refreshSeconds: 45 });
    const { user } = renderSettings();
    expect(screen.getByText('Server default 60s · Jira is queried at most every 30s')).toBeTruthy();
    const interval = screen.getByRole('combobox', { name: 'Auto-refresh interval' }) as HTMLSelectElement;
    expect([...interval.options].map((o) => o.textContent)).toEqual(['Off', '15 seconds', '30 seconds', '45 seconds', '1 min', '2 min', '5 min']);

    await user.selectOptions(interval, '120');
    expect(prefsStore.get().refreshSeconds).toBe(120);
    await user.click(screen.getByRole('button', { name: 'Default' }));
    expect(prefsStore.get().refreshSeconds).toBeNull();
    expect(interval.value).toBe('60');
  });

  it('keeps the profile name and customers', async () => {
    const { user } = renderSettings();
    const name = screen.getByRole('combobox', { name: 'Your name' });
    await user.type(name, 'Priya');
    expect(prefsStore.get().profile.name).toBe('Priya');
    await user.clear(name);
    expect(prefsStore.get().profile.name).toBeNull();

    const profile = card('Profile');
    expect(within(profile).getAllByRole('checkbox').map((box) => box.textContent)).toEqual(['Acme', 'Globex']);
    const acme = within(profile).getByRole('checkbox', { name: 'Acme' });
    await user.click(acme);
    expect(acme.getAttribute('aria-checked')).toBe('true');
    expect(prefsStore.get().profile.customers).toEqual(['Acme']);
    await user.click(acme);
    expect(prefsStore.get().profile.customers).toEqual([]);
  });

  it('says when the data has no customers', () => {
    renderSettings(makeStatus(), { customers: [] });
    expect(screen.getByText('No customers in the current data')).toBeTruthy();
  });

  it('manages saved views', async () => {
    const { user } = renderSettings();
    const views = card('Saved views and default filters');
    const [first, second] = viewsStore.get().saved;

    await user.selectOptions(within(views).getByRole('combobox', { name: 'Default view' }), second.id);
    expect(viewsStore.get().defaultViewId).toBe(second.id);
    await user.click(within(views).getByRole('button', { name: `Make ${first.name} the default view` }));
    expect(viewsStore.get().defaultViewId).toBe(first.id);
    await user.click(within(views).getByRole('button', { name: 'Default view' }));
    expect(viewsStore.get().defaultViewId).toBeNull();

    const rename = within(views).getByRole('textbox', { name: `Name of view ${first.name}` });
    await user.clear(rename);
    await user.type(rename, 'Needs attention{Enter}');
    expect(viewsStore.get().saved[0].name).toBe('Needs attention');

    // An empty name is refused.
    const renamed = within(views).getByRole('textbox', { name: 'Name of view Needs attention' }) as HTMLInputElement;
    await user.clear(renamed);
    await user.tab();
    expect(renamed.value).toBe('Needs attention');

    await user.click(within(views).getByRole('button', { name: 'Move Needs attention down' }));
    expect(viewsStore.get().saved[1].name).toBe('Needs attention');
    await user.click(within(views).getByRole('button', { name: 'Move Needs attention up' }));
    expect(viewsStore.get().saved[0].name).toBe('Needs attention');

    await user.click(within(views).getByRole('button', { name: 'Duplicate Needs attention' }));
    expect(viewsStore.get().saved[1].name).toBe('Needs attention copy');
    await user.click(within(views).getByRole('button', { name: 'Delete Needs attention copy' }));
    expect(viewsStore.get().saved.map((v) => v.name)).not.toContain('Needs attention copy');

    const layout = within(views).getAllByRole('checkbox', { name: 'Layout' })[0] as HTMLInputElement;
    await user.click(layout);
    expect(viewsStore.get().saved[0].layout).not.toBeNull();

    await user.click(within(views).getByRole('button', { name: 'Export Needs attention' }));
    expect(downloads).toEqual(['alert-center-view-needs-attention.json']);

    await user.click(within(views).getByRole('button', { name: 'Open Needs attention' }));
    expect(viewsStore.get().activeViewId).toBe(first.id);
    expect(window.location.hash).toBe(`#/${first.section}`);
  });

  it('chooses the filters shown in the filter bar', async () => {
    const { user } = renderSettings();
    const filters = card('Filter bar');
    const boxes = within(filters).getAllByRole('checkbox') as HTMLInputElement[];
    const unpinned = boxes.find((box) => !box.checked)!;
    const before = prefsStore.get().pinnedFilters.length;
    await user.click(unpinned);
    expect(prefsStore.get().pinnedFilters).toHaveLength(before + 1);
    await user.click(unpinned);
    expect(prefsStore.get().pinnedFilters).toHaveLength(before);
  });

  it('shows, sizes, orders and resets the table columns', async () => {
    const { user } = renderSettings();
    const columns = card('Table columns');
    expect(checkbox(columns, 'Summary').disabled).toBe(true);
    await user.click(checkbox(columns, 'Priority'));
    expect(tableLayoutStore.get().columnVisibility.priority).toBe(false);

    const width = within(columns).getByRole('spinbutton', { name: 'Width of Summary in pixels' });
    fireEvent.change(width, { target: { value: '500' } });
    expect(tableLayoutStore.get().columnSizing.summary).toBe(500);
    // Below the column's minimum: ignored.
    fireEvent.change(width, { target: { value: '20' } });
    expect(tableLayoutStore.get().columnSizing.summary).toBe(500);

    expect((within(columns).getByRole('button', { name: 'Move Priority up' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(columns).getByRole('button', { name: 'Move Priority down' }));
    expect(tableLayoutStore.get().columnOrder.slice(0, 2)).toEqual(['summary', 'priority']);

    await user.click(within(columns).getByRole('button', { name: 'Reset' }));
    expect(tableLayoutStore.get()).toEqual(DEFAULT_TABLE_LAYOUT());
  });

  it('shows, sizes, orders and resets the dashboard widgets', async () => {
    const { user } = renderSettings();
    const widgets = card('Dashboard widgets');
    await user.click(checkbox(widgets, 'Alerts by customer'));
    expect(dashboardStore.get().widgets.find((w) => w.id === 'topCustomers')?.visible).toBe(true);

    await user.selectOptions(within(widgets).getByRole('combobox', { name: 'Width of Total active alerts' }), '4');
    await user.selectOptions(within(widgets).getByRole('combobox', { name: 'Height of Total active alerts' }), '3');
    expect(dashboardStore.get().widgets.find((w) => w.id === 'kpiActive')).toMatchObject({ w: 4, h: 3 });

    await user.click(within(widgets).getByRole('button', { name: 'Move Total active alerts down' }));
    expect(dashboardStore.get().widgets[1].id).toBe('kpiActive');

    await user.click(within(widgets).getByRole('button', { name: 'Reset' }));
    expect(dashboardStore.get()).toEqual(DEFAULT_DASHBOARD());
  });

  it('describes a demo connection', () => {
    renderSettings(makeStatus({}, [...ACTION_IDS]));
    const connection = card('Connection');
    expect(within(connection).getByText('Demo (sample data)')).toBeTruthy();
    expect(within(connection).getByText('All · sample data only')).toBeTruthy();
    expect(within(connection).queryByText('Limits')).toBeNull();
    expect(within(connection).getByText(/tags “customer:…” · properties Customer/)).toBeTruthy();
  });

  it('describes a live connection with its limits and warnings', () => {
    const status = makeStatus(
      {
        mode: 'live',
        oauth: true,
        site: 'example.atlassian.net',
        warnings: ['JIRA_WRITE_ACTIONS lists an unknown action'],
        meta: { ...makeStatus().meta, skipped: 3 },
        // Under 1,000, so the text does not depend on the locale's digit grouping.
        limits: { maxOpenAlerts: 500, maxClosedAlerts: 200, closedLookbackHours: 72 },
        extraction: {
          customerTagPrefixes: [],
          customerCompanyTagPrefixes: ['company:'],
          customerPropertyKeys: [],
          serviceTagPrefixes: [],
          servicePropertyKeys: [],
          serviceFallbackToEntity: true,
          customerMapRules: 12,
        },
      },
      ['acknowledge', 'close'],
    );
    renderSettings(status);
    const connection = card('Connection');
    expect(within(connection).getByText('Live · write actions on')).toBeTruthy();
    expect(within(connection).getByText('Acknowledge, Close')).toBeTruthy();
    expect(within(connection).getByText('example.atlassian.net')).toBeTruthy();
    expect(within(connection).getByText('500 open · 200 closed from the last 72 h')).toBeTruthy();
    expect(within(connection).getByText(/3 skipped \(invalid\)/)).toBeTruthy();
    expect(within(connection).getByText(/company tags \(1 prefixes\) · mapping file \(12 rules\)/)).toBeTruthy();
    expect(within(connection).getByText(/· entity/)).toBeTruthy();
    expect(within(connection).getByText('JIRA_WRITE_ACTIONS lists an unknown action')).toBeTruthy();
    expect(within(connection).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('describes a read-only live connection, or none', () => {
    const { unmount } = renderWithClient(<SettingsView status={makeStatus({ mode: 'live' })} assignees={[]} customers={[]} />);
    expect(within(card('Connection')).getByText('Live · read-only')).toBeTruthy();
    expect(within(card('Connection')).getByText('Off')).toBeTruthy();
    unmount();
    renderWithClient(<SettingsView status={undefined} assignees={[]} customers={[]} />);
    expect(screen.getByText('Backend not reachable')).toBeTruthy();
  });

  it('switches the P1 alarm sound and tests it', async () => {
    const { user } = renderSettings();
    await user.click(screen.getByRole('switch', { name: 'Sound for new P1 alerts' }));
    expect(prefsStore.get().p1Sound).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Play test' }));
    // jsdom can play no sound and has no notifications.
    expect(await screen.findByText('Sound unavailable · no notification')).toBeTruthy();
  });

  it('turns desktop notifications on once the browser allows them', async () => {
    class FakeNotification {
      static permission: NotificationPermission = 'default';
      static requestPermission = vi.fn(async () => {
        FakeNotification.permission = 'granted';
        return 'granted' as const;
      });
      onclick: (() => void) | null = null;
      close(): void {}
    }
    vi.stubGlobal('Notification', FakeNotification);
    const { user } = renderSettings();
    const desktop = screen.getByRole('switch', { name: 'Desktop notification for new P1 alerts' });
    await user.click(desktop);
    await waitFor(() => expect(desktop.getAttribute('aria-checked')).toBe('true'));
    expect(prefsStore.get().p1Desktop).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Play test' }));
    expect(await screen.findByText('Sound unavailable · notification shown')).toBeTruthy();

    await user.click(desktop);
    expect(prefsStore.get().p1Desktop).toBe(false);
  });

  it('says when desktop notifications are not supported', async () => {
    const { user } = renderSettings();
    expect(screen.getByText('Not supported by this browser')).toBeTruthy();
    await user.click(screen.getByRole('switch', { name: 'Desktop notification for new P1 alerts' }));
    await waitFor(() => expect(prefsStore.get().p1Desktop).toBe(false));
  });

  it('exports the preferences as a file', async () => {
    const { user } = renderSettings();
    await user.click(within(card('Backup')).getByRole('button', { name: 'Export' }));
    expect(downloads).toEqual([expect.stringMatching(/^alert-center-preferences-\d{4}-\d{2}-\d{2}\.json$/)]);
  });

  it('previews an imported file and applies the chosen parts', async () => {
    prefsStore.set({ ...DEFAULT_PREFS(), theme: 'light' });
    const file = exportPreferences();
    prefsStore.set(DEFAULT_PREFS());
    const { user } = renderSettings();

    await user.upload(screen.getByLabelText('Import preferences file'), jsonFile(file, 'mine.json'));
    const preview = await screen.findByRole('group', { name: 'Import preview' });
    expect(within(preview).getByText('mine.json')).toBeTruthy();
    expect(within(preview).getByText(/4 unchanged/)).toBeTruthy();

    await user.click(checkbox(preview, /^Table columns/));
    await user.click(within(preview).getByRole('button', { name: 'Import' }));
    expect(within(card('Backup')).getByText(/^Imported: General and profile/)).toBeTruthy();
    expect(within(card('Backup')).getByText(/Imported:/).textContent).not.toContain('Table columns');
    expect(prefsStore.get().theme).toBe('light');
  });

  it('lets conflicting views be kept as copies or replaced', async () => {
    // A copy: the export holds the stores' own objects.
    const file = structuredClone(exportPreferences());
    const saved = file.data['views:v1'] as { saved: Array<{ name: string; state: { search: string } }> };
    saved.saved[0].state.search = 'disk';
    const { user } = renderSettings();

    await user.upload(screen.getByLabelText('Import preferences file'), jsonFile(file));
    const preview = await screen.findByRole('group', { name: 'Import preview' });
    expect(within(preview).getByText(/1 conflict/)).toBeTruthy();
    expect(within(within(preview).getByRole('list', { name: 'Conflicting views' })).getByText(saved.saved[0].name)).toBeTruthy();
    await user.click(within(preview).getByRole('radio', { name: 'Replace' }));

    // Only the views, none of the other parts.
    for (const part of [/^General and profile/, /^Table columns/, /^Dashboard/, /^History investigations/]) await user.click(checkbox(preview, part));
    await user.click(within(preview).getByRole('button', { name: 'Import' }));
    expect(screen.getByText('Imported: 1 view replaced')).toBeTruthy();
    expect(viewsStore.get().saved[0].state.search).toBe('disk');
  });

  it('cannot import when nothing is selected, and can be cancelled', async () => {
    const { user } = renderSettings();
    await user.upload(screen.getByLabelText('Import preferences file'), jsonFile(exportPreferences()));
    const preview = await screen.findByRole('group', { name: 'Import preview' });
    for (const box of within(preview).getAllByRole('checkbox') as HTMLInputElement[]) {
      if (box.checked) await user.click(box);
    }
    expect((within(preview).getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(preview).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Import preview' })).toBeNull();
  });

  it('rejects a file that is not a backup', async () => {
    const { user } = renderSettings();
    await user.upload(screen.getByLabelText('Import preferences file'), new File(['not json'], 'notes.json', { type: 'application/json' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Not a valid JSON file.');

    await user.upload(screen.getByLabelText('Import preferences file'), new File(['x'.repeat(600 * 1024)], 'huge.json', { type: 'application/json' }));
    expect((await screen.findByRole('alert')).textContent).toBe('File is larger than 512 KB.');
  });

  it('asks before resetting everything', async () => {
    const { user } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Reset…' }));
    expect(screen.getByRole('button', { name: 'Reset everything' })).toBeTruthy();
    await user.click(within(card('Reset')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Reset everything' })).toBeNull();
  });
});

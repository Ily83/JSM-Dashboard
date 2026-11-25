// @vitest-environment jsdom
import { useState } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { focusManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryAnalysisStatus, HistoryMonth } from '../../shared/historyAnalysis';
import type { Alert } from '../../shared/types';
import { HistoryAnalysis } from '../../src/components/HistoryAnalysis';
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisSettings } from '../../src/lib/historyBreakdowns';
import { makeAlert } from '../fixtures';
import { jsonResponse, mockApi, never, renderWithClient, type ApiCall, type ApiRoute } from './helpers';

const FROM = '2026-08-01';
const TO = '2026-10-31';
const MIN = 60_000;
const at = (date: string, hour = 9) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);

const DISK = { alias: 'disk-db1', customers: ['Acme'], service: 'Storage', rawSource: 'azure', responders: [{ id: 'team-a', type: 'team' as const, name: 'Storage team' }] };
const AUG: Alert[] = [
  makeAlert({ id: 'h1', ...DISK, priority: 'P1', status: 'closed', summary: 'Disk 91% on db-1', tags: ['disk'], createdAt: at('2026-08-03'), ackTime: at('2026-08-03') + 5 * MIN, closeTime: at('2026-08-03') + 60 * MIN }),
  makeAlert({ id: 'h2', ...DISK, priority: 'P1', status: 'closed', summary: 'Disk 95% on db-1', tags: ['disk'], createdAt: at('2026-08-04'), ackTime: at('2026-08-04') + 15 * MIN, closeTime: at('2026-08-04') + 90 * MIN }),
  makeAlert({ id: 'h3', priority: 'P3', status: 'open', summary: 'Login failures', tags: ['auth'], rawSource: 'nagios', createdAt: at('2026-08-20') }),
];
const SEP: Alert[] = [makeAlert({ id: 'h4', priority: 'P2', status: 'acked', summary: 'CPU high on web-2', customers: ['Globex'], rawSource: 'nagios', createdAt: at('2026-09-10'), ackTime: at('2026-09-10') + 30 * MIN })];
const OCT: Alert[] = [makeAlert({ id: 'h5', ...DISK, priority: 'P1', status: 'open', summary: 'Disk 99% on db-1', customers: ['Acme', 'Globex'], tags: ['disk'], createdAt: at('2026-10-02') })];
const MONTHS: HistoryMonth[] = [
  { key: '2026-08', from: '2026-08-01', to: '2026-08-31', alerts: AUG, partial: false },
  { key: '2026-09', from: '2026-09-01', to: '2026-09-30', alerts: SEP, partial: false },
  { key: '2026-10', from: '2026-10-01', to: '2026-10-31', alerts: OCT, partial: true },
];

function job(overrides: Partial<HistoryAnalysisStatus> = {}): HistoryAnalysisStatus {
  return { id: 'job-1', from: FROM, to: TO, state: 'completed', pages: 4, recordsRead: 250, monthsDone: 3, monthsTotal: 3, partial: true, message: null, ...overrides };
}

/** Result pages: the first month comes in two pages, to exercise the client's paging. */
function results(months: HistoryMonth[] = MONTHS): ApiRoute {
  return ({ search }: ApiCall) => {
    const index = Number(search.get('month'));
    const offset = Number(search.get('offset'));
    const month = months[index];
    const firstOfTwo = index === 0 && month.alerts.length > 1 && offset === 0;
    const alerts = index === 0 && month.alerts.length > 1 ? (firstOfTwo ? month.alerts.slice(0, 1) : month.alerts.slice(1)) : month.alerts;
    return { month: { ...month, alerts }, hasNextPage: firstOfTwo, hasNextMonth: index < months.length - 1 };
  };
}

function completedRoutes(months: HistoryMonth[] = MONTHS): Record<string, ApiRoute> {
  return {
    'POST /api/history-analysis': job(),
    'GET /api/history-analysis': job(),
    'GET /api/history-analysis/results': results(months),
  };
}

const onSettingsChange = vi.fn();
const onOpenRange = vi.fn();

function Harness({ initial }: Readonly<{ initial: Partial<AnalysisSettings> }>) {
  const [settings, setSettings] = useState<AnalysisSettings>({ ...DEFAULT_ANALYSIS_SETTINGS(), ...initial });
  return (
    <HistoryAnalysis
      from={FROM}
      to={TO}
      settings={settings}
      onSettingsChange={(patch) => {
        onSettingsChange(patch);
        setSettings((current) => ({ ...current, ...patch }));
      }}
      onOpenRange={onOpenRange}
    />
  );
}

function renderAnalysis(initial: Partial<AnalysisSettings> = {}) {
  const user = userEvent.setup();
  renderWithClient(<Harness initial={initial} />);
  return { user };
}

async function renderResults(initial: Partial<AnalysisSettings> = {}) {
  const view = renderAnalysis(initial);
  await screen.findByRole('region', { name: /./ });
  return view;
}

const breakdown = (name: string) => within(screen.getByRole('group', { name: 'Breakdown' })).getByRole('button', { name });
const drilldownTitle = () => screen.getByRole('heading', { level: 3 });
/** Text with the thin spaces of date ranges as plain spaces. */
const titleText = () => (drilldownTitle().textContent ?? '').replace(/\s+/g, ' ');

afterEach(() => {
  // Back to following the document's visibility.
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
  onSettingsChange.mockReset();
  onOpenRange.mockReset();
});

describe('HistoryAnalysis: the job', () => {
  it('says it is starting while the server answers', () => {
    mockApi({ 'POST /api/history-analysis': never });
    renderAnalysis();
    expect(screen.getByText('Starting analysis…')).toBeTruthy();
  });

  it('shows the progress of a running job and cancels it', async () => {
    let current = job({ state: 'running', monthsDone: 1, pages: 4, recordsRead: 250, message: 'Jira is slow to answer' });
    const api = mockApi({
      'POST /api/history-analysis': () => current,
      'GET /api/history-analysis': () => current,
      'POST /api/history-analysis/cancel': () => {
        current = { ...current, state: 'cancelled' };
        return current;
      },
    });
    const { user } = renderAnalysis();
    const progress = await screen.findByRole('progressbar', { name: 'Months scanned' });
    expect(progress.getAttribute('aria-valuenow')).toBe('1');
    expect(progress.getAttribute('aria-valuetext')).toBe('1 of 3 months');
    expect(screen.getByText('1/3 months · 4 pages · 250 records')).toBeTruthy();
    expect(screen.getByText('Jira is slow to answer')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Analysis cancelled.')).toBeTruthy();
    expect(api.calls.find((call) => call.path === '/api/history-analysis/cancel')?.body).toEqual({ id: 'job-1' });

    await user.click(screen.getByRole('button', { name: 'Analyze again' }));
    await waitFor(() => expect(api.calls.filter((call) => call.method === 'POST' && call.path === '/api/history-analysis')).toHaveLength(2));
  });

  it('shows a spinner before the months are known, and a failed cancel', async () => {
    const running = job({ state: 'running', monthsDone: 0, monthsTotal: 0 });
    mockApi({
      'POST /api/history-analysis': running,
      'GET /api/history-analysis': running,
      'POST /api/history-analysis/cancel': () => jsonResponse({ error: 'Could not reach the server.' }, 503),
    });
    const { user } = renderAnalysis();
    expect(await screen.findByText('4 pages · 250 records')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server.');
  });

  it('reports a failed job', async () => {
    const failed = job({ state: 'failed', message: 'Jira refused the search.' });
    mockApi({ 'POST /api/history-analysis': failed, 'GET /api/history-analysis': failed });
    renderAnalysis();
    expect((await screen.findByRole('alert')).textContent).toBe('Jira refused the search.');
    expect(screen.getByRole('button', { name: 'Analyze again' })).toBeTruthy();
  });

  it('explains that another range is running and offers to open or cancel it', async () => {
    const other = job({ id: 'job-2', from: '2026-01-01', to: '2026-01-31', state: 'running' });
    const api = mockApi({
      'POST /api/history-analysis': () => jsonResponse({ error: 'Another analysis is running.' }, 409),
      'GET /api/history-analysis': other,
      'POST /api/history-analysis/cancel': { ...other, state: 'cancelled' },
    });
    const { user } = renderAnalysis();
    expect((await screen.findByRole('alert')).textContent).toBe('Another analysis is running.');
    expect(screen.getByText('Running: Jan 1 – 31, 2026 · 4 pages · 250 records')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Open it' }));
    expect(onOpenRange).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31' });
    await user.click(screen.getByRole('button', { name: 'Cancel it' }));
    await waitFor(() => expect(api.calls.some((call) => call.path === '/api/history-analysis/cancel')).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.calls.filter((call) => call.method === 'POST' && call.path === '/api/history-analysis').length).toBeGreaterThan(1));
  });

  it('says when another analysis replaced this one', async () => {
    mockApi({
      'POST /api/history-analysis': job({ state: 'running' }),
      'GET /api/history-analysis': job({ id: 'job-2', from: '2026-02-01', to: '2026-02-28' }),
    });
    const { user } = renderAnalysis();
    expect(await screen.findByText('Another analysis replaced this one: Feb 1 – 28, 2026.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    expect(onOpenRange).toHaveBeenCalledWith({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('says when the server lost the analysis', async () => {
    mockApi({ 'POST /api/history-analysis': job({ state: 'running' }), 'GET /api/history-analysis': null });
    renderAnalysis();
    expect(await screen.findByText('The server restarted, and this analysis was lost.')).toBeTruthy();
  });

  it('offers a retry when the status cannot be read', async () => {
    let fail = true;
    // Started as running, so no results are shown until the status says the job completed.
    const api = mockApi({
      'POST /api/history-analysis': job({ state: 'running' }),
      'GET /api/history-analysis': () => (fail ? jsonResponse({ error: 'Status unavailable.' }, 500) : job()),
      'GET /api/history-analysis/results': results(),
    });
    const { user } = renderAnalysis();
    expect((await screen.findByRole('alert')).textContent).toBe('Status unavailable.');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: /^Alerts created per month/ })).toBeTruthy();
    expect(api.calls.some((call) => call.path === '/api/history-analysis/results')).toBe(true);
  });

  it('offers a retry when the results cannot be loaded', async () => {
    mockApi({ ...completedRoutes(), 'GET /api/history-analysis/results': () => jsonResponse({ error: 'Results expired.' }, 410) });
    renderAnalysis();
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the results. Results expired.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('points to a newer analysis once the results are shown', async () => {
    let current = job();
    mockApi({ ...completedRoutes(), 'GET /api/history-analysis': () => current });
    const { user } = await renderResults();
    current = job({ id: 'job-2', from: '2026-03-01', to: '2026-03-31', state: 'running' });
    // Coming back to the tab reads the status again.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByText('Another analysis is now current: Mar 1 – 31, 2026, running.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    expect(onOpenRange).toHaveBeenCalledWith({ from: '2026-03-01', to: '2026-03-31' });
  });
});

describe('HistoryAnalysis: the results', () => {
  it('shows alerts per month and the alerts of a picked month', async () => {
    mockApi(completedRoutes());
    const { user } = await renderResults();
    expect(screen.getByRole('heading', { name: /^Alerts created per month/ })).toBeTruthy();
    expect(screen.getByText('Partial')).toBeTruthy();
    expect(screen.getByText(/Aug 1 – Oct 31, 2026 \(inclusive, UTC\) · At least 5 matching alerts/)).toBeTruthy();
    expect(screen.getByText('Select a month to inspect its alerts.')).toBeTruthy();

    const histogram = screen.getByRole('list', { name: 'Monthly alert histogram' });
    expect(within(histogram).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'August 2026, 3 alerts',
      'September 2026, 1 alerts',
      'October 2026, at least 1 alerts',
    ]);
    await user.click(within(histogram).getByRole('button', { name: 'August 2026, 3 alerts' }));
    expect(titleText()).toContain('Aug 1 – 31, 2026 (UTC)');
    expect(screen.getByText('Login failures')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('pages through a large selection', async () => {
    const many = Array.from({ length: 120 }, (_, i) => makeAlert({ id: `m${i}`, summary: `Alert ${i}`, createdAt: at('2026-08-05') + i * MIN }));
    mockApi(completedRoutes([{ key: '2026-08', from: '2026-08-01', to: '2026-08-31', alerts: many, partial: false }]));
    const { user } = await renderResults();
    await user.click(screen.getByRole('button', { name: 'August 2026, 120 alerts' }));
    expect(screen.getAllByRole('row')).toHaveLength(101);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getAllByRole('row')).toHaveLength(21);
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getAllByRole('row')).toHaveLength(101);
  });

  it('filters by customer and tag, and names the filters on the drilldown', async () => {
    mockApi(completedRoutes());
    const { user } = await renderResults();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Customer' }), 'Acme');
    expect(onSettingsChange).toHaveBeenCalledWith({ customer: 'Acme' });
    expect(screen.getByText(/At least 3 matching alerts/)).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tag' }), 'disk');
    await user.click(screen.getByRole('button', { name: 'August 2026, 2 alerts' }));
    expect(within(drilldownTitle()).getByText('Customer: Acme')).toBeTruthy();
    expect(within(drilldownTitle()).getByText('Tag: disk')).toBeTruthy();
  });

  it('narrows with the extra filters', async () => {
    mockApi(completedRoutes());
    const { user } = await renderResults();
    await user.click(screen.getByText('More filters'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Source' }), 'nagios');
    expect(screen.getByText(/At least 2 matching alerts/)).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Message excludes' }), 'CPU');
    expect(screen.getByText(/At least 1 matching alerts/)).toBeTruthy();
  });

  it('gives an overview by current status and priority', async () => {
    mockApi(completedRoutes());
    const { user } = await renderResults();
    await user.click(breakdown('Overview'));
    expect(onSettingsChange).toHaveBeenCalledWith({ breakdown: 'overview' });
    expect(screen.getByRole('heading', { name: /^Historical overview/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Closed: 2' }));
    expect(titleText()).toContain('Closed');
    expect(screen.getByText('Disk 95% on db-1')).toBeTruthy();
  });

  it('counts alerts per day', async () => {
    mockApi(completedRoutes());
    const { user } = await renderResults({ breakdown: 'daily' });
    expect(screen.getByRole('heading', { name: /^Daily trends/ })).toBeTruthy();
    const aug3 = screen.getByRole('rowheader', { name: 'Aug 3, 2026' }).closest('tr')!;
    await user.click(within(aug3).getAllByRole('button')[0]);
    expect(titleText()).toContain('Aug 3, 2026 (UTC)');
    expect(screen.getByText('Disk 91% on db-1')).toBeTruthy();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Group created by' }), 'status');
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: 'Acknowledged' })).toBeTruthy();
  });

  it('ranks alerts by source, team or tag', async () => {
    mockApi(completedRoutes());
    const { user } = await renderResults({ breakdown: 'rankings' });
    const bySource = screen.getByRole('list', { name: 'Alerts per source' });
    await user.click(within(bySource).getByRole('button', { name: 'azure, 3 alerts, 3 P1' }));
    expect(titleText()).toContain('azure');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rank by' }), 'team');
    expect(within(screen.getByRole('list', { name: 'Alerts per team' })).getByRole('button', { name: 'Storage team, 3 alerts, 3 P1' })).toBeTruthy();
  });

  it('lists recurring alert groups', async () => {
    mockApi(completedRoutes());
    const { user } = await renderResults({ breakdown: 'recurring' });
    expect(screen.getByRole('heading', { name: /^Recurring alerts/ })).toBeTruthy();
    const group = screen.getByRole('button', { name: 'Disk 99% on db-1' });
    const row = group.closest('tr')!;
    expect(within(row).getAllByRole('cell')[1].textContent).toBe('3');
    await user.click(group);
    expect(group.getAttribute('aria-pressed')).toBe('true');
    expect(within(drilldownTitle()).getByText('3')).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'P1 only' }));
    expect(onSettingsChange).toHaveBeenCalledWith({ p1Only: true });
    expect(screen.queryByRole('button', { name: 'Login failures' })).toBeNull();
  });

  it('ranks P1 hotspots by customer, service or alert group', async () => {
    mockApi(completedRoutes());
    const { user } = await renderResults({ breakdown: 'hotspots' });
    const list = screen.getByRole('list', { name: 'P1 alerts per customer' });
    await user.click(within(list).getByRole('button', { name: 'Acme, 3 P1 of 3 alerts' }));
    expect(titleText()).toContain('Acme · P1');

    await user.selectOptions(screen.getByRole('combobox', { name: 'By' }), 'service');
    expect(within(screen.getByRole('list', { name: 'P1 alerts per service' })).getByRole('button', { name: 'Storage, 3 P1 of 3 alerts' })).toBeTruthy();
  });

  it('ranks customers, and counts alerts without one', async () => {
    mockApi(completedRoutes());
    const { user } = await renderResults({ breakdown: 'customers' });
    expect(screen.getByText('1 without customer')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Alerts per customer' });
    await user.click(within(list).getByRole('button', { name: 'Globex, 2 alerts, 1 P1' }));
    expect(titleText()).toContain('Globex');

    await user.click(screen.getByRole('checkbox', { name: 'P1 only' }));
    expect(within(screen.getByRole('list', { name: 'Alerts per customer' })).getByRole('button', { name: 'Acme, 3 P1 of 3 alerts' })).toBeTruthy();
  });

  it('shows the time to acknowledge and close', async () => {
    mockApi(completedRoutes());
    const { user } = await renderResults({ breakdown: 'response' });
    const table = screen.getByRole('table');
    const all = within(table).getByRole('rowheader', { name: 'All' }).closest('tr')!;
    expect(within(all).getAllByRole('cell')[0].textContent).toBe('5');

    await user.click(within(table).getByRole('button', { name: 'P1' }));
    expect(titleText()).toContain('Priority: P1');

    await user.selectOptions(screen.getByRole('combobox', { name: 'By' }), 'customer');
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: 'Customer' })).toBeTruthy();
  });

  it('says when a breakdown has nothing to rank', async () => {
    mockApi(completedRoutes([{ key: '2026-08', from: '2026-08-01', to: '2026-08-31', alerts: [AUG[2]], partial: false }]));
    const { user } = await renderResults({ breakdown: 'hotspots' });
    expect(screen.getByText('No matching alerts.')).toBeTruthy();
    await user.click(breakdown('Recurring'));
    expect(screen.queryByText('No matching alerts.')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'P1 only' }));
    expect(screen.getByText('No matching alerts.')).toBeTruthy();
  });
});

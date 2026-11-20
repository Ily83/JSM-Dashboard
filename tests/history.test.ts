import { describe, expect, it, vi } from 'vitest';
import { DemoSource } from '../server/demo/demoSource';
import { HistoryAnalysisService } from '../server/services/historyAnalysis';
import type { HistoryPage } from '../server/services/source';
import { DAY_MS, HISTORY_PAGE_SIZE, HISTORY_WINDOW_DAYS, historyDateLimits, historyWindows, parseUtcDate, previousCalendarMonth } from '../shared/history';
import { fetchHistoryAnalysisResults } from '../src/api/client';
import { filterHistoryMonths } from '../src/lib/historyAnalysis';

describe('history dates', () => {
  it('clamps a leap-day anniversary and rejects rolled-over date inputs', () => {
    expect(historyDateLimits(Date.UTC(2024, 1, 29, 23))).toEqual({ earliest: '2023-02-28', today: '2024-02-29' });
    expect(parseUtcDate('2023-02-29')).toBeNull();
  });

  it('selects the complete previous UTC calendar month, including year and leap-day boundaries', () => {
    expect(previousCalendarMonth(Date.UTC(2026, 0, 15))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(previousCalendarMonth(Date.UTC(2024, 2, 1))).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  describe('monthly history analysis', () => {
    const alert = async () => {
      const demo = new DemoSource({
        customerTagPrefixes: [], customerCompanyTagPrefixes: [], customerPropertyKeys: [], serviceTagPrefixes: [],
        servicePropertyKeys: [], serviceFallbackToEntity: false,
      });
      return (await demo.sync()).alerts.values().next().value!;
    };

    it('loads beyond 500 records, keeps empty months, and applies customer and tag filters', async () => {
      const sample = await alert();
      const records = Array.from({ length: 650 }, (_, i) => ({
        ...sample, id: `alert-${i}`, createdAt: Date.UTC(2026, 0, 20), customers: ['Contoso'], tags: [i === 0 ? 'prod' : 'dev'],
      }));
      const fetchPage = vi.fn(async ({ from, offset }: HistoryPage) => {
        const values = from === Date.UTC(2026, 0, 15) ? records : [];
        return { alerts: values.slice(offset, offset + HISTORY_PAGE_SIZE), hasNext: offset + HISTORY_PAGE_SIZE < values.length, truncated: false, skipped: 0 };
      });
      const service = new HistoryAnalysisService(fetchPage, 0);
      const job = service.start(Date.UTC(2026, 0, 15), Date.UTC(2026, 1, 10))!;
      expect(job).toMatchObject({ monthsDone: 0, monthsTotal: 2 });
      await vi.waitFor(() => expect(service.status()?.state).toBe('completed'));
      expect(service.status()).toMatchObject({ monthsDone: 2, monthsTotal: 2 });
      const months = service.results(job.id)!;
      expect(fetchPage).toHaveBeenCalledTimes(8);
      expect(fetchPage.mock.calls.every(([page]) => page.background === true)).toBe(true);
      expect(months.map((m) => m.alerts.length)).toEqual([650, 0]);
      expect(filterHistoryMonths(months, 'Contoso', 'prod').map((m) => m.alerts.map((a) => a.id))).toEqual([['alert-0'], []]);
      expect(filterHistoryMonths(months, 'Other', 'prod').map((m) => m.alerts.length)).toEqual([0, 0]);
      expect(months.every((m) => !m.partial)).toBe(true);
    });

    it('counts the calendar months of the range for the progress bar', async () => {
      const service = new HistoryAnalysisService(async () => ({ alerts: [], hasNext: false, truncated: false, skipped: 0 }), 0);
      expect(service.start(Date.UTC(2025, 10, 20), Date.UTC(2026, 10, 20))?.monthsTotal).toBe(13);
      await vi.waitFor(() => expect(service.status()).toMatchObject({ state: 'completed', monthsDone: 13 }));
      expect(service.start(Date.UTC(2026, 1, 3), Date.UTC(2026, 1, 3))?.monthsTotal).toBe(1);
    });

    it('splits dense windows and marks an unsplittable timestamp as partial', async () => {
      const sample = await alert();
      const start = Date.UTC(2026, 0, 1);
      const records = Array.from({ length: 250 }, (_, i) => ({ ...sample, id: `a-${i}`, createdAt: start + (i % 5) * 1000 }));
      const service = new HistoryAnalysisService(async ({ from, until, offset }) => {
        const matches = records.filter((a) => a.createdAt >= from && a.createdAt < until);
        return { alerts: matches.slice(offset, offset + 100), hasNext: offset + 100 < matches.length && offset < 100, truncated: matches.length > 200, skipped: 0 };
      }, 0);
      const job = service.start(start, start)!;
      await vi.waitFor(() => expect(service.status()?.state).toBe('completed'));
      expect(service.results(job.id)?.[0]).toMatchObject({ partial: false });
      expect(service.results(job.id)?.[0].alerts).toHaveLength(250);

      const crowded = new HistoryAnalysisService(async ({ from, until }) => ({
        alerts: from <= start && start < until ? [{ ...sample, id: 'one', createdAt: start }] : [],
        hasNext: false, truncated: from <= start && start < until, skipped: 0,
      }), 0);
      const crowdedJob = crowded.start(start, start)!;
      await vi.waitFor(() => expect(crowded.status()?.state).toBe('completed'));
      expect(crowded.results(crowdedJob.id)?.[0].partial).toBe(true);
    });

    it('cancels a job without publishing an in-flight result', async () => {
      let finish!: (value: { alerts: []; hasNext: false; truncated: false; skipped: 0 }) => void;
      let calls = 0;
      const service = new HistoryAnalysisService(() => {
        calls += 1;
        if (calls === 1) return new Promise((resolve) => { finish = resolve; });
        return Promise.resolve({ alerts: [], hasNext: false, truncated: false, skipped: 0 });
      }, 0);
      const job = service.start(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1))!;
      expect(service.start(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1))?.id).toBe(job.id);
      expect(service.start(Date.UTC(2026, 1, 1), Date.UTC(2026, 1, 1))).toBeNull();
      expect(service.cancel(job.id)?.state).toBe('cancelled');
      const replacement = service.start(Date.UTC(2026, 1, 1), Date.UTC(2026, 1, 1))!;
      finish({ alerts: [], hasNext: false, truncated: false, skipped: 0 });
      await vi.waitFor(() => expect(service.status()?.state).toBe('completed'));
      expect(service.status()?.id).toBe(replacement.id);
      expect(service.results(job.id)).toBeNull();
      expect(service.results(replacement.id)).toHaveLength(1);
    });

    it('reconstructs paged results across months, including an empty month', async () => {
      const sample = await alert();
      const months = [
        { key: '2026-01', from: '2026-01-01', to: '2026-01-31', partial: false, alerts: Array.from({ length: 2200 }, (_, i) => ({ ...sample, id: `a-${i}` })) },
        { key: '2026-02', from: '2026-02-01', to: '2026-02-28', partial: false, alerts: [] },
        { key: '2026-03', from: '2026-03-01', to: '2026-03-31', partial: true, alerts: [{ ...sample, id: 'last' }] },
      ];
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const params = new URL(String(input), 'http://localhost').searchParams;
        const monthIndex = Number(params.get('month'));
        const offset = Number(params.get('offset'));
        const month = months[monthIndex]!;
        return new Response(JSON.stringify({
          month: { ...month, alerts: month.alerts.slice(offset, offset + 1000) },
          hasNextPage: offset + 1000 < month.alerts.length,
          hasNextMonth: monthIndex + 1 < months.length,
        }));
      });
      try {
        expect(await fetchHistoryAnalysisResults('job')).toEqual(months);
        expect(fetchMock).toHaveBeenCalledTimes(5);
      } finally {
        fetchMock.mockRestore();
      }
    });
  });

  it('covers the selected year newest first with no gaps or duplicate dates', () => {
    const from = Date.UTC(2025, 9, 15);
    const to = Date.UTC(2026, 9, 15);
    const windows = historyWindows(from, to);
    expect(windows[0]?.to).toBe('2026-10-15');
    expect(windows.at(-1)?.from).toBe('2025-10-15');
    for (const [index, window] of windows.entries()) {
      const start = parseUtcDate(window.from)!;
      const end = parseUtcDate(window.to)!;
      expect((end - start) / DAY_MS + 1).toBeLessThanOrEqual(HISTORY_WINDOW_DAYS);
      if (index > 0) expect(end + DAY_MS).toBe(parseUtcDate(windows[index - 1]!.from));
    }
  });
});

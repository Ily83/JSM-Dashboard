import { describe, expect, it, vi } from 'vitest';
import { DemoSource } from '../server/demo/demoSource';
import { DAY_MS, HISTORY_PAGE_SIZE, HISTORY_WINDOW_DAYS, historyDateLimits, historyWindows, parseUtcDate } from '../shared/history';
import { filterHistoryMonths, loadHistoryMonths, MAX_ANALYSIS_ALERTS_PER_MONTH } from '../src/lib/historyAnalysis';

describe('history dates', () => {
  it('clamps a leap-day anniversary and rejects rolled-over date inputs', () => {
    expect(historyDateLimits(Date.UTC(2024, 1, 29, 23))).toEqual({ earliest: '2023-02-28', today: '2024-02-29' });
    expect(parseUtcDate('2023-02-29')).toBeNull();
  });

  describe('monthly history analysis', () => {
    const alert = async () => {
      const demo = new DemoSource({
        customerTagPrefixes: [], customerPropertyKeys: [], serviceTagPrefixes: [],
        servicePropertyKeys: [], serviceFallbackToEntity: false,
      });
      return (await demo.sync()).alerts.values().next().value!;
    };

    it('uses clipped UTC months, keeps empty months, and intersects customer and tag filters', async () => {
      const sample = await alert();
      const fetchPage = vi.fn(async ({ from }: { from: string; to: string }, offset: number) => ({
        alerts: from === '2026-01-15'
          ? [{ ...sample, id: `alert-${offset}`, createdAt: Date.UTC(2026, 0, 20), customers: ['Contoso'], tags: [offset ? 'dev' : 'prod'] }]
          : [],
        hasNext: from === '2026-01-15' && offset === 0,
        truncated: false,
        skipped: 0,
      }));

      const months = await loadHistoryMonths(Date.UTC(2026, 0, 15), Date.UTC(2026, 1, 10), fetchPage);
      expect(fetchPage.mock.calls).toEqual([
        [{ from: '2026-01-15', to: '2026-01-31' }, 0],
        [{ from: '2026-01-15', to: '2026-01-31' }, HISTORY_PAGE_SIZE],
        [{ from: '2026-02-01', to: '2026-02-10' }, 0],
      ]);
      expect(filterHistoryMonths(months, 'Contoso', 'prod').map((m) => m.alerts.map((a) => a.id))).toEqual([['alert-0'], []]);
      expect(filterHistoryMonths(months, 'Other', 'prod').map((m) => m.alerts.length)).toEqual([0, 0]);
      expect(months.every((m) => !m.partial)).toBe(true);
    });

    it('bounds pagination and marks counts incomplete when more alerts exist or records were skipped', async () => {
      const fetchPage = vi.fn(async ({ from }: { from: string; to: string }) => ({
        alerts: [], hasNext: from === '2026-01-31', truncated: false, skipped: from === '2026-02-01' ? 1 : 0,
      }));

      const months = await loadHistoryMonths(Date.UTC(2026, 0, 31), Date.UTC(2026, 1, 1), fetchPage);
      expect(fetchPage).toHaveBeenCalledTimes(MAX_ANALYSIS_ALERTS_PER_MONTH / HISTORY_PAGE_SIZE + 1);
      expect(months.map((m) => m.partial)).toEqual([true, true]);
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

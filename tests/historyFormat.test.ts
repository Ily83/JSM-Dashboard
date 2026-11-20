import { describe, expect, it } from 'vitest';
import { formatUtcDay, formatUtcDayTime, formatUtcMonth, formatUtcRange } from '../src/lib/historyAnalysis';

// ICU puts thin or narrow no-break spaces around the range dash and before AM/PM; compare with plain spaces.
const plain = (text: string) => text.replace(/[   ]/g, ' ');

describe('History dates: English, UTC, one style', () => {
  it('formats days and times in UTC whatever the local time zone', () => {
    // 23:30 UTC is already the next day east of UTC: the date must not move.
    const late = Date.UTC(2025, 10, 20, 23, 30);
    expect(formatUtcDay(late)).toBe('Nov 20, 2025');
    expect(plain(formatUtcDayTime(late))).toBe('Nov 20, 2025, 23:30');
    expect(plain(formatUtcDayTime(Date.UTC(2026, 0, 2, 4, 5)))).toBe('Jan 2, 2026, 04:05');
  });

  it('labels months in English', () => {
    expect(formatUtcMonth('2025-11-01')).toEqual({ short: 'Nov 25', long: 'November 2025' });
    expect(formatUtcMonth('2026-05-01')).toEqual({ short: 'May 26', long: 'May 2026' });
  });

  it('writes a range once, in the same style as the days', () => {
    expect(plain(formatUtcRange('2025-11-01', '2025-11-30'))).toBe('Nov 1 – 30, 2025');
    expect(plain(formatUtcRange('2025-11-20', '2026-11-20'))).toBe('Nov 20, 2025 – Nov 20, 2026');
    expect(plain(formatUtcRange('2026-03-04', '2026-03-04'))).toBe('Mar 4, 2026');
  });

  it('keeps unexpected input readable', () => {
    expect(formatUtcRange('2026-02-30', '2026-03-01')).toBe('2026-02-30 – 2026-03-01');
    expect(plain(formatUtcRange('2026-03-02', '2026-03-01'))).toBe('Mar 2, 2026 – Mar 1, 2026');
  });
});

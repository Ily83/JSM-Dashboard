import { describe, expect, it } from 'vitest';
import { COLUMN_IDS } from '../src/config/columns';
import { DEFAULT_TABLE_LAYOUT, sanitizeTableLayout } from '../src/state/tableLayout';

describe('sanitizeTableLayout', () => {
  it('returns the fallback for anything that is not an object', () => {
    const fallback = DEFAULT_TABLE_LAYOUT();
    expect(sanitizeTableLayout(null, fallback)).toBe(fallback);
    expect(sanitizeTableLayout('x', fallback)).toBe(fallback);
  });

  it('keeps the saved order without unknown or repeated ids, then appends new columns', () => {
    const { columnOrder } = sanitizeTableLayout({ columnOrder: ['summary', 'nope', 'summary', 'priority'] });
    expect(columnOrder.slice(0, 2)).toEqual(['summary', 'priority']);
    expect([...columnOrder].sort()).toEqual([...COLUMN_IDS].sort());
    expect(sanitizeTableLayout({ columnOrder: 'summary' }).columnOrder).toEqual([...COLUMN_IDS]);
  });

  it('applies saved visibility over the defaults, except for columns that cannot be hidden', () => {
    const { columnVisibility } = sanitizeTableLayout({ columnVisibility: { summary: false, priority: false, count: true, nope: false, status: 'no' } });
    expect(columnVisibility).toEqual({ priority: false, tinyId: false, count: true });
  });

  it('keeps widths of known columns between 40 and 2000 pixels, rounded', () => {
    const { columnSizing } = sanitizeTableLayout({
      columnSizing: { summary: 39, priority: 40, tags: 300, customers: 1999.6, assignee: 2000.4, status: 2001, service: '100' },
    });
    expect(columnSizing).toEqual({ priority: 40, customers: 2000 });
  });
});

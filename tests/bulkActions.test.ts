import { describe, expect, it } from 'vitest';
import type { Alert } from '../shared/types';
import { appliesTo } from '../src/components/actions/BulkActions';

describe('context action applicability', () => {
  const alert = (status: Alert['status'], acknowledged = false) => ({ status, acknowledged }) as Alert;

  it('allows notes and tags on closed alerts but not other actions', () => {
    const closed = alert('closed');
    expect(appliesTo('addNote', closed)).toBe(true);
    expect(appliesTo('addTags', closed)).toBe(true);
    expect(appliesTo('removeTags', closed)).toBe(true);
    expect(appliesTo('assign', closed)).toBe(false);
    expect(appliesTo('snooze', closed)).toBe(false);
  });

  it('only offers acknowledge or unacknowledge for the applicable state', () => {
    expect(appliesTo('acknowledge', alert('open'))).toBe(true);
    expect(appliesTo('acknowledge', alert('acked', true))).toBe(false);
    expect(appliesTo('unacknowledge', alert('acked', true))).toBe(true);
    expect(appliesTo('unacknowledge', alert('open'))).toBe(false);
  });
});

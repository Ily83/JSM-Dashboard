import { describe, expect, it } from 'vitest';
import { MAINTENANCE_MAX_DAYS, type Maintenance } from '../shared/opsContext';
import { maintenanceSummary, maintenanceTimeError, maintenanceTiming, rulesLabel, scopeLabel, submitLabel, when } from '../src/components/dashboard/maintenanceText';

const NOW = Date.UTC(2026, 10, 20, 12, 0);
const MIN = 60_000;
const DAY = 86_400_000;

describe('maintenance times', () => {
  it('accepts a window that ends after it starts', () => {
    expect(maintenanceTimeError(NOW, NOW + 60 * MIN, false, NOW)).toBeNull();
    expect(maintenanceTimeError(NOW + 10 * MIN, NOW + 70 * MIN, true, NOW)).toBeNull();
  });

  it('reports the first problem with the chosen times', () => {
    expect(maintenanceTimeError(Number.NaN, NOW, false, NOW)).toBe('Choose a time');
    expect(maintenanceTimeError(NOW, Number.NaN, false, NOW)).toBe('Choose a time');
    expect(maintenanceTimeError(NOW, NOW + MIN, false, NOW)).toBe('End after start');
    expect(maintenanceTimeError(NOW, NOW + MAINTENANCE_MAX_DAYS * DAY + MIN, false, NOW)).toBe(`At most ${MAINTENANCE_MAX_DAYS} days`);
    expect(maintenanceTimeError(NOW - 10 * MIN, NOW + 60 * MIN, true, NOW)).toBe('Start in the future');
    // Starting now is never "in the past".
    expect(maintenanceTimeError(NOW - 10 * MIN, NOW + 60 * MIN, false, NOW)).toBeNull();
  });

  it('shows when a window ends or starts', () => {
    expect(maintenanceTiming({ status: 'active', startDate: NOW - DAY, endDate: NOW + 100 * MIN }, NOW)).toBe('ends in 1h 40m');
    expect(maintenanceTiming({ status: 'active', startDate: NOW - DAY, endDate: null }, NOW)).toBe('active');
    expect(maintenanceTiming({ status: 'planned', startDate: NOW + DAY, endDate: null }, NOW)).toBe(when(NOW + DAY, NOW));
    expect(maintenanceTiming({ status: 'planned', startDate: null, endDate: null }, NOW)).toBe('planned');
    expect(when(null, NOW)).toBe('–');
  });
});

describe('maintenance labels', () => {
  const rule = (name: string | null, state: 'enabled' | 'disabled' = 'disabled'): Maintenance['rules'][number] => ({
    entity: { id: name ?? 'id', type: 'integration' },
    state,
    name,
  });

  it('lists up to two rules, marks enabled ones and counts the rest', () => {
    expect(rulesLabel([])).toBe('No rules');
    expect(rulesLabel([rule('Datadog'), rule(null)])).toBe('Datadog, integration');
    expect(rulesLabel([rule('Datadog'), rule('Paging', 'enabled'), rule('Email'), rule('Slack')])).toBe('Datadog, +Paging +2');
  });

  it('names the scope of a new window', () => {
    const teams = [{ id: 't1', name: 'Platform' }];
    expect(scopeLabel('', teams)).toBe('all teams');
    expect(scopeLabel('t1', teams)).toBe('Platform');
    expect(scopeLabel('t2', teams)).toBe('team');
    expect(scopeLabel('t1', undefined)).toBe('team');
  });

  it('summarises a new window before it is confirmed', () => {
    expect(maintenanceSummary(1, 'all teams', null, Number.NaN)).toBe('1 rule · all teams · now → –');
    expect(maintenanceSummary(3, 'Platform', null, Number.NaN)).toBe('3 rules · Platform · now → –');
    expect(maintenanceSummary(2, 'Platform', NOW, NOW + DAY)).toMatch(/^2 rules · Platform · .+ → .+$/);
    // "Start later" with the start field cleared while confirming: no crash.
    expect(maintenanceSummary(2, 'Platform', Number.NaN, Number.NaN)).toBe('2 rules · Platform · – → –');
  });

  it('labels the submit button by step', () => {
    expect(submitLabel(false, false)).toBe('Start maintenance');
    expect(submitLabel(false, true)).toBe('Plan maintenance');
    expect(submitLabel(true, true)).toBe('Confirm');
  });
});

import { describe, expect, it } from 'vitest';
import type { NotificationRule } from '../shared/notifications';
import { initialRuleForm, ruleChange } from '../src/lib/notificationRuleForm';

const base: NotificationRule = {
  id: 'r1', name: 'New Alert', event: 'create-alert', enabled: true, order: 0, criteria: { type: 'match-all' }, timeRestriction: null,
  notificationTime: [], repeat: { enabled: false, loopAfter: 0 }, steps: [],
};

describe('rule editor form', () => {
  it('starts from the rule and sends nothing when nothing changed', () => {
    const daily: NotificationRule = { ...base, criteria: { type: 'advanced-query', query: 'priority:P1' }, timeRestriction: { type: 'time-of-day', restriction: { startHour: 7, startMin: 5, endHour: 19, endMin: 0 } } };
    const form = initialRuleForm(daily);
    expect(form).toMatchObject({ filter: 'query', query: 'priority:P1', window: 'daily', from: '07:05', to: '19:00', repeat: false, loopAfter: 5 });
    expect(ruleChange(daily, form)).toBeNull();
    const conditions: NotificationRule = {
      ...base, criteria: { type: 'match-all-conditions', conditions: [] },
      timeRestriction: { type: 'weekday-and-time-of-day', restrictions: [{ startDay: 'monday', startHour: 9, startMin: 0, endDay: 'friday', endHour: 17, endMin: 0 }] },
    };
    expect(initialRuleForm(conditions)).toMatchObject({ filter: 'keep', window: 'keep' });
    expect(ruleChange(conditions, initialRuleForm(conditions))).toBeNull();
  });

  it('sends only the fields that changed', () => {
    const form = { ...initialRuleForm(base), name: ' Pager ', filter: 'query' as const, query: ' tags:prod ', window: 'daily' as const, repeat: true, loopAfter: 10 };
    expect(ruleChange(base, form)).toEqual({
      op: 'updateRule', id: 'r1', name: 'Pager', criteria: { type: 'advanced-query', query: 'tags:prod' },
      timeRestriction: { type: 'time-of-day', restriction: { startHour: 8, startMin: 0, endHour: 18, endMin: 0 } },
      repeat: { enabled: true, loopAfter: 10 },
    });
    // An empty query is not sent; going back to all alerts is.
    expect(ruleChange(base, { ...initialRuleForm(base), filter: 'query', query: '  ' })).toBeNull();
    const queried: NotificationRule = { ...base, criteria: { type: 'advanced-query', query: 'x' } };
    expect(ruleChange(queried, { ...initialRuleForm(queried), filter: 'all' })).toEqual({ op: 'updateRule', id: 'r1', criteria: { type: 'match-all' } });
  });

  it('removes a time limit, turns repeat off, and changes schedule timing', () => {
    const limited: NotificationRule = { ...base, repeat: { enabled: true, loopAfter: 15 }, timeRestriction: { type: 'time-of-day', restriction: { startHour: 8, startMin: 0, endHour: 18, endMin: 0 } } };
    expect(ruleChange(limited, { ...initialRuleForm(limited), window: 'any', repeat: false }))
      .toEqual({ op: 'updateRule', id: 'r1', timeRestriction: null, repeat: { enabled: false, loopAfter: 0 } });
    const schedule: NotificationRule = { ...base, event: 'schedule-start', repeat: null, notificationTime: ['just-before', '1-hour-ago'] };
    const form = initialRuleForm(schedule);
    expect(ruleChange(schedule, { ...form, times: ['1-hour-ago', 'just-before'] })).toBeNull();
    expect(ruleChange(schedule, { ...form, times: ['1-day-ago'] })).toEqual({ op: 'updateRule', id: 'r1', notificationTime: ['1-day-ago'] });
    expect(ruleChange(schedule, { ...form, times: [] })).toBeNull();
    // Repeat belongs to new alert rules only.
    expect(ruleChange(schedule, { ...form, repeat: true })).toBeNull();
  });
});

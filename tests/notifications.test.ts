import { describe, expect, it, vi } from 'vitest';
import { describeCriteria, describeTimeRestriction, type NotificationRule } from '../shared/notifications';
import { DemoNotifications } from '../server/demo/demoNotifications';
import { ruleBody, toContact, toRule } from '../server/jira/notifications';
import { RawContactSchema, RawNotificationRuleSchema } from '../server/jira/schemas';
import { oauthScopes } from '../server/oauth';
import { NotificationService, looksLikeEmail, parseNotificationChange, type NotificationSource } from '../server/services/notifications';
import { ActionRequestError } from '../server/services/operations';

// Shapes Jira returned on the test site (2026-11-25), with personal values replaced.
const RAW_RULE = {
  id: 'rule-1', name: 'alert-center-probe', actionType: 'create-alert',
  criteria: { type: 'advanced-query', query: 'priority:P1 AND tags:alert-center-probe', conditionTree: { operator: 'AND', not: false, children: [] } },
  timeRestriction: { type: 'time-of-day', restriction: { startHour: 8, endHour: 18, startMin: 0, endMin: 30 } },
  order: 9,
  steps: [{ id: 'step-1', sendAfter: 0, contact: { method: 'email', to: 'ops@example.com' }, enabled: true }],
  repeat: { loopAfter: 10, enabled: true },
  enabled: false,
};
const RAW_CONDITIONS_RULE = {
  id: 'rule-2', name: 'Weekdays', actionType: 'create-alert', order: 1, enabled: true,
  criteria: { type: 'match-any-condition', conditions: [
    { field: 'priority', not: false, operation: 'equals', expectedValue: 'P1', order: 0 },
    { field: 'tags', not: true, operation: 'contains', expectedValue: 'probe', order: 0 },
  ] },
  timeRestriction: { type: 'weekday-and-time-of-day', restrictions: [{ startDay: 'monday', endDay: 'friday', startHour: 9, endHour: 17, startMin: 0, endMin: 0 }] },
  repeat: { enabled: false },
  steps: [{ id: 'step-2', contact: { method: 'email', to: 'ops@example.com' }, enabled: true }],
};
const RAW_SCHEDULE_RULE = { id: 'rule-3', name: 'Schedule Start', actionType: 'schedule-start', criteria: { type: 'match-all' }, notificationTime: ['15-minutes-ago', '1-hour-ago'], schedules: [], order: 10, steps: [], enabled: false };

describe('Jira notification settings: mapping', () => {
  it('reads rules as Jira returns them', () => {
    const rule = toRule(RawNotificationRuleSchema.parse(RAW_RULE))!;
    expect(rule).toEqual({
      id: 'rule-1', name: 'alert-center-probe', event: 'create-alert', enabled: false, order: 9,
      criteria: { type: 'advanced-query', query: 'priority:P1 AND tags:alert-center-probe' },
      timeRestriction: { type: 'time-of-day', restriction: { startHour: 8, startMin: 0, endHour: 18, endMin: 30 } },
      notificationTime: [], repeat: { enabled: true, loopAfter: 10 },
      steps: [{ id: 'step-1', method: 'email', to: 'ops@example.com', sendAfter: 0, enabled: true }],
    });
    const conditions = toRule(RawNotificationRuleSchema.parse(RAW_CONDITIONS_RULE))!;
    expect(describeCriteria(conditions.criteria)).toBe('priority equals “P1” or tags not contains “probe”');
    expect(describeTimeRestriction(conditions.timeRestriction)).toBe('Mon 09:00 – Fri 17:00');
    expect(conditions.repeat).toEqual({ enabled: false, loopAfter: 0 });
    expect(conditions.steps[0].sendAfter).toBe(0);
    const schedule = toRule(RawNotificationRuleSchema.parse(RAW_SCHEDULE_RULE))!;
    expect(schedule.notificationTime).toEqual(['15-minutes-ago', '1-hour-ago']);
    expect(describeTimeRestriction(toRule(RawNotificationRuleSchema.parse(RAW_RULE))!.timeRestriction)).toBe('08:00–18:30 every day');
  });

  it('skips what it does not know instead of guessing', () => {
    expect(toRule(RawNotificationRuleSchema.parse({ ...RAW_RULE, actionType: 'future-event' }))).toBeNull();
    expect(toRule(RawNotificationRuleSchema.parse({ ...RAW_RULE, criteria: { type: 'future-filter' } }))!.criteria).toEqual({ type: 'advanced-query', query: '(future-filter)' });
    expect(toContact(RawContactSchema.parse({ id: 'c1', method: 'pager', to: 'x' }))).toBeNull();
    expect(toContact(RawContactSchema.parse({ id: 'c2', method: 'mobile', to: 'Pixel 9', status: { enabled: false } }))).toEqual({ id: 'c2', method: 'mobile', to: 'Pixel 9', enabled: false });
  });

  it('writes the request body Jira documents', () => {
    expect(ruleBody({
      name: 'P1', event: 'create-alert', enabled: false, criteria: { type: 'advanced-query', query: 'priority:P1' },
      steps: [{ method: 'sms', to: '+1 555 0100', sendAfter: 5, enabled: true }],
    })).toEqual({
      name: 'P1', actionType: 'create-alert', enabled: false, criteria: { type: 'advanced-query', query: 'priority:P1' },
      steps: [{ contact: { method: 'sms', to: '+1 555 0100' }, sendAfter: 5, enabled: true }],
    });
    // Fields that are not changing are left out, so Jira keeps them.
    expect(Object.keys(ruleBody({ name: 'x', event: 'add-note', enabled: true }))).toEqual(['name', 'actionType', 'enabled']);
  });
});

describe('notification changes: validation', () => {
  it('checks the shape of an email address without a backtracking pattern', () => {
    for (const ok of ['ops@example.com', 'a.b+c@sub.example.co.uk']) expect(looksLikeEmail(ok), ok).toBe(true);
    for (const bad of ['', 'ops', 'ops@', '@example.com', 'ops@example', 'ops@.com', 'ops@example.', 'a@b@c.com', 'o ps@example.com', `${'a'.repeat(150)}@${'b'.repeat(40)}`]) {
      expect(looksLikeEmail(bad), bad).toBe(false);
    }
  });

  it('accepts the documented changes and refuses the rest, naming fields only', () => {
    expect(parseNotificationChange({ op: 'addContact', method: 'sms', to: ' +1 555 0100 ' })).toEqual({ op: 'addContact', method: 'sms', to: '+1 555 0100' });
    const refusal = (body: unknown) => { try { parseNotificationChange(body); return null; } catch (e) { return (e as Error).message; } };
    expect(refusal({ op: 'addContact', method: 'mobile', to: 'phone' })).toBe('Invalid change (method).');
    expect(refusal({ op: 'addContact', method: 'email', to: 'not-an-email' })).toBe('Enter a valid email address.');
    expect(refusal({ op: 'addStep', ruleId: 'r', contactId: 'c', sendAfter: -1 })).toBe('Invalid change (sendAfter).');
    expect(refusal({ op: 'updateRule', id: 'r', timeRestriction: { type: 'time-of-day', restriction: { startHour: 24, startMin: 0, endHour: 1, endMin: 0 } } }))
      .toBe('Invalid change (timeRestriction.restriction.startHour).');
    expect(refusal({ op: 'updateRule', id: 'r', criteria: { type: 'match-any-condition', conditions: [] } })).toBe('Invalid change (criteria.type).');
    expect(refusal({ op: 'deleteRule', id: '../x' })).toBe('Invalid change (id).');
    expect(refusal({ op: 'runScript' })).toBe('Invalid change (op).');
    const secret = refusal({ op: 'updateContact', id: 'c', to: 'x' });
    expect(secret).not.toContain('x"');
  });
});

function source(rules: NotificationRule[] = []): NotificationSource & { calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => vi.fn(async (...args: unknown[]) => { calls.push(`${name} ${JSON.stringify(args)}`); return { id: 'new-rule' }; });
  return {
    calls,
    contacts: async () => [{ id: 'c1', method: 'email', to: 'ops@example.com', enabled: true }],
    rules: async () => ({ rules, other: 0 }),
    addContact: record('addContact') as never, updateContact: record('updateContact') as never, setContactEnabled: record('setContactEnabled') as never,
    deleteContact: record('deleteContact') as never, addRule: record('addRule') as never, updateRule: record('updateRule') as never,
    deleteRule: record('deleteRule') as never, addStep: record('addStep') as never, updateStep: record('updateStep') as never, deleteStep: record('deleteStep') as never,
  };
}
const RULE = toRule(RawNotificationRuleSchema.parse(RAW_RULE))!;
const SCHEDULE = toRule(RawNotificationRuleSchema.parse(RAW_SCHEDULE_RULE))!;

describe('NotificationService', () => {
  it('reads always, and refuses changes unless "notifications" is enabled', async () => {
    const off = new NotificationService(source([RULE]), false);
    expect((await off.read()).writable).toBe(false);
    await expect(off.apply({ op: 'deleteRule', id: 'rule-1' })).rejects.toMatchObject({ status: 403 });
  });

  it('sends a step to an existing contact only, by its id', async () => {
    const s = source([RULE]);
    const service = new NotificationService(s, true);
    await service.apply({ op: 'addStep', ruleId: 'rule-1', contactId: 'c1', sendAfter: 5 });
    expect(s.calls).toEqual(['addStep ["rule-1",{"method":"email","to":"ops@example.com","sendAfter":5}]']);
    await expect(service.apply({ op: 'addStep', ruleId: 'rule-1', contactId: 'gone', sendAfter: 0 })).rejects.toMatchObject({ status: 404 });
  });

  it('sends a delay only where Jira takes one (new and assigned alert rules)', async () => {
    const s = source([RULE, SCHEDULE]);
    const service = new NotificationService(s, true);
    await service.apply({ op: 'addStep', ruleId: 'rule-3', contactId: 'c1', sendAfter: 0 });
    expect(s.calls).toEqual(['addStep ["rule-3",{"method":"email","to":"ops@example.com"}]']);
    await expect(service.apply({ op: 'addStep', ruleId: 'rule-3', contactId: 'c1', sendAfter: 5 })).rejects.toThrow('Only new alert and assigned alert rules');
    await expect(service.apply({ op: 'updateStep', ruleId: 'rule-3', id: 'x', sendAfter: 5 })).rejects.toMatchObject({ status: 400 });
    const demo = new NotificationService(new DemoNotifications(), true);
    const note = (await demo.read()).rules.find((r) => r.event === 'add-note')!;
    const after = await demo.apply({ op: 'addStep', ruleId: note.id, contactId: 'demo-contact-sms', sendAfter: 0 });
    expect(after.rules.find((r) => r.id === note.id)!.steps.map((x) => x.sendAfter)).toEqual([0, 0]);
  });

  it('updates a rule with the fields Jira requires plus the changed ones', async () => {
    const s = source([RULE, SCHEDULE]);
    const service = new NotificationService(s, true);
    await service.apply({ op: 'updateRule', id: 'rule-1', enabled: true });
    await service.apply({ op: 'updateRule', id: 'rule-3', notificationTime: ['1-day-ago', '1-day-ago'] });
    expect(s.calls).toEqual([
      'updateRule ["rule-1",{"name":"alert-center-probe","event":"create-alert","enabled":true}]',
      'updateRule ["rule-3",{"name":"Schedule Start","event":"schedule-start","enabled":false,"notificationTime":["1-day-ago"]}]',
    ]);
    await expect(service.apply({ op: 'updateRule', id: 'rule-3', repeat: { enabled: true, loopAfter: 5 } })).rejects.toThrow('Only new alert rules repeat.');
    await expect(service.apply({ op: 'updateRule', id: 'rule-1', notificationTime: ['just-before'] })).rejects.toThrow('Only schedule start and end rules');
    await expect(service.apply({ op: 'updateRule', id: 'missing', enabled: true })).rejects.toMatchObject({ status: 404 });
  });

  it('removes a time limit by replacing the rule with a copy', async () => {
    const s = source([RULE]);
    await new NotificationService(s, true).apply({ op: 'updateRule', id: 'rule-1', timeRestriction: null });
    expect(s.calls).toEqual([
      'addRule [{"name":"alert-center-probe","event":"create-alert","enabled":false,"criteria":{"type":"advanced-query","query":"priority:P1 AND tags:alert-center-probe"},"repeat":{"enabled":true,"loopAfter":10},"steps":[{"method":"email","to":"ops@example.com","enabled":true,"sendAfter":0}]}]',
      'deleteRule ["rule-1"]',
    ]);
  });

  it('removes the copy again when the old rule cannot be deleted', async () => {
    const s = source([RULE]);
    s.deleteRule = vi.fn(async (id: string) => {
      s.calls.push(`deleteRule ${id}`);
      if (id === 'rule-1') throw new ActionRequestError(403, 'Not allowed.');
    });
    await expect(new NotificationService(s, true).apply({ op: 'updateRule', id: 'rule-1', timeRestriction: null })).rejects.toThrow('Not allowed.');
    expect(s.calls.slice(1)).toEqual(['deleteRule rule-1', 'deleteRule new-rule']);
  });

  it('works end to end on the demo settings', async () => {
    const service = new NotificationService(new DemoNotifications(), true);
    const before = await service.read();
    expect(before.contacts.map((c) => c.method)).toEqual(['email', 'sms']);
    const weekend = before.rules.find((r) => r.name === 'P1 by SMS at the weekend')!;
    const after = await service.apply({ op: 'updateRule', id: weekend.id, timeRestriction: null });
    const copy = after.rules.find((r) => r.name === 'P1 by SMS at the weekend')!;
    expect(copy.id).not.toBe(weekend.id);
    expect(copy.timeRestriction).toBeNull();
    expect(after.rules.filter((r) => r.event === 'create-alert').at(-1)!.id).toBe(copy.id);
    expect(copy.steps.map((s) => s.to)).toEqual(['+1 555 0100']);
    const added = await service.apply({ op: 'addRule', event: 'schedule-end', name: 'Off call' });
    expect(added.rules.find((r) => r.name === 'Off call')!.notificationTime).toEqual(['just-before']);
    await expect(service.apply({ op: 'deleteContact', id: 'demo-contact-email' })).rejects.toThrow('primary email');
  });
});

describe('sign-in permissions', () => {
  it('asks for Operations configuration writes and deletes, not alert writes, for notification settings', () => {
    expect(oauthScopes(['notifications'])).toEqual([
      'offline_access', 'read:ops-alert:jira-service-management', 'read:ops-config:jira-service-management',
      'write:ops-config:jira-service-management', 'delete:ops-config:jira-service-management',
    ]);
    expect(oauthScopes(['maintenance'])).not.toContain('delete:ops-config:jira-service-management');
  });
});

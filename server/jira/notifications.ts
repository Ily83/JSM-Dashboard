import {
  CONTACT_METHODS, NOTIFICATION_EVENTS, SCHEDULE_TIMES, WEEKDAYS,
  type Contact, type ContactMethod, type NewContactMethod, type NotificationEvent, type NotificationRule,
  type RuleCriteria, type ScheduleTime, type TimeRestriction, type Weekday,
} from '../../shared/notifications';
import type { NotificationSource, RuleFields } from '../services/notifications';
import type { JiraClient } from './client';
import type { RawContact, RawNotificationRule } from './schemas';

const isEvent = (value: string): value is NotificationEvent => (NOTIFICATION_EVENTS as readonly string[]).includes(value);
const isMethod = (value: string): value is ContactMethod => (CONTACT_METHODS as readonly string[]).includes(value);
const isTime = (value: string): value is ScheduleTime => (SCHEDULE_TIMES as readonly string[]).includes(value);
const isDay = (value: string): value is Weekday => (WEEKDAYS as readonly string[]).includes(value);

export function toContact(raw: RawContact): Contact | null {
  if (!isMethod(raw.method)) return null;
  return { id: raw.id, method: raw.method, to: raw.to, enabled: raw.status?.enabled ?? true };
}

function toCriteria(raw: RawNotificationRule['criteria']): RuleCriteria {
  if (!raw || raw.type === 'match-all') return { type: 'match-all' };
  if (raw.type === 'advanced-query') return { type: 'advanced-query', query: raw.query ?? '' };
  if (raw.type === 'match-any-condition' || raw.type === 'match-all-conditions') {
    return {
      type: raw.type,
      conditions: (raw.conditions ?? []).map((c) => ({
        field: c.field, ...(c.key ? { key: c.key } : {}), not: c.not ?? false, operation: c.operation, expectedValue: c.expectedValue ?? '',
      })),
    };
  }
  // A criteria type this app does not know: shown by name, kept unless replaced.
  return { type: 'advanced-query', query: `(${raw.type})` };
}

type RawTime = { startHour: number; startMin: number; endHour: number; endMin: number };
const time = (t: RawTime) => ({ startHour: t.startHour, startMin: t.startMin, endHour: t.endHour, endMin: t.endMin });

function toTimeRestriction(raw: RawNotificationRule['timeRestriction']): TimeRestriction | null {
  if (!raw) return null;
  if (raw.type === 'time-of-day') return { type: 'time-of-day', restriction: time(raw.restriction) };
  const restrictions = raw.restrictions.flatMap((r) => (isDay(r.startDay) && isDay(r.endDay) ? [{ ...time(r), startDay: r.startDay, endDay: r.endDay }] : []));
  return restrictions.length > 0 ? { type: 'weekday-and-time-of-day', restrictions } : null;
}

export function toRule(raw: RawNotificationRule): NotificationRule | null {
  if (!isEvent(raw.actionType)) return null;
  return {
    id: raw.id,
    name: raw.name ?? raw.actionType,
    event: raw.actionType,
    enabled: raw.enabled ?? true,
    order: raw.order ?? 0,
    criteria: toCriteria(raw.criteria),
    timeRestriction: toTimeRestriction(raw.timeRestriction),
    notificationTime: (raw.notificationTime ?? []).filter(isTime),
    repeat: raw.repeat ? { enabled: raw.repeat.enabled ?? false, loopAfter: raw.repeat.loopAfter ?? 0 } : null,
    steps: (raw.steps ?? []).flatMap((s) => (isMethod(s.contact.method)
      ? [{ id: s.id, method: s.contact.method, to: s.contact.to, sendAfter: s.sendAfter ?? 0, enabled: s.enabled ?? true }]
      : [])),
  };
}

/** A rule in the request body Jira documents for create and update. */
export function ruleBody(fields: RuleFields): Record<string, unknown> {
  return {
    name: fields.name,
    actionType: fields.event,
    enabled: fields.enabled,
    ...(fields.criteria ? { criteria: fields.criteria } : {}),
    ...(fields.timeRestriction ? { timeRestriction: fields.timeRestriction } : {}),
    ...(fields.notificationTime ? { notificationTime: fields.notificationTime } : {}),
    ...(fields.repeat ? { repeat: fields.repeat } : {}),
    ...(fields.steps ? { steps: fields.steps.map((s) => ({ contact: { method: s.method, to: s.to }, ...(s.sendAfter === undefined ? {} : { sendAfter: s.sendAfter }), enabled: s.enabled })) } : {}),
  };
}

export const byEventThenOrder = (a: NotificationRule, b: NotificationRule) =>
  NOTIFICATION_EVENTS.indexOf(a.event) - NOTIFICATION_EVENTS.indexOf(b.event) || a.order - b.order;

/** The signed-in user's notification settings in Jira. */
export class JiraNotifications implements NotificationSource {
  constructor(private readonly client: JiraClient) {}

  async contacts(): Promise<Contact[]> {
    return (await this.client.listContacts()).flatMap((raw) => toContact(raw) ?? []);
  }

  async rules(): Promise<{ rules: NotificationRule[]; other: number }> {
    const raw = await this.client.listNotificationRules();
    const rules = raw.flatMap((r) => toRule(r) ?? []).sort(byEventThenOrder);
    return { rules, other: raw.length - rules.length };
  }

  addContact(method: NewContactMethod, to: string) { return this.client.createContact(method, to); }
  updateContact(id: string, to: string) { return this.client.updateContact(id, to); }
  setContactEnabled(id: string, enabled: boolean) { return this.client.setContactEnabled(id, enabled); }
  deleteContact(id: string) { return this.client.deleteContact(id); }
  addRule(fields: RuleFields) { return this.client.createNotificationRule(ruleBody(fields)); }
  updateRule(id: string, fields: RuleFields) { return this.client.updateNotificationRule(id, ruleBody(fields)); }
  deleteRule(id: string) { return this.client.deleteNotificationRule(id); }
  addStep(ruleId: string, step: { method: ContactMethod; to: string; sendAfter?: number }) {
    return this.client.createRuleStep(ruleId, { contact: { method: step.method, to: step.to }, ...(step.sendAfter === undefined ? {} : { sendAfter: step.sendAfter }), enabled: true });
  }
  updateStep(ruleId: string, id: string, change: { sendAfter?: number; enabled?: boolean }) {
    return this.client.updateRuleStep(ruleId, id, change);
  }
  deleteStep(ruleId: string, id: string) { return this.client.deleteRuleStep(ruleId, id); }
}

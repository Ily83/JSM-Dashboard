import { randomUUID } from 'node:crypto';
import { DELAYED_EVENTS, type Contact, type ContactMethod, type NewContactMethod, type NotificationRule } from '../../shared/notifications';
import { byEventThenOrder } from '../jira/notifications';
import { ActionRequestError } from '../services/operations';
import type { NotificationSource, RuleFields } from '../services/notifications';

const EMAIL = 'operator@example.com';
const PHONE = '+1 555 0100';

/**
 * Notification settings for demo mode: a fictional user, in memory. Changes
 * affect this copy only. The rules follow what Jira creates for a new user.
 */
export class DemoNotifications implements NotificationSource {
  private contactList: Contact[] = [
    { id: 'demo-contact-email', method: 'email', to: EMAIL, enabled: true },
    { id: 'demo-contact-sms', method: 'sms', to: PHONE, enabled: false },
  ];

  private ruleList: NotificationRule[] = [
    rule('New Alert', 'create-alert', 0, { repeat: { enabled: false, loopAfter: 0 } }),
    rule('Acknowledged Alert', 'acknowledged-alert', 0),
    rule('Closed Alert', 'closed-alert', 0),
    rule('Assigned Alert', 'assigned-alert', 0),
    rule('Add Note', 'add-note', 0),
    rule('Schedule Start', 'schedule-start', 0, { notificationTime: ['just-before'] }),
    rule('Schedule End', 'schedule-end', 0, { notificationTime: ['just-before'] }),
    rule('Incoming Call Routing', 'incoming-call-routing', 0),
    rule('P1 by SMS at the weekend', 'create-alert', 1, {
      enabled: false,
      criteria: { type: 'advanced-query', query: 'priority:P1' },
      timeRestriction: { type: 'weekday-and-time-of-day', restrictions: [{ startDay: 'friday', startHour: 18, startMin: 0, endDay: 'monday', endHour: 8, endMin: 0 }] },
      steps: [{ id: randomUUID(), method: 'sms', to: PHONE, sendAfter: 5, enabled: true }],
    }),
  ];

  private contact(id: string): Contact {
    const found = this.contactList.find((c) => c.id === id);
    if (!found) throw new ActionRequestError(404, 'Contact not found.');
    return found;
  }

  private find(id: string): NotificationRule {
    const found = this.ruleList.find((r) => r.id === id);
    if (!found) throw new ActionRequestError(404, 'Notification rule not found.');
    return found;
  }

  async contacts(): Promise<Contact[]> {
    return structuredClone(this.contactList);
  }

  async rules(): Promise<{ rules: NotificationRule[]; other: number }> {
    return { rules: structuredClone(this.ruleList).sort(byEventThenOrder), other: 0 };
  }

  async addContact(method: NewContactMethod, to: string): Promise<void> {
    if (this.contactList.some((c) => c.method === method && c.to === to)) throw new ActionRequestError(422, 'This contact already exists.');
    this.contactList.push({ id: randomUUID(), method, to, enabled: true });
  }

  async updateContact(id: string, to: string): Promise<void> {
    this.contact(id).to = to;
  }

  async setContactEnabled(id: string, enabled: boolean): Promise<void> {
    this.contact(id).enabled = enabled;
  }

  async deleteContact(id: string): Promise<void> {
    const found = this.contact(id);
    if (found.id === 'demo-contact-email') throw new ActionRequestError(422, 'The primary email address cannot be deleted.');
    this.contactList = this.contactList.filter((c) => c !== found);
  }

  async addRule(fields: RuleFields): Promise<{ id: string }> {
    const sameEvent = this.ruleList.filter((r) => r.event === fields.event);
    // Like Jira: a new rule goes to the end of its list.
    const created = rule(fields.name, fields.event, sameEvent.length, {
      enabled: fields.enabled,
      criteria: fields.criteria ?? { type: 'match-all' },
      timeRestriction: fields.timeRestriction ?? null,
      notificationTime: fields.notificationTime ?? [],
      repeat: fields.repeat ?? null,
      steps: (fields.steps ?? []).map((s) => ({ ...s, sendAfter: s.sendAfter ?? 0, id: randomUUID() })),
    });
    this.ruleList.push(created);
    return { id: created.id };
  }

  async updateRule(id: string, fields: RuleFields): Promise<void> {
    const found = this.find(id);
    found.name = fields.name;
    found.enabled = fields.enabled;
    // Like Jira: fields left out keep their value.
    if (fields.criteria) found.criteria = fields.criteria;
    if (fields.timeRestriction) found.timeRestriction = fields.timeRestriction;
    if (fields.notificationTime) found.notificationTime = fields.notificationTime;
    if (fields.repeat) found.repeat = fields.repeat;
  }

  async deleteRule(id: string): Promise<void> {
    const found = this.find(id);
    this.ruleList = this.ruleList.filter((r) => r !== found);
    for (const r of this.ruleList) if (r.event === found.event && r.order > found.order) r.order -= 1;
  }

  async addStep(ruleId: string, step: { method: ContactMethod; to: string; sendAfter?: number }): Promise<void> {
    const found = this.find(ruleId);
    // Like Jira, which answers 422 for a delay on any other rule.
    if (step.sendAfter !== undefined && !DELAYED_EVENTS.includes(found.event)) {
      throw new ActionRequestError(422, "Notification steps' sendAfter can be defined only for 'create-alert' and 'assigned-alert'.");
    }
    found.steps.push({ id: randomUUID(), ...step, sendAfter: step.sendAfter ?? 0, enabled: true });
  }

  async updateStep(ruleId: string, id: string, change: { sendAfter?: number; enabled?: boolean }): Promise<void> {
    const found = this.find(ruleId);
    const step = found.steps.find((s) => s.id === id);
    if (!step) throw new ActionRequestError(404, 'Step not found.');
    if (change.sendAfter !== undefined && !DELAYED_EVENTS.includes(found.event)) {
      throw new ActionRequestError(422, "Notification steps' sendAfter can be defined only for 'create-alert' and 'assigned-alert'.");
    }
    if (change.sendAfter !== undefined) step.sendAfter = change.sendAfter;
    if (change.enabled !== undefined) step.enabled = change.enabled;
  }

  async deleteStep(ruleId: string, id: string): Promise<void> {
    const found = this.find(ruleId);
    found.steps = found.steps.filter((s) => s.id !== id);
  }
}

function rule(name: string, event: NotificationRule['event'], order: number, extra: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: randomUUID(), name, event, order, enabled: true, criteria: { type: 'match-all' }, timeRestriction: null, notificationTime: [], repeat: null,
    steps: [{ id: randomUUID(), method: 'email', to: EMAIL, sendAfter: 0, enabled: true }],
    ...extra,
  };
}

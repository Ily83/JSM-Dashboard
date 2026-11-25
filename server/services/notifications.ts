import { z } from 'zod';
import {
  CONTACT_TO_MAX, DELAYED_EVENTS, LOOP_AFTER_MAX, NEW_CONTACT_METHODS, NOTIFICATION_EVENTS, NOTIFICATION_NAME_MAX, QUERY_MAX,
  SCHEDULE_EVENTS, SCHEDULE_TIMES, SEND_AFTER_MAX, WEEKDAYS,
  type Contact, type NewContactMethod, type NotificationChange, type NotificationEvent, type NotificationRule,
  type NotificationsResponse, type ScheduleTime, type TimeRestriction,
} from '../../shared/notifications';
import { log } from '../logger';
import { ActionRequestError } from './operations';

/** A new rule or the fields to change, in Jira's own terms. */
export interface RuleFields {
  name: string;
  event: NotificationEvent;
  enabled: boolean;
  criteria?: NotificationRule['criteria'];
  timeRestriction?: TimeRestriction;
  notificationTime?: ScheduleTime[];
  repeat?: { enabled: boolean; loopAfter: number };
  /** `sendAfter` only for DELAYED_EVENTS. */
  steps?: Array<{ method: Contact['method']; to: string; sendAfter?: number; enabled: boolean }>;
}

/**
 * The signed-in user's contacts and notification rules. Implemented for Jira
 * (JiraNotifications) and for demo mode (DemoNotifications).
 */
export interface NotificationSource {
  contacts(): Promise<Contact[]>;
  /** The rules, and how many have an event this app does not know. */
  rules(): Promise<{ rules: NotificationRule[]; other: number }>;
  addContact(method: NewContactMethod, to: string): Promise<void>;
  updateContact(id: string, to: string): Promise<void>;
  setContactEnabled(id: string, enabled: boolean): Promise<void>;
  deleteContact(id: string): Promise<void>;
  addRule(fields: RuleFields): Promise<{ id: string }>;
  /** `fields` holds name, event and enabled (Jira requires them), plus the fields to change. */
  updateRule(id: string, fields: RuleFields): Promise<void>;
  deleteRule(id: string): Promise<void>;
  /** `sendAfter` only for DELAYED_EVENTS: Jira refuses it on the others. */
  addStep(ruleId: string, step: { method: Contact['method']; to: string; sendAfter?: number }): Promise<void>;
  updateStep(ruleId: string, id: string, change: { sendAfter?: number; enabled?: boolean }): Promise<void>;
  deleteStep(ruleId: string, id: string): Promise<void>;
}

// ---- Validation -------------------------------------------------------------

const ID = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9:._-]+$/, 'invalid id');
const NAME = z.string().trim().min(1).max(NOTIFICATION_NAME_MAX);
const MINUTES = (max: number) => z.number().int().min(0).max(max);
const TIME = { startHour: z.number().int().min(0).max(23), startMin: z.number().int().min(0).max(59), endHour: z.number().int().min(0).max(23), endMin: z.number().int().min(0).max(59) };
const TimeRestrictionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('time-of-day'), restriction: z.object(TIME) }),
  z.object({
    type: z.literal('weekday-and-time-of-day'),
    restrictions: z.array(z.object({ ...TIME, startDay: z.enum(WEEKDAYS), endDay: z.enum(WEEKDAYS) })).min(1).max(15),
  }),
]);
/** One "@", nothing blank around it, and a dot inside the domain. Jira checks the address itself. */
export function looksLikeEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const [local, domain, ...rest] = value.split('@');
  if (rest.length > 0 || !local || !domain) return false;
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

const ChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addContact'), method: z.enum(NEW_CONTACT_METHODS), to: z.string().trim().min(3).max(CONTACT_TO_MAX) }),
  z.object({ op: z.literal('updateContact'), id: ID, to: z.string().trim().min(3).max(CONTACT_TO_MAX) }),
  z.object({ op: z.literal('setContactEnabled'), id: ID, enabled: z.boolean() }),
  z.object({ op: z.literal('deleteContact'), id: ID }),
  z.object({ op: z.literal('addRule'), event: z.enum(NOTIFICATION_EVENTS), name: NAME }),
  z.object({
    op: z.literal('updateRule'),
    id: ID,
    name: NAME.optional(),
    enabled: z.boolean().optional(),
    criteria: z.discriminatedUnion('type', [
      z.object({ type: z.literal('match-all') }),
      z.object({ type: z.literal('advanced-query'), query: z.string().trim().min(1).max(QUERY_MAX) }),
    ]).optional(),
    timeRestriction: TimeRestrictionSchema.nullable().optional(),
    notificationTime: z.array(z.enum(SCHEDULE_TIMES)).min(1).max(SCHEDULE_TIMES.length).optional(),
    repeat: z.object({ enabled: z.boolean(), loopAfter: MINUTES(LOOP_AFTER_MAX) }).optional(),
  }),
  z.object({ op: z.literal('deleteRule'), id: ID }),
  z.object({ op: z.literal('addStep'), ruleId: ID, contactId: ID, sendAfter: MINUTES(SEND_AFTER_MAX) }),
  z.object({ op: z.literal('updateStep'), ruleId: ID, id: ID, sendAfter: MINUTES(SEND_AFTER_MAX).optional(), enabled: z.boolean().optional() }),
  z.object({ op: z.literal('deleteStep'), ruleId: ID, id: ID }),
]);

/** Validates one change, or throws ActionRequestError (400) naming the fields, never their values. */
export function parseNotificationChange(body: unknown): NotificationChange {
  const parsed = ChangeSchema.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || 'body'))].join(', ');
    throw new ActionRequestError(400, `Invalid change (${fields}).`);
  }
  const change: NotificationChange = parsed.data;
  if ((change.op === 'addContact' && change.method === 'email') && !looksLikeEmail(change.to)) {
    throw new ActionRequestError(400, 'Enter a valid email address.');
  }
  if (change.op === 'updateRule' && change.notificationTime) {
    change.notificationTime = [...new Set(change.notificationTime)];
  }
  return change;
}

const deduplicate = <T>(items: T[]) => [...new Set(items)];

/**
 * Gatekeeper for notification settings, like ActionService for alert
 * actions: reads always, writes only when "notifications" is enabled in
 * JIRA_WRITE_ACTIONS. Logs the change and ids only: contact addresses are
 * personal data.
 */
export class NotificationService {
  constructor(
    private readonly source: NotificationSource,
    private readonly enabled: boolean,
  ) {}

  async read(): Promise<NotificationsResponse> {
    const [contacts, { rules, other }] = await Promise.all([this.source.contacts(), this.source.rules()]);
    return { contacts, rules, writable: this.enabled, otherRules: other };
  }

  async apply(body: unknown): Promise<NotificationsResponse> {
    if (!this.enabled) {
      throw new ActionRequestError(403, 'Changing notification settings is not enabled. Add "notifications" to JIRA_WRITE_ACTIONS in .env.');
    }
    const change = parseNotificationChange(body);
    const started = Date.now();
    try {
      await this.perform(change);
      log.info('notification settings changed', { change: change.op, ms: Date.now() - started });
    } catch (error) {
      log.warn('notification settings change failed', { change: change.op, ms: Date.now() - started });
      throw error;
    }
    return this.read();
  }

  private async perform(change: NotificationChange): Promise<void> {
    switch (change.op) {
      case 'addContact': return this.source.addContact(change.method, change.to);
      case 'updateContact': return this.source.updateContact(change.id, change.to);
      case 'setContactEnabled': return this.source.setContactEnabled(change.id, change.enabled);
      case 'deleteContact': return this.source.deleteContact(change.id);
      case 'addRule': {
        const schedule = SCHEDULE_EVENTS.includes(change.event);
        await this.source.addRule({ name: change.name, event: change.event, enabled: true, ...(schedule ? { notificationTime: ['just-before'] } : {}) });
        return;
      }
      case 'updateRule': return this.updateRule(change);
      case 'deleteRule': return this.source.deleteRule(change.id);
      case 'addStep': {
        const delayed = this.delayed(await this.rule(change.ruleId), change.sendAfter);
        const contact = (await this.source.contacts()).find((c) => c.id === change.contactId);
        if (!contact) throw new ActionRequestError(404, 'That contact method no longer exists. Reload the page.');
        return this.source.addStep(change.ruleId, { method: contact.method, to: contact.to, ...(delayed ? { sendAfter: change.sendAfter } : {}) });
      }
      case 'updateStep': {
        if (change.sendAfter === undefined && change.enabled === undefined) throw new ActionRequestError(400, 'Nothing to change.');
        if (change.sendAfter !== undefined) this.delayed(await this.rule(change.ruleId), change.sendAfter);
        return this.source.updateStep(change.ruleId, change.id, { sendAfter: change.sendAfter, enabled: change.enabled });
      }
      case 'deleteStep': return this.source.deleteStep(change.ruleId, change.id);
    }
  }

  /** Whether this rule's steps take a delay. A delay on another rule is refused, as Jira would. */
  private delayed(rule: NotificationRule, sendAfter: number): boolean {
    const delayed = DELAYED_EVENTS.includes(rule.event);
    if (!delayed && sendAfter > 0) throw new ActionRequestError(400, 'Only new alert and assigned alert rules can wait before notifying.');
    return delayed;
  }

  private async rule(id: string): Promise<NotificationRule> {
    const rule = (await this.source.rules()).rules.find((r) => r.id === id);
    if (!rule) throw new ActionRequestError(404, 'That rule no longer exists. Reload the page.');
    return rule;
  }

  private async updateRule(change: Extract<NotificationChange, { op: 'updateRule' }>): Promise<void> {
    const rule = await this.rule(change.id);
    const schedule = SCHEDULE_EVENTS.includes(rule.event);
    if (change.notificationTime && !schedule) throw new ActionRequestError(400, 'Only schedule start and end rules have a notification time.');
    if (change.repeat && rule.event !== 'create-alert') throw new ActionRequestError(400, 'Only new alert rules repeat.');
    const fields: RuleFields = {
      name: change.name ?? rule.name,
      event: rule.event,
      enabled: change.enabled ?? rule.enabled,
      ...(change.criteria ? { criteria: change.criteria } : {}),
      ...(change.timeRestriction ? { timeRestriction: change.timeRestriction } : {}),
      ...(change.notificationTime ? { notificationTime: deduplicate(change.notificationTime) } : {}),
      ...(change.repeat ? { repeat: change.repeat } : {}),
    };
    if (change.timeRestriction === null && rule.timeRestriction) {
      await this.replaceWithoutTimeRestriction(rule, fields);
      return;
    }
    await this.source.updateRule(rule.id, fields);
  }

  /**
   * Jira keeps a rule's time restriction on every update (null, {} and an
   * empty list are refused or ignored), so removing it means a new rule with
   * the same settings and steps, then deleting the old one. The copy goes to
   * the end of the list: Jira's `order` counts across all rules and does not
   * place a new rule reliably. If the old rule cannot be deleted, the copy is
   * removed again.
   */
  private async replaceWithoutTimeRestriction(rule: NotificationRule, fields: RuleFields): Promise<void> {
    const copy = await this.source.addRule({
      ...fields,
      criteria: fields.criteria ?? rule.criteria,
      notificationTime: fields.notificationTime ?? (rule.notificationTime.length > 0 ? rule.notificationTime : undefined),
      repeat: fields.repeat ?? rule.repeat ?? undefined,
      steps: rule.steps.map((s) => ({ method: s.method, to: s.to, enabled: s.enabled, ...(DELAYED_EVENTS.includes(rule.event) ? { sendAfter: s.sendAfter } : {}) })),
    });
    try {
      await this.source.deleteRule(rule.id);
    } catch (error) {
      await this.source.deleteRule(copy.id).catch(() => undefined);
      throw error;
    }
  }
}

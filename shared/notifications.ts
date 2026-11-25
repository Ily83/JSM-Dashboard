/**
 * The signed-in user's own alert notification settings in Jira Service
 * Management Operations: contact methods and notification rules, as on
 * Jira's "Personal settings > Alert notifications" page.
 *
 * Documented endpoints (Operations REST API), all answered at once:
 *   GET/POST          /v1/users/contacts
 *   PATCH/DELETE      /v1/users/contacts/{id}            { to }
 *   PATCH             /v1/users/contacts/{id}/activate | deactivate
 *   GET/POST          /v1/notification-rules
 *   PATCH/DELETE      /v1/notification-rules/{id}
 *   POST              /v1/notification-rules/{ruleId}/steps
 *   PATCH/DELETE      /v1/notification-rules/{ruleId}/steps/{id}
 * Changing them needs "notifications" in JIRA_WRITE_ACTIONS. Do Not Disturb
 * and registering a phone for mobile push are not in the public API.
 */

/** Contact methods a user can add. Mobile push contacts are added by the Jira mobile app. */
export const NEW_CONTACT_METHODS = ['email', 'sms', 'voice'] as const;
export type NewContactMethod = (typeof NEW_CONTACT_METHODS)[number];
export type ContactMethod = NewContactMethod | 'mobile';
export const CONTACT_METHODS: readonly ContactMethod[] = [...NEW_CONTACT_METHODS, 'mobile'];

export const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = {
  email: 'Email',
  sms: 'SMS',
  voice: 'Voice',
  mobile: 'Mobile push',
};

/** The events a notification rule reacts to, in the order Jira lists them. */
export const NOTIFICATION_EVENTS = [
  'create-alert',
  'acknowledged-alert',
  'closed-alert',
  'assigned-alert',
  'add-note',
  'schedule-start',
  'schedule-end',
  'incoming-call-routing',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_EVENT_LABEL: Record<NotificationEvent, string> = {
  'create-alert': 'New alert',
  'acknowledged-alert': 'Acknowledged alert',
  'closed-alert': 'Closed alert',
  'assigned-alert': 'Assigned alert',
  'add-note': 'Add note',
  'schedule-start': 'Schedule start',
  'schedule-end': 'Schedule end',
  'incoming-call-routing': 'Incoming call routing',
};

/** The only events whose steps can wait before notifying (Jira refuses `sendAfter` on the others). */
export const DELAYED_EVENTS: readonly NotificationEvent[] = ['create-alert', 'assigned-alert'];

/** Schedule start and end rules say when, relative to the on-call change, they notify. Jira requires at least one. */
export const SCHEDULE_EVENTS: readonly NotificationEvent[] = ['schedule-start', 'schedule-end'];
export const SCHEDULE_TIMES = ['just-before', '15-minutes-ago', '1-hour-ago', '1-day-ago'] as const;
export type ScheduleTime = (typeof SCHEDULE_TIMES)[number];
export const SCHEDULE_TIME_LABEL: Record<ScheduleTime, string> = {
  'just-before': 'Just before',
  '15-minutes-ago': '15 minutes before',
  '1-hour-ago': '1 hour before',
  '1-day-ago': '1 day before',
};

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface TimeOfDay {
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
}

export type TimeRestriction =
  | { type: 'time-of-day'; restriction: TimeOfDay }
  | { type: 'weekday-and-time-of-day'; restrictions: Array<TimeOfDay & { startDay: Weekday; endDay: Weekday }> };

export interface RuleCondition {
  field: string;
  key?: string;
  not: boolean;
  operation: string;
  expectedValue: string;
}

/** Which alerts a rule applies to. Simple conditions are shown and kept; new filters are written as a query. */
export type RuleCriteria =
  | { type: 'match-all' }
  | { type: 'match-any-condition' | 'match-all-conditions'; conditions: RuleCondition[] }
  | { type: 'advanced-query'; query: string };

export interface Contact {
  id: string;
  method: ContactMethod;
  /** The address or number. Personal data: shown to the signed-in user only, never logged. */
  to: string;
  enabled: boolean;
}

export interface NotificationStep {
  id: string;
  method: ContactMethod;
  to: string;
  /** Minutes after the event; always 0 outside DELAYED_EVENTS. */
  sendAfter: number;
  enabled: boolean;
}

export interface NotificationRule {
  id: string;
  name: string;
  event: NotificationEvent;
  enabled: boolean;
  order: number;
  criteria: RuleCriteria;
  timeRestriction: TimeRestriction | null;
  /** Schedule start and end rules only. */
  notificationTime: ScheduleTime[];
  /** Repeat the steps every `loopAfter` minutes until the alert is seen. */
  repeat: { enabled: boolean; loopAfter: number } | null;
  steps: NotificationStep[];
}

export interface NotificationsResponse {
  contacts: Contact[];
  rules: NotificationRule[];
  /** "notifications" is enabled in JIRA_WRITE_ACTIONS. */
  writable: boolean;
  /** Rules of an event this app does not know, kept as they are. */
  otherRules: number;
}

export const NOTIFICATION_NAME_MAX = 100;
export const CONTACT_TO_MAX = 200;
export const QUERY_MAX = 1000;
export const SEND_AFTER_MAX = 1440;
export const LOOP_AFTER_MAX = 1440;
export const STEP_DELAYS = [0, 1, 5, 10, 15, 30, 60] as const;

/** One change, sent as one request. The answer is the settings as Jira holds them afterwards. */
export type NotificationChange =
  | { op: 'addContact'; method: NewContactMethod; to: string }
  | { op: 'updateContact'; id: string; to: string }
  | { op: 'setContactEnabled'; id: string; enabled: boolean }
  | { op: 'deleteContact'; id: string }
  | { op: 'addRule'; event: NotificationEvent; name: string }
  | {
      op: 'updateRule';
      id: string;
      name?: string;
      enabled?: boolean;
      criteria?: { type: 'match-all' } | { type: 'advanced-query'; query: string };
      /** null removes the time limit. Jira cannot remove one in place, so the rule is replaced by a copy at the end of its list. */
      timeRestriction?: TimeRestriction | null;
      notificationTime?: ScheduleTime[];
      repeat?: { enabled: boolean; loopAfter: number };
    }
  | { op: 'deleteRule'; id: string }
  | { op: 'addStep'; ruleId: string; contactId: string; sendAfter: number }
  | { op: 'updateStep'; ruleId: string; id: string; sendAfter?: number; enabled?: boolean }
  | { op: 'deleteStep'; ruleId: string; id: string };

const pad = (n: number) => String(n).padStart(2, '0');
export const formatTimeOfDay = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;
const day = (d: Weekday) => d.charAt(0).toUpperCase() + d.slice(1, 3);

/** "08:00–18:00 every day", or "Mon 09:00 – Fri 17:00". */
export function describeTimeRestriction(restriction: TimeRestriction | null): string {
  if (!restriction) return 'Any time';
  if (restriction.type === 'time-of-day') {
    const r = restriction.restriction;
    return `${formatTimeOfDay(r.startHour, r.startMin)}–${formatTimeOfDay(r.endHour, r.endMin)} every day`;
  }
  return restriction.restrictions
    .map((r) => `${day(r.startDay)} ${formatTimeOfDay(r.startHour, r.startMin)} – ${day(r.endDay)} ${formatTimeOfDay(r.endHour, r.endMin)}`)
    .join(', ');
}

/** "All alerts", the query, or the simple conditions in words. */
export function describeCriteria(criteria: RuleCriteria): string {
  if (criteria.type === 'match-all') return 'All alerts';
  if (criteria.type === 'advanced-query') return criteria.query;
  const parts = criteria.conditions.map((c) =>
    [c.field, c.key, c.not ? 'not' : '', c.operation.replaceAll('-', ' '), c.expectedValue ? `“${c.expectedValue}”` : ''].filter(Boolean).join(' '));
  return parts.join(criteria.type === 'match-any-condition' ? ' or ' : ' and ') || 'All alerts';
}

/** "immediately", "after 5 min". */
export const describeDelay = (minutes: number) => (minutes === 0 ? 'Immediately' : `After ${minutes} min`);

import {
  formatTimeOfDay, type NotificationChange, type NotificationEvent, type NotificationRule, type ScheduleTime, type TimeOfDay,
} from '../../shared/notifications';

/**
 * The rule editor's form (NotificationsView): its starting values from a
 * rule, and the one change that turns the rule into what the form shows.
 * Only what differs is sent, so Jira keeps everything else.
 */

export type RuleFilter = 'all' | 'query' | 'keep';
export type RuleWindow = 'any' | 'daily' | 'keep';

export interface RuleForm {
  name: string;
  filter: RuleFilter;
  query: string;
  window: RuleWindow;
  /** "HH:MM" */
  from: string;
  to: string;
  times: ScheduleTime[];
  repeat: boolean;
  loopAfter: number;
}

export type RuleUpdate = Extract<NotificationChange, { op: 'updateRule' }>;

const dailyWindow = (rule: NotificationRule): TimeOfDay | null =>
  rule.timeRestriction?.type === 'time-of-day' ? rule.timeRestriction.restriction : null;

function initialFilter(rule: NotificationRule): RuleFilter {
  if (rule.criteria.type === 'advanced-query') return 'query';
  if (rule.criteria.type === 'match-all') return 'all';
  // Simple conditions are kept as they are unless replaced.
  return 'keep';
}

function initialWindow(rule: NotificationRule): RuleWindow {
  if (rule.timeRestriction === null) return 'any';
  return dailyWindow(rule) ? 'daily' : 'keep';
}

export function initialRuleForm(rule: NotificationRule): RuleForm {
  const daily = dailyWindow(rule);
  return {
    name: rule.name,
    filter: initialFilter(rule),
    query: rule.criteria.type === 'advanced-query' ? rule.criteria.query : '',
    window: initialWindow(rule),
    from: daily ? formatTimeOfDay(daily.startHour, daily.startMin) : '08:00',
    to: daily ? formatTimeOfDay(daily.endHour, daily.endMin) : '18:00',
    times: rule.notificationTime,
    repeat: rule.repeat?.enabled ?? false,
    loopAfter: rule.repeat?.loopAfter || 5,
  };
}

function parseTime(value: string): { hour: number; minute: number } {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return { hour, minute };
}

function criteriaChange(rule: NotificationRule, form: RuleForm): Pick<RuleUpdate, 'criteria'> {
  if (form.filter === 'all') return rule.criteria.type === 'match-all' ? {} : { criteria: { type: 'match-all' } };
  const query = form.query.trim();
  if (form.filter !== 'query' || !query) return {};
  if (rule.criteria.type === 'advanced-query' && rule.criteria.query === query) return {};
  return { criteria: { type: 'advanced-query', query } };
}

function windowChange(rule: NotificationRule, form: RuleForm): Pick<RuleUpdate, 'timeRestriction'> {
  if (form.window === 'any') return rule.timeRestriction === null ? {} : { timeRestriction: null };
  if (form.window !== 'daily') return {};
  const start = parseTime(form.from);
  const end = parseTime(form.to);
  const next: TimeOfDay = { startHour: start.hour, startMin: start.minute, endHour: end.hour, endMin: end.minute };
  const daily = dailyWindow(rule);
  if (daily && JSON.stringify(next) === JSON.stringify(daily)) return {};
  return { timeRestriction: { type: 'time-of-day', restriction: next } };
}

const sorted = (times: readonly ScheduleTime[]) => [...times].sort((a, b) => a.localeCompare(b)).join(',');

function timesChange(rule: NotificationRule, form: RuleForm): Pick<RuleUpdate, 'notificationTime'> {
  if (rule.notificationTime.length === 0 && !isScheduleEvent(rule.event)) return {};
  if (form.times.length === 0 || sorted(form.times) === sorted(rule.notificationTime)) return {};
  return { notificationTime: form.times };
}

function repeatChange(rule: NotificationRule, form: RuleForm): Pick<RuleUpdate, 'repeat'> {
  if (rule.event !== 'create-alert') return {};
  const was = rule.repeat?.enabled ?? false;
  if (form.repeat === was && (!form.repeat || form.loopAfter === rule.repeat?.loopAfter)) return {};
  return { repeat: { enabled: form.repeat, loopAfter: form.repeat ? form.loopAfter : 0 } };
}

const isScheduleEvent = (event: NotificationEvent) => event === 'schedule-start' || event === 'schedule-end';

/** The change to send, or null when the form changes nothing. */
export function ruleChange(rule: NotificationRule, form: RuleForm): RuleUpdate | null {
  const name = form.name.trim();
  const change: RuleUpdate = {
    op: 'updateRule',
    id: rule.id,
    ...(name && name !== rule.name ? { name } : {}),
    ...criteriaChange(rule, form),
    ...windowChange(rule, form),
    ...timesChange(rule, form),
    ...repeatChange(rule, form),
  };
  return Object.keys(change).length > 2 ? change : null;
}

/** "start" or "end", for schedule rules. */
export const scheduleEdge = (event: NotificationEvent) => (event === 'schedule-start' ? 'start' : 'end');

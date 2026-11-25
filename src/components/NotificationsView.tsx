import { useState, type ReactNode, type SubmitEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MessageSquare, Pencil, Phone, Plus, SlidersHorizontal, Smartphone, Trash2, X, type LucideIcon } from 'lucide-react';
import {
  CONTACT_METHOD_LABEL, DELAYED_EVENTS, NEW_CONTACT_METHODS, NOTIFICATION_EVENTS, NOTIFICATION_EVENT_LABEL, SCHEDULE_EVENTS, SCHEDULE_TIMES,
  SCHEDULE_TIME_LABEL, STEP_DELAYS, describeCriteria, describeDelay, describeTimeRestriction,
  type Contact, type ContactMethod, type NewContactMethod, type NotificationChange, type NotificationEvent,
  type NotificationRule, type NotificationStep, type NotificationsResponse, type ScheduleTime,
} from '../../shared/notifications';
import { changeNotifications, fetchNotifications } from '../api/client';
import { cn } from '../lib/cn';
import { initialRuleForm, ruleChange, scheduleEdge, type RuleForm } from '../lib/notificationRuleForm';
import { button, iconButton, primaryButton, quietButton } from './ui/buttons';

const QUERY_KEY = ['notifications'];
const field = 'h-7 min-w-0 rounded-md border border-line-strong bg-bg px-2 text-xs placeholder:text-subtle disabled:opacity-60';
const METHOD_ICON: Record<ContactMethod, LucideIcon> = { email: Mail, sms: MessageSquare, voice: Phone, mobile: Smartphone };
/** Events about an alert, which a rule can narrow down to some alerts. */
const ALERT_EVENTS: ReadonlySet<NotificationEvent> = new Set(['create-alert', 'acknowledged-alert', 'closed-alert', 'assigned-alert', 'add-note']);

type Apply = (change: NotificationChange) => Promise<unknown>;

function Switch({ checked, label, disabled, onChange }: Readonly<{ checked: boolean; label: string; disabled: boolean; onChange: (checked: boolean) => void }>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative h-5 w-9 flex-none rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={cn('absolute top-0.5 size-4 rounded-full bg-panel shadow transition-[left] motion-reduce:transition-none', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

function Card({ id, title, children }: Readonly<{ id: string; title: string; children: ReactNode }>) {
  return (
    <section aria-labelledby={`notifications-${id}`} className="rounded-lg border border-line bg-panel">
      <h2 id={`notifications-${id}`} className="flex h-10 items-center border-b border-line px-4 text-[13px] font-semibold">{title}</h2>
      <div className="grid gap-4 p-4">{children}</div>
    </section>
  );
}

/** Asks once before a delete; the second click deletes. */
function DeleteButton({ label, disabled, onDelete }: Readonly<{ label: string; disabled: boolean; onDelete: () => void }>) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={iconButton} aria-label={`Delete ${label}`} data-tip="Delete" disabled={disabled} onClick={() => setAsking(true)}>
        <Trash2 size={14} aria-hidden />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button type="button" className={button} onClick={() => { setAsking(false); onDelete(); }}>Delete</button>
      <button type="button" className={quietButton} onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}

// ---- Contact methods ----------------------------------------------------------

function ContactRow({ contact, writable, apply }: Readonly<{ contact: Contact; writable: boolean; apply: Apply }>) {
  const [editing, setEditing] = useState<string | null>(null);
  const label = `${CONTACT_METHOD_LABEL[contact.method]} ${contact.to}`;
  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editing === null || editing.trim() === contact.to) { setEditing(null); return; }
    void apply({ op: 'updateContact', id: contact.id, to: editing.trim() }).then(() => setEditing(null), () => undefined);
  };
  return (
    <li className="flex min-h-8 flex-wrap items-center gap-2">
      {editing === null ? (
        <span className={cn('min-w-0 flex-1 break-all', !contact.enabled && 'text-subtle')}>{contact.to}</span>
      ) : (
        <form onSubmit={save} className="flex min-w-0 flex-1 items-center gap-1">
          <input aria-label={`New address for ${label}`} value={editing} onChange={(e) => setEditing(e.target.value)} className={cn(field, 'flex-1')} autoFocus />
          <button type="submit" className={button}>Save</button>
          <button type="button" className={quietButton} onClick={() => setEditing(null)}>Cancel</button>
        </form>
      )}
      <Switch checked={contact.enabled} label={`Use ${label}`} disabled={!writable}
        onChange={(enabled) => void apply({ op: 'setContactEnabled', id: contact.id, enabled }).catch(() => undefined)} />
      {contact.method !== 'mobile' && editing === null && (
        <button type="button" className={iconButton} aria-label={`Edit ${label}`} data-tip="Edit" disabled={!writable} onClick={() => setEditing(contact.to)}>
          <Pencil size={14} aria-hidden />
        </button>
      )}
      <DeleteButton label={label} disabled={!writable} onDelete={() => void apply({ op: 'deleteContact', id: contact.id }).catch(() => undefined)} />
    </li>
  );
}

const ADD_LABEL: Record<NewContactMethod, string> = { email: 'Add email address', sms: 'Add SMS number', voice: 'Add voice number' };

function AddContact({ method, apply }: Readonly<{ method: NewContactMethod; apply: Apply }>) {
  const [value, setValue] = useState<string | null>(null);
  if (value === null) {
    return (
      <button type="button" className={cn(quietButton, 'justify-self-start')} onClick={() => setValue('')}>
        <Plus size={14} aria-hidden />
        {ADD_LABEL[method]}
      </button>
    );
  }
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim()) void apply({ op: 'addContact', method, to: value.trim() }).then(() => setValue(null), () => undefined);
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <input
        aria-label={`New ${CONTACT_METHOD_LABEL[method]} contact`}
        type={method === 'email' ? 'email' : 'tel'}
        autoComplete={method === 'email' ? 'email' : 'tel'}
        placeholder={method === 'email' ? 'name@example.com' : 'Number with country code'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={cn(field, 'w-64')}
        autoFocus
      />
      <button type="submit" className={button} disabled={!value.trim()}>Add</button>
      <button type="button" className={quietButton} onClick={() => setValue(null)}>Cancel</button>
    </form>
  );
}

function ContactMethods({ data, apply }: Readonly<{ data: NotificationsResponse; apply: Apply }>) {
  const mobile = data.contacts.filter((c) => c.method === 'mobile');
  return (
    <Card id="contacts" title="Contact methods">
      {NEW_CONTACT_METHODS.map((method) => (
        <div key={method} className="grid gap-1">
          <h3 className="text-xs font-semibold text-muted">{CONTACT_METHOD_LABEL[method]}</h3>
          <ul className="grid gap-1" aria-label={`${CONTACT_METHOD_LABEL[method]} contacts`}>
            {data.contacts.filter((c) => c.method === method).map((contact) => (
              <ContactRow key={contact.id} contact={contact} writable={data.writable} apply={apply} />
            ))}
          </ul>
          {data.writable && <AddContact method={method} apply={apply} />}
        </div>
      ))}
      <div className="grid gap-1">
        <h3 className="text-xs font-semibold text-muted">{CONTACT_METHOD_LABEL.mobile}</h3>
        {mobile.length > 0 ? (
          <ul className="grid gap-1" aria-label="Mobile push contacts">
            {mobile.map((contact) => <ContactRow key={contact.id} contact={contact} writable={data.writable} apply={apply} />)}
          </ul>
        ) : (
          <p className="text-xs text-subtle">Sign in to the Jira mobile app on your phone. It then appears here and can be added to rules.</p>
        )}
      </div>
    </Card>
  );
}

// ---- Notification rules -----------------------------------------------------------

function StepRow({ rule, step, writable, apply }: Readonly<{ rule: NotificationRule; step: NotificationStep; writable: boolean; apply: Apply }>) {
  const Icon = METHOD_ICON[step.method];
  const label = `${CONTACT_METHOD_LABEL[step.method]} ${step.to}`;
  const delays = STEP_DELAYS.includes(step.sendAfter as (typeof STEP_DELAYS)[number]) ? STEP_DELAYS : [...STEP_DELAYS, step.sendAfter].sort((a, b) => a - b);
  return (
    <li className="flex min-h-8 flex-wrap items-center gap-2 rounded-md bg-bg px-2 py-1">
      <span className="hidden text-xs text-subtle sm:inline">Notify me via</span>
      <Icon size={14} aria-hidden className="flex-none text-muted" />
      <span title={step.to} className={cn('min-w-[8rem] flex-1 truncate', !step.enabled && 'text-subtle line-through')}>{step.to}</span>
      {DELAYED_EVENTS.includes(rule.event) && (
        <select aria-label={`When to notify ${label}`} value={step.sendAfter} disabled={!writable} className={field}
          onChange={(e) => void apply({ op: 'updateStep', ruleId: rule.id, id: step.id, sendAfter: Number(e.target.value) }).catch(() => undefined)}>
          {delays.map((minutes) => <option key={minutes} value={minutes}>{describeDelay(minutes)}</option>)}
        </select>
      )}
      <Switch checked={step.enabled} label={`Notify via ${label}`} disabled={!writable}
        onChange={(enabled) => void apply({ op: 'updateStep', ruleId: rule.id, id: step.id, enabled }).catch(() => undefined)} />
      {writable && (
        <button type="button" className={iconButton} aria-label={`Remove ${label} from ${rule.name}`} data-tip="Remove"
          onClick={() => void apply({ op: 'deleteStep', ruleId: rule.id, id: step.id }).catch(() => undefined)}>
          <X size={14} aria-hidden />
        </button>
      )}
    </li>
  );
}

function AddStep({ rule, contacts, apply }: Readonly<{ rule: NotificationRule; contacts: Contact[]; apply: Apply }>) {
  const [contactId, setContactId] = useState<string | null>(null);
  const usable = contacts.filter((c) => c.enabled);
  if (contactId === null) {
    return (
      <button type="button" className={cn(quietButton, 'justify-self-start')} disabled={usable.length === 0} onClick={() => setContactId(usable[0]?.id ?? null)}>
        <Plus size={14} aria-hidden />
        Add notification method
      </button>
    );
  }
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    void apply({ op: 'addStep', ruleId: rule.id, contactId, sendAfter: 0 }).then(() => setContactId(null), () => undefined);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-1">
      <select aria-label={`Contact to add to ${rule.name}`} value={contactId} onChange={(e) => setContactId(e.target.value)} className={cn(field, 'max-w-full')}>
        {usable.map((c) => <option key={c.id} value={c.id}>{`${CONTACT_METHOD_LABEL[c.method]} · ${c.to}`}</option>)}
      </select>
      <button type="submit" className={button}>Add</button>
      <button type="button" className={quietButton} onClick={() => setContactId(null)}>Cancel</button>
    </form>
  );
}

/** The rule's settings beyond its steps: name, which alerts, when, repeat and schedule timing. */
function RuleEditor({ rule, apply, onDone }: Readonly<{ rule: NotificationRule; apply: Apply; onDone: () => void }>) {
  const [form, setForm] = useState<RuleForm>(() => initialRuleForm(rule));
  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggleTime = (time: ScheduleTime, on: boolean) =>
    setForm((current) => ({ ...current, times: on ? [...current.times, time] : current.times.filter((t) => t !== time) }));
  const { filter, query, window, times, repeat } = form;
  const simpleConditions = rule.criteria.type === 'match-any-condition' || rule.criteria.type === 'match-all-conditions';
  const schedule = SCHEDULE_EVENTS.includes(rule.event);
  const removesWindow = window === 'any' && rule.timeRestriction !== null;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const change = ruleChange(rule, form);
    if (change) void apply(change).then(onDone, () => undefined);
    else onDone();
  };

  const radio = (group: string, value: string, checked: boolean, onChange: () => void, label: ReactNode) => (
    <label className="flex min-h-7 items-center gap-2">
      <input type="radio" name={`${group}-${rule.id}`} value={value} checked={checked} onChange={onChange} className="accent-accent" />
      {label}
    </label>
  );

  return (
    <form onSubmit={submit} aria-label={`Edit ${rule.name}`} className="grid gap-3 rounded-md border border-line p-3">
      <label className="grid gap-1">
        <span className="text-xs font-semibold text-muted">Name</span>
        <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} className={cn(field, 'w-full max-w-sm')} />
      </label>
      {ALERT_EVENTS.has(rule.event) && (
        <fieldset className="grid gap-0.5">
          <legend className="mb-1 text-xs font-semibold text-muted">Alerts</legend>
          {radio('filter', 'all', filter === 'all', () => set('filter', 'all'), 'All alerts')}
          {simpleConditions && radio('filter', 'keep', filter === 'keep', () => set('filter', 'keep'), <span className="break-words">Keep: {describeCriteria(rule.criteria)}</span>)}
          {radio('filter', 'query', filter === 'query', () => set('filter', 'query'), 'Alerts matching a query')}
          {filter === 'query' && (
            <input aria-label="Alert query" value={query} onChange={(e) => set('query', e.target.value)} placeholder="priority:P1 AND tags:prod"
              spellCheck={false} maxLength={1000} className={cn(field, 'ml-6 w-full max-w-lg font-mono')} />
          )}
        </fieldset>
      )}
      <fieldset className="grid gap-0.5">
        <legend className="mb-1 text-xs font-semibold text-muted">When</legend>
        {radio('window', 'any', window === 'any', () => set('window', 'any'), 'Any time')}
        {rule.timeRestriction?.type === 'weekday-and-time-of-day' &&
          radio('window', 'keep', window === 'keep', () => set('window', 'keep'), <span>Keep: {describeTimeRestriction(rule.timeRestriction)}</span>)}
        {radio('window', 'daily', window === 'daily', () => set('window', 'daily'), 'Every day between')}
        {window === 'daily' && (
          <span className="ml-6 flex items-center gap-1">
            <input type="time" aria-label="From" value={form.from} onChange={(e) => set('from', e.target.value)} required className={field} />
            <span className="text-xs text-muted">and</span>
            <input type="time" aria-label="To" value={form.to} onChange={(e) => set('to', e.target.value)} required className={field} />
          </span>
        )}
        {removesWindow && <p className="ml-6 text-xs text-muted">Jira replaces the rule with a copy at the end of the list to remove the time limit.</p>}
      </fieldset>
      {schedule && (
        <fieldset className="grid gap-0.5">
          <legend className="mb-1 text-xs font-semibold text-muted">Notify</legend>
          {SCHEDULE_TIMES.map((time) => (
            <label key={time} className="flex min-h-7 items-center gap-2">
              <input type="checkbox" checked={times.includes(time)} className="accent-accent" onChange={(e) => toggleTime(time, e.target.checked)} />
              {`${SCHEDULE_TIME_LABEL[time]} the ${scheduleEdge(rule.event)}`}
            </label>
          ))}
        </fieldset>
      )}
      {rule.event === 'create-alert' && (
        <label className="flex min-h-7 flex-wrap items-center gap-2">
          <input type="checkbox" checked={repeat} onChange={(e) => set('repeat', e.target.checked)} className="accent-accent" />
          <span>Repeat until the alert is seen, every</span>
          <input type="number" aria-label="Repeat every minutes" min={1} max={1440} value={form.loopAfter} disabled={!repeat}
            onChange={(e) => set('loopAfter', Math.max(1, Math.min(1440, Number(e.target.value) || 1)))} className={cn(field, 'w-16')} />
          <span>min</span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" className={primaryButton} disabled={(schedule && times.length === 0) || (filter === 'query' && !query.trim())}>Save rule</button>
        <button type="button" className={quietButton} onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function RuleItem({ rule, data, apply }: Readonly<{ rule: NotificationRule; data: NotificationsResponse; apply: Apply }>) {
  const [editing, setEditing] = useState(false);
  const details = [
    rule.criteria.type === 'match-all' ? null : describeCriteria(rule.criteria),
    rule.timeRestriction ? describeTimeRestriction(rule.timeRestriction) : null,
    rule.notificationTime.length > 0 ? `${rule.notificationTime.map((t) => SCHEDULE_TIME_LABEL[t]).join(', ')} the ${scheduleEdge(rule.event)}` : null,
    rule.repeat?.enabled ? `Repeats every ${rule.repeat.loopAfter} min until seen` : null,
  ].filter((d): d is string => d !== null);
  return (
    <li className="grid gap-1.5 rounded-md border border-line p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Switch checked={rule.enabled} label={`Rule ${rule.name}`} disabled={!data.writable}
          onChange={(enabled) => void apply({ op: 'updateRule', id: rule.id, enabled }).catch(() => undefined)} />
        <span className={cn('min-w-0 flex-1 font-semibold', !rule.enabled && 'text-subtle')}>{rule.name}</span>
        {data.writable && !editing && (
          <button type="button" className={iconButton} aria-label={`Edit rule ${rule.name}`} data-tip="Edit rule" onClick={() => setEditing(true)}>
            <SlidersHorizontal size={14} aria-hidden />
          </button>
        )}
        <DeleteButton label={`rule ${rule.name}`} disabled={!data.writable} onDelete={() => void apply({ op: 'deleteRule', id: rule.id }).catch(() => undefined)} />
      </div>
      {details.length > 0 && <p className="break-words text-xs text-muted">{details.join(' · ')}</p>}
      {editing && <RuleEditor rule={rule} apply={apply} onDone={() => setEditing(false)} />}
      <ul className="grid gap-1" aria-label={`Notification methods of ${rule.name}`}>
        {rule.steps.map((step) => <StepRow key={step.id} rule={rule} step={step} writable={data.writable} apply={apply} />)}
      </ul>
      {rule.steps.length === 0 && <p className="text-xs text-subtle">No notification method: this rule notifies nobody.</p>}
      {data.writable && <AddStep rule={rule} contacts={data.contacts} apply={apply} />}
    </li>
  );
}

function AddRule({ event, apply }: Readonly<{ event: NotificationEvent; apply: Apply }>) {
  const [name, setName] = useState<string | null>(null);
  if (name === null) {
    return (
      <button type="button" className={iconButton} aria-label={`Add a ${NOTIFICATION_EVENT_LABEL[event]} rule`} data-tip="Add rule"
        onClick={() => setName(NOTIFICATION_EVENT_LABEL[event])}>
        <Plus size={14} aria-hidden />
      </button>
    );
  }
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (name.trim()) void apply({ op: 'addRule', event, name: name.trim() }).then(() => setName(null), () => undefined);
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <input aria-label={`Name of the new ${NOTIFICATION_EVENT_LABEL[event]} rule`} value={name} onChange={(e) => setName(e.target.value)}
        maxLength={100} className={cn(field, 'w-48')} autoFocus />
      <button type="submit" className={button} disabled={!name.trim()}>Add</button>
      <button type="button" className={quietButton} onClick={() => setName(null)}>Cancel</button>
    </form>
  );
}

function NotificationRules({ data, apply }: Readonly<{ data: NotificationsResponse; apply: Apply }>) {
  return (
    <Card id="rules" title="Notification rules">
      {NOTIFICATION_EVENTS.map((event) => {
        const rules = data.rules.filter((r) => r.event === event);
        return (
          <div key={event} className="grid gap-2">
            <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-muted">
                {NOTIFICATION_EVENT_LABEL[event]} <span className="tabular-nums text-subtle">{rules.length}</span>
              </h3>
              {data.writable && <AddRule event={event} apply={apply} />}
            </div>
            {rules.length > 0 && (
              <ul className="grid gap-2" aria-label={`${NOTIFICATION_EVENT_LABEL[event]} rules`}>
                {rules.map((rule) => <RuleItem key={rule.id} rule={rule} data={data} apply={apply} />)}
              </ul>
            )}
          </div>
        );
      })}
      {data.otherRules > 0 && <p className="text-xs text-subtle">{data.otherRules} more rules of other kinds are only shown in Jira.</p>}
    </Card>
  );
}

/**
 * The signed-in user's own alert notification settings in Jira: contact
 * methods and notification rules. Changes need "notifications" in
 * JIRA_WRITE_ACTIONS; Do Not Disturb stays in Jira.
 */
export function NotificationsView() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: ({ signal }) => fetchNotifications(signal), refetchOnWindowFocus: false });
  const mutation = useMutation({
    mutationFn: changeNotifications,
    onSuccess: (data) => client.setQueryData(QUERY_KEY, data),
    // A refused change may have been half applied by Jira: show what Jira holds now.
    onError: () => void client.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  const apply: Apply = (change) => mutation.mutateAsync(change);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-3xl gap-3 p-4" aria-busy={mutation.isPending}>
        {query.data && !query.data.writable && (
          <p className="text-xs text-muted">Read-only. Add <code>notifications</code> to JIRA_WRITE_ACTIONS to change these settings.</p>
        )}
        {mutation.error && <p role="alert" className="rounded-md border border-crit/40 bg-crit-soft px-3 py-2 text-xs">{mutation.error.message}</p>}
        {query.isPending && <div className="grid gap-2" aria-busy="true"><div className="skeleton h-5 w-1/3" /><div className="skeleton h-5 w-2/3" /></div>}
        {query.error && <p role="alert" className="text-xs text-crit">{query.error.message}</p>}
        {query.data && (
          <>
            <ContactMethods data={query.data} apply={apply} />
            <NotificationRules data={query.data} apply={apply} />
          </>
        )}
      </div>
    </div>
  );
}

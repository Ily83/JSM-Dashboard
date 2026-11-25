// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationChange, NotificationsResponse } from '../../shared/notifications';
import { NotificationsView } from '../../src/components/NotificationsView';

const SETTINGS: NotificationsResponse = {
  writable: true,
  otherRules: 0,
  contacts: [
    { id: 'c-email', method: 'email', to: 'ops@example.com', enabled: true },
    { id: 'c-sms', method: 'sms', to: '+1 555 0100', enabled: false },
  ],
  rules: [
    {
      id: 'r-new', name: 'New Alert', event: 'create-alert', enabled: true, order: 0, criteria: { type: 'match-all' }, timeRestriction: null,
      notificationTime: [], repeat: { enabled: false, loopAfter: 0 },
      steps: [{ id: 's-1', method: 'email', to: 'ops@example.com', sendAfter: 0, enabled: true }],
    },
    {
      id: 'r-weekend', name: 'Weekend P1', event: 'create-alert', enabled: false, order: 1,
      criteria: { type: 'match-any-condition', conditions: [{ field: 'priority', not: false, operation: 'equals', expectedValue: 'P1' }] },
      timeRestriction: { type: 'weekday-and-time-of-day', restrictions: [{ startDay: 'friday', startHour: 18, startMin: 0, endDay: 'monday', endHour: 8, endMin: 0 }] },
      notificationTime: [], repeat: null, steps: [],
    },
    {
      id: 'r-start', name: 'Schedule Start', event: 'schedule-start', enabled: true, order: 0, criteria: { type: 'match-all' }, timeRestriction: null,
      notificationTime: ['just-before'], repeat: null, steps: [{ id: 's-2', method: 'email', to: 'ops@example.com', sendAfter: 0, enabled: true }],
    },
  ],
};

function setup(settings: NotificationsResponse = SETTINGS, answer?: (change: NotificationChange) => Response) {
  const sent: NotificationChange[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json(settings);
    expect(new Headers(init.headers).get('X-Alert-Center-Action')).toBe('1');
    const change = JSON.parse(String(init.body)) as NotificationChange;
    sent.push(change);
    return answer ? answer(change) : Response.json(settings);
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><NotificationsView /></QueryClientProvider>);
  return { sent, user: userEvent.setup() };
}

describe('NotificationsView', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists contact methods and rules by event, as Jira does', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Notification rules' });
    expect(within(screen.getByRole('list', { name: 'Email contacts' })).getByText('ops@example.com')).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'Use SMS +1 555 0100' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/Sign in to the Jira mobile app/)).toBeTruthy();
    const newAlert = screen.getByRole('list', { name: 'New alert rules' });
    expect(within(newAlert).getAllByRole('listitem').filter((li) => li.parentElement === newAlert)).toHaveLength(2);
    expect(screen.getByText('priority equals “P1” · Fri 18:00 – Mon 08:00')).toBeTruthy();
    expect(screen.getByText('Just before the start')).toBeTruthy();
    expect(screen.getByText('No notification method: this rule notifies nobody.')).toBeTruthy();
    // A delay is offered where Jira offers one (new and assigned alerts), not for schedule rules.
    expect(screen.getByRole('combobox', { name: 'When to notify Email ops@example.com' })).toBeTruthy();
    expect(screen.getAllByRole('combobox', { name: /When to notify/ })).toHaveLength(1);
  });

  it('sends one change per action', async () => {
    const { sent, user } = setup();
    await screen.findByRole('heading', { name: 'Notification rules' });
    await user.click(screen.getByRole('switch', { name: 'Use SMS +1 555 0100' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'When to notify Email ops@example.com' }), '5');
    await user.click(screen.getByRole('button', { name: 'Add voice number' }));
    await user.type(screen.getByRole('textbox', { name: 'New Voice contact' }), '+44 20 7946 0000');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const weekend = screen.getByRole('list', { name: 'Notification methods of Weekend P1' }).parentElement!;
    await user.click(within(weekend).getByRole('button', { name: 'Add notification method' }));
    await user.selectOptions(within(weekend).getByRole('combobox', { name: 'Contact to add to Weekend P1' }), 'c-email');
    await user.click(within(weekend).getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Delete rule Weekend P1' }));
    await user.click(within(weekend).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(sent).toHaveLength(5));
    expect(sent).toEqual([
      { op: 'setContactEnabled', id: 'c-sms', enabled: true },
      { op: 'updateStep', ruleId: 'r-new', id: 's-1', sendAfter: 5 },
      { op: 'addContact', method: 'voice', to: '+44 20 7946 0000' },
      { op: 'addStep', ruleId: 'r-weekend', contactId: 'c-email', sendAfter: 0 },
      { op: 'deleteRule', id: 'r-weekend' },
    ]);
  });

  it('edits a rule: filter, time limit and repeat, sending only what changed', async () => {
    const { sent, user } = setup();
    await screen.findByRole('heading', { name: 'Notification rules' });
    await user.click(screen.getByRole('button', { name: 'Edit rule Weekend P1' }));
    const form = screen.getByRole('form', { name: 'Edit Weekend P1' });
    expect(within(form).getByText('Keep: priority equals “P1”')).toBeTruthy();
    await user.click(within(form).getByRole('radio', { name: 'Alerts matching a query' }));
    await user.type(within(form).getByRole('textbox', { name: 'Alert query' }), 'priority:P1 AND tags:prod');
    await user.click(within(form).getByRole('radio', { name: 'Any time' }));
    expect(within(form).getByText('Jira replaces the rule with a copy at the end of the list to remove the time limit.')).toBeTruthy();
    await user.click(within(form).getByRole('checkbox', { name: /Repeat until the alert is seen/ }));
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      op: 'updateRule', id: 'r-weekend', criteria: { type: 'advanced-query', query: 'priority:P1 AND tags:prod' },
      timeRestriction: null, repeat: { enabled: true, loopAfter: 5 },
    });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Weekend P1' })).toBeNull());

    // A daily window, and nothing else changed.
    await user.click(screen.getByRole('button', { name: 'Edit rule New Alert' }));
    const second = screen.getByRole('form', { name: 'Edit New Alert' });
    await user.click(within(second).getByRole('radio', { name: 'Every day between' }));
    await user.click(within(second).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ op: 'updateRule', id: 'r-new', timeRestriction: { type: 'time-of-day', restriction: { startHour: 8, startMin: 0, endHour: 18, endMin: 0 } } });

    // Schedule rules need at least one notification time.
    await user.click(screen.getByRole('button', { name: 'Edit rule Schedule Start' }));
    const schedule = screen.getByRole('form', { name: 'Edit Schedule Start' });
    expect(within(schedule).queryByRole('radio', { name: 'All alerts' })).toBeNull();
    await user.click(within(schedule).getByRole('checkbox', { name: 'Just before the start' }));
    expect((within(schedule).getByRole('button', { name: 'Save rule' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows Jira’s refusal', async () => {
    const { user } = setup(SETTINGS, () => Response.json({ error: 'Jira refused the request: [abc] is not a valid phone number' }, { status: 400 }));
    await screen.findByRole('heading', { name: 'Notification rules' });
    await user.click(screen.getByRole('switch', { name: 'Use SMS +1 555 0100' }));
    expect((await screen.findByRole('alert')).textContent).toContain('is not a valid phone number');
  });

  it('is read-only when changes are not enabled', async () => {
    setup({ ...SETTINGS, writable: false, otherRules: 2 });
    await screen.findByRole('heading', { name: 'Notification rules' });
    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit rule/ })).toBeNull();
    expect((screen.getByRole('switch', { name: 'Rule New Alert' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('2 more rules of other kinds are only shown in Jira.')).toBeTruthy();
  });
});

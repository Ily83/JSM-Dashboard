import { describe, expect, it } from 'vitest';
import type { Alert } from '../shared/types';
import { parseHash, routeHash } from '../src/lib/router';
import { jiraChecklist, jiraHome, newWorkflow, previewWorkflow, sanitizeDraft, sanitizeWorkflows } from '../src/lib/workflows';

const draft = { ...newWorkflow('one'), name: 'Team alerts', teamId: 'team-a', teamName: 'Cloud team', source: 'ELK', message: 'CPU', action: 'slack' as const };
const alert = (id: string, props: Partial<Alert> = {}) => ({
  id, priority: 'P1', status: 'open', rawSource: 'ELK', source: 'Webhook integration', summary: 'CPU load',
  responders: [{ type: 'team', id: 'team-a' }], createdAt: 100, ...props,
}) as Alert;

describe('workflow drafts', () => {
  it('previews only current conditions, using raw source and typed team IDs', () => {
    const alerts = [
      alert('one'), alert('two', { createdAt: 200 }), alert('other-priority', { priority: 'P2' }),
      alert('not-team', { responders: [{ type: 'schedule', id: 'team-a' }] }),
      alert('not-source', { source: 'ELK', rawSource: null }), alert('different-case', { summary: 'cpu load' }),
    ];
    expect(previewWorkflow(alerts, draft).map(a => a.id)).toEqual(['two', 'one']);
    expect(previewWorkflow(alerts, { ...draft, trigger: 'updated' }).map(a => a.id)).toEqual(['two', 'one']);
    expect(previewWorkflow(alerts, { ...draft, status: 'closed' })).toEqual([]);
  });

  it('allows only known triggers and actions and does not widen invalid scope or priority', () => {
    expect(sanitizeDraft({ ...draft, trigger: 'arbitrary' })).toBeNull();
    expect(sanitizeDraft({ ...draft, action: 'webhook' })).toBeNull();
    expect(sanitizeDraft({ ...draft, teamId: '../team' })).toBeNull();
    expect(sanitizeDraft({ ...draft, priority: 'P9' })).toBeNull();
    expect(sanitizeWorkflows([draft, { ...draft, name: 'Duplicate' }, { ...draft, id: 'two', name: '' }])).toEqual([draft]);
  });

  it('makes a manual handoff with Jira smart values and no destination secrets', () => {
    const plan = jiraChecklist({ ...draft, status: 'acked' });
    expect(plan).toContain('Cloud team → Operations → Automation');
    expect(plan).toContain('{{alert.priority}} equals "P1"');
    expect(plan).toContain('{{alert.status}} equals "acknowledged"');
    expect(plan).toContain('Send Slack message');
    expect(plan).toContain('authorized operator enable');
    expect(jiraHome('example.atlassian.net')).toBe('https://example.atlassian.net');
    expect(jiraHome('example.atlassian.net@other.example')).toBeUndefined();
    expect(routeHash(parseHash('#/workflows'))).toBe('#/workflows');
  });
});

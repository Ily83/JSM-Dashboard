import { describe, expect, it } from 'vitest';
import { alertCount, needsConfirm, questionText, resultText } from '../src/components/actions/bulkRules';

describe('alert menu confirmation rules', () => {
  it('runs a non-destructive action on one alert at once', () => {
    for (const action of ['acknowledge', 'unacknowledge', 'assign', 'snooze', 'priority', 'addResponder', 'escalate', 'addTags', 'removeTags', 'addNote'] as const) {
      expect(needsConfirm(action, 1)).toBe(false);
    }
  });

  it('asks before acting on more than one alert', () => {
    expect(needsConfirm('acknowledge', 2)).toBe(true);
    expect(needsConfirm('addNote', 12)).toBe(true);
  });

  it('always asks before closing or running a custom action', () => {
    expect(needsConfirm('close', 1)).toBe(true);
    expect(needsConfirm('customAction', 1)).toBe(true);
  });
});

describe('alert menu wording', () => {
  it('counts alerts as a noun', () => {
    expect(alertCount(1)).toBe('1 alert');
    expect(alertCount(3)).toBe('3 alerts');
  });

  it('asks with the action, the count and the chosen value', () => {
    expect(questionText({ action: 'close' }, 3)).toBe('Close 3 alerts?');
    expect(questionText({ action: 'assign', accountId: 'u1' }, 2, 'Priya Nair')).toBe('Assign 2 alerts to Priya Nair?');
    expect(questionText({ action: 'addTags', tags: ['noisy', 'follow-up'] }, 1)).toBe('Tag 1 alert with noisy, follow-up?');
    expect(questionText({ action: 'removeTags', tags: ['noisy'] }, 4)).toBe('Remove tag noisy from 4 alerts?');
    expect(questionText({ action: 'priority', priority: 'P2' }, 5)).toBe('Set 5 alerts to P2?');
    expect(questionText({ action: 'customAction', actionName: 'Restart' }, 1)).toBe('Run “Restart” on 1 alert?');
  });

  it('reports results in the past tense, never as a bare number', () => {
    expect(resultText({ action: 'acknowledge' }, 1)).toBe('1 alert acknowledged');
    expect(resultText({ action: 'assign', accountId: 'u1' }, 2, 'Priya Nair')).toBe('2 alerts assigned to Priya Nair');
    expect(resultText({ action: 'addTags', tags: ['noisy', 'follow-up'] }, 1)).toBe('1 alert tagged noisy, follow-up');
    expect(resultText({ action: 'removeTags', tags: ['a', 'b'] }, 2)).toBe('Tags a, b removed from 2 alerts');
    expect(resultText({ action: 'addNote', note: 'x' }, 3)).toBe('Note added to 3 alerts');
    expect(resultText({ action: 'addResponder', responder: { type: 'team', id: 't' } }, 1, 'Database Team')).toBe('Database Team added to 1 alert');
    expect(resultText({ action: 'escalate', escalationId: 'e' }, 1, 'Ops')).toBe('1 alert escalated via Ops');
    for (const text of [resultText({ action: 'priority', priority: 'P4' }, 1), resultText({ action: 'customAction', actionName: 'Restart' }, 1)]) {
      expect(text).not.toMatch(/updated/);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { buildScenario, simAlias, SIM_TAG } from '../scripts/simulation/scenario';

describe('simulation scenario', () => {
  const steps = buildScenario();

  it('is ordered by time and lasts about twelve minutes', () => {
    expect(steps.map((s) => s.at)).toEqual([...steps.map((s) => s.at)].sort((a, b) => a - b));
    expect(steps.at(-1)!.at).toBeLessThanOrEqual(13 * 60_000);
  });

  it('tags every alert, and only acts on alerts it created before', () => {
    const created = new Set<string>();
    for (const step of steps) {
      if (step.kind === 'create') {
        expect(step.alert.tags).toContain(SIM_TAG);
        expect(step.alert.message.length).toBeLessThanOrEqual(130);
        created.add(step.key);
      } else if ('key' in step) {
        expect(created.has(step.key), `${step.kind} ${step.key}`).toBe(true);
      }
    }
  });

  it('covers the cases the dashboard has to show', () => {
    const creates = steps.filter((s) => s.kind === 'create');
    expect(creates.filter((s) => s.kind === 'create' && s.alert.priority === 'P1').length).toBeGreaterThanOrEqual(2);
    expect(steps.some((s) => s.kind === 'repeat')).toBe(true);
    expect(creates.filter((s) => s.key === 'disk')).toHaveLength(3);
    expect(steps.some((s) => s.kind === 'heartbeat-start')).toBe(true);
    expect(creates.some((s) => s.kind === 'create' && (s.alert.actions?.length ?? 0) > 0)).toBe(true);
  });

  it('gives each run its own aliases', () => {
    expect(simAlias('a', 'disk')).not.toBe(simAlias('b', 'disk'));
  });
});

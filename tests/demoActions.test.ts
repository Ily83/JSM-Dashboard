import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config';
import { DemoSource } from '../server/demo/demoSource';

async function openDemoAlert() {
  const demo = new DemoSource(loadConfig({}).extraction, 0, Date.now());
  demo.actionDelayMs = 0;
  const snapshot = await demo.sync();
  const alert = [...snapshot.alerts.values()].find((a) => a.status === 'open' && a.responders.length > 0);
  if (!alert) throw new Error('the demo data has no open alert with responders');
  return { demo, id: alert.id };
}

describe('demo actions', () => {
  it('adds a responder once, however often it is added', async () => {
    const { demo, id } = await openDemoAlert();
    const before = (await demo.loadDetail(id))!.responders.length;
    await demo.perform(id, { action: 'addResponder', responder: { id: 'demo-user-yuki', type: 'user' } });
    await demo.perform(id, { action: 'addResponder', responder: { id: 'demo-user-yuki', type: 'user' } });
    const after = (await demo.loadDetail(id))!.responders;
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toMatchObject({ id: 'demo-user-yuki', type: 'user', name: 'Yuki Tanaka' });
  });

  it('escalates to a known escalation once, and refuses an unknown one', async () => {
    const { demo, id } = await openDemoAlert();
    await expect(demo.perform(id, { action: 'escalate', escalationId: 'esc-nope' })).rejects.toMatchObject({ kind: 'validation', status: 422 });
    await expect(demo.perform(id, { action: 'escalate', escalationId: 'esc-dba' })).resolves.toEqual({
      state: 'done',
      message: 'Escalated to next level of Database escalation',
    });
    await demo.perform(id, { action: 'escalate', escalationId: 'esc-dba' });
    const responders = (await demo.loadDetail(id))!.responders.filter((r) => r.id === 'esc-dba');
    expect(responders).toEqual([{ id: 'esc-dba', type: 'escalation', name: 'Database escalation' }]);
  });

  it('assigns fictional people and the demo operator, and refuses unknown accounts', async () => {
    const { demo, id } = await openDemoAlert();
    await expect(demo.perform(id, { action: 'assign', accountId: 'nobody' })).rejects.toMatchObject({ kind: 'validation', status: 422 });
    await expect(demo.perform(id, { action: 'assign', accountId: 'demo-user-priya' })).resolves.toEqual({ state: 'done', message: 'Alert owner changed to Priya Nair' });
    await expect(demo.perform(id, { action: 'assign', accountId: 'demo-user-operator' })).resolves.toEqual({
      state: 'done',
      message: 'Alert owner changed to Demo Operator',
    });
    expect((await demo.loadDetail(id))!.assignee).toBe('Demo Operator');
  });
});

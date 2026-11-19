/**
 * Plays a realistic operations scenario on a Jira Service Management TEST
 * site, so the Alert Center can be watched and tested end to end with live
 * data. See scripts/simulation/scenario.ts for what happens when.
 *
 *   npm run jira:simulate -- run --yes [--speed 2]   about 12 minutes (6 at --speed 2)
 *   npm run jira:simulate -- cleanup --yes           closes the simulated alerts, removes the heartbeat
 *
 * Uses the credentials in .env. Writes to Jira: never point it at a production site.
 */
import { loadConfig } from '../server/config';
import { JiraClient, type CreateAlertBody } from '../server/jira/client';
import { buildScenario, simAlias, SIM_HEARTBEAT, SIM_TAG, type SimAlert, type Step } from './simulation/scenario';

const args = process.argv.slice(2);
const command = args[0];
const speedArg = args.indexOf('--speed');
const speed = speedArg >= 0 ? Math.max(0.1, Math.min(60, Number(args[speedArg + 1]) || 1)) : 1;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const config = loadConfig();
if (!config.jira) fail('No Jira connection configured: set JIRA_SITE_URL, JIRA_EMAIL and JIRA_API_TOKEN in .env.');
if (command !== 'run' && command !== 'cleanup') fail('Usage: npm run jira:simulate -- run|cleanup --yes [--speed 2]');
if (!args.includes('--yes')) fail(`This writes to ${config.jira.siteHost}. Only use a test site. Add --yes to continue.`);

const client = new JiraClient(config.jira, 2);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'failed');

async function firstTeam(): Promise<string | null> {
  try {
    const teams = await client.listTeams();
    return [...teams.keys()][0] ?? null;
  } catch {
    return null;
  }
}

function body(runId: string, key: string, alert: SimAlert, teamId: string | null): CreateAlertBody {
  const { team, ...rest } = alert;
  return {
    ...rest,
    message: rest.message.slice(0, 130),
    alias: simAlias(runId, key),
    ...(team && teamId ? { responders: [{ id: teamId, type: 'team' as const }] } : {}),
  };
}

async function run(): Promise<void> {
  const runId = Date.now().toString(36);
  const teamId = await firstTeam();
  const steps = buildScenario();
  const ids = new Map<string, string>();
  const bodies = new Map<string, CreateAlertBody>();
  const started = Date.now();
  const clock = () => {
    const s = Math.round((Date.now() - started) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  console.log(`Simulation ${runId} on ${config.jira!.siteHost}, ${steps.length} steps, speed ×${speed}${teamId ? '' : ' (no Operations team: no responders, no heartbeat)'}.`);

  for (const step of steps) {
    const wait = started + step.at / speed - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      console.log(`[${clock()}] ${await execute(step)}`);
    } catch (error) {
      console.log(`[${clock()}] ${step.kind}${'key' in step ? ` ${step.key}` : ''}: ${errorText(error)}`);
    }
  }
  console.log(`Done. The heartbeat stays expired until "npm run jira:simulate -- cleanup --yes".`);

  async function execute(step: Step): Promise<string> {
    switch (step.kind) {
      case 'create':
      case 'repeat': {
        const request = step.kind === 'create' ? body(runId, step.key, step.alert, teamId) : bodies.get(step.key);
        if (!request) return `repeat ${step.key}: not created yet`;
        bodies.set(step.key, request);
        const result = await client.createAlert(request);
        if (result.alertId) ids.set(step.key, result.alertId);
        return `${step.kind === 'create' ? 'created' : 'sent again'} ${request.priority} ${request.message.slice(0, 70)}${result.alertId ? '' : ' (not confirmed yet)'}`;
      }
      case 'ack':
      case 'close': {
        const id = ids.get(step.key);
        if (!id) return `${step.kind} ${step.key}: unknown alert`;
        await client.performAction(id, { action: step.kind === 'ack' ? 'acknowledge' : 'close' });
        return `${step.kind === 'ack' ? 'acknowledged' : 'closed'} ${step.key}`;
      }
      case 'note': {
        const id = ids.get(step.key);
        if (!id) return `note ${step.key}: unknown alert`;
        await client.performAction(id, { action: 'addNote', note: step.note });
        return `note on ${step.key}`;
      }
      case 'heartbeat-start': {
        if (!teamId) return 'heartbeat skipped: the site has no Operations team';
        await client.deleteHeartbeat(teamId, SIM_HEARTBEAT).catch(() => undefined);
        await client.createHeartbeat(teamId, {
          name: SIM_HEARTBEAT,
          description: 'Created by the Alert Center simulation; stops being pinged on purpose.',
          interval: 1,
          intervalUnit: 'minutes',
          enabled: true,
          alertMessage: 'Heartbeat alert-center-sim stopped reporting',
          alertTags: [SIM_TAG],
          alertPriority: 'P2',
        });
        await client.pingHeartbeat(teamId, SIM_HEARTBEAT);
        return `heartbeat ${SIM_HEARTBEAT} created (1 minute interval) and pinged`;
      }
      case 'heartbeat-ping': {
        if (!teamId) return 'heartbeat ping skipped';
        await client.pingHeartbeat(teamId, SIM_HEARTBEAT);
        return 'heartbeat pinged';
      }
    }
  }
}

async function cleanup(): Promise<void> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await client.listAlerts({ query: `tag: ${SIM_TAG} AND status: open`, offset, size: 100 });
    ids.push(...page.alerts.map((a) => a.id));
    if (!page.hasNext || page.alerts.length === 0) break;
  }
  let closed = 0;
  for (const id of ids) {
    try {
      await client.performAction(id, { action: 'close' });
      closed += 1;
    } catch (error) {
      console.log(`  ${id}: ${errorText(error)}`);
    }
  }
  console.log(`${closed} of ${ids.length} open simulated alerts closed.`);
  const teamId = await firstTeam();
  if (teamId) {
    try {
      await client.deleteHeartbeat(teamId, SIM_HEARTBEAT);
      console.log(`Heartbeat ${SIM_HEARTBEAT} removed.`);
    } catch (error) {
      console.log(`Heartbeat: ${errorText(error)}`);
    }
  }
}

try {
  await (command === 'run' ? run() : cleanup());
} catch (error) {
  fail(errorText(error));
}

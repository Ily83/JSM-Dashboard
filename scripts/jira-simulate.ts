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

/** What one simulation run remembers between steps. */
interface RunState {
  runId: string;
  teamId: string | null;
  /** Step key -> Jira alert id, once Jira confirmed the alert. */
  ids: Map<string, string>;
  /** Step key -> the alert as first sent, for repeats. */
  bodies: Map<string, CreateAlertBody>;
}

async function sendAlert(state: RunState, step: Extract<Step, { kind: 'create' | 'repeat' }>): Promise<string> {
  const request = step.kind === 'create' ? body(state.runId, step.key, step.alert, state.teamId) : state.bodies.get(step.key);
  if (!request) return `repeat ${step.key}: not created yet`;
  state.bodies.set(step.key, request);
  const result = await client.createAlert(request);
  if (result.alertId) state.ids.set(step.key, result.alertId);
  const verb = step.kind === 'create' ? 'created' : 'sent again';
  const confirmation = result.alertId ? '' : ' (not confirmed yet)';
  return `${verb} ${request.priority} ${request.message.slice(0, 70)}${confirmation}`;
}

async function ackOrClose(state: RunState, step: Extract<Step, { kind: 'ack' | 'close' }>): Promise<string> {
  const id = state.ids.get(step.key);
  if (!id) return `${step.kind} ${step.key}: unknown alert`;
  const ack = step.kind === 'ack';
  await client.performAction(id, { action: ack ? 'acknowledge' : 'close' });
  return `${ack ? 'acknowledged' : 'closed'} ${step.key}`;
}

async function addNote(state: RunState, step: Extract<Step, { kind: 'note' }>): Promise<string> {
  const id = state.ids.get(step.key);
  if (!id) return `note ${step.key}: unknown alert`;
  await client.performAction(id, { action: 'addNote', note: step.note });
  return `note on ${step.key}`;
}

async function startHeartbeat(teamId: string | null): Promise<string> {
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

async function pingHeartbeat(teamId: string | null): Promise<string> {
  if (!teamId) return 'heartbeat ping skipped';
  await client.pingHeartbeat(teamId, SIM_HEARTBEAT);
  return 'heartbeat pinged';
}

/** Runs one step and describes what happened. */
function execute(state: RunState, step: Step): Promise<string> {
  switch (step.kind) {
    case 'create':
    case 'repeat':
      return sendAlert(state, step);
    case 'ack':
    case 'close':
      return ackOrClose(state, step);
    case 'note':
      return addNote(state, step);
    case 'heartbeat-start':
      return startHeartbeat(state.teamId);
    case 'heartbeat-ping':
      return pingHeartbeat(state.teamId);
  }
}

async function run(): Promise<void> {
  const state: RunState = { runId: Date.now().toString(36), teamId: await firstTeam(), ids: new Map(), bodies: new Map() };
  const { runId, teamId } = state;
  const steps = buildScenario();
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
      console.log(`[${clock()}] ${await execute(state, step)}`);
    } catch (error) {
      const key = 'key' in step ? ` ${step.key}` : '';
      console.log(`[${clock()}] ${step.kind}${key}: ${errorText(error)}`);
    }
  }
  console.log(`Done. The heartbeat stays expired until "npm run jira:simulate -- cleanup --yes".`);
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
  if (command === 'run') await run();
  else await cleanup();
} catch (error) {
  fail(errorText(error));
}

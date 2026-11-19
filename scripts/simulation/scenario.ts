import type { CreateAlertBody } from '../../server/jira/client';

/**
 * A realistic stretch of operations, as a timeline of steps, to play
 * against a Jira Service Management TEST site (scripts/jira-simulate.ts).
 *
 * What it exercises in the Alert Center:
 *   - a P1 outage affecting three customers (P1 alarm, critical KPIs, lanes)
 *   - the same alert sent again (Jira de-duplicates: the count goes up)
 *   - P2 symptoms of the outage on other services
 *   - a disk alert that closes and fires again (three records: Group repeats,
 *     History → Recurring, the 24-hour strip)
 *   - a second P1 later on
 *   - an engineer acknowledging and adding a note, then the incident resolving
 *   - low-priority noise
 *   - a heartbeat that stops reporting (Jira raises its own alert; Heartbeats widget)
 *   - custom actions, a runbook link, team responders
 *
 * All companies and hosts are fictional. Every alert carries SIM_TAG.
 */

export const SIM_TAG = 'alert-center-sim';
export const SIM_HEARTBEAT = 'alert-center-sim-heartbeat';

export type SimAlert = Omit<CreateAlertBody, 'alias' | 'responders'> & {
  /** Add the site's first Operations team as responder, when there is one. */
  team?: boolean;
};

export type Step =
  | { at: number; kind: 'create'; key: string; alert: SimAlert }
  | { at: number; kind: 'repeat'; key: string }
  | { at: number; kind: 'ack'; key: string }
  | { at: number; kind: 'note'; key: string; note: string }
  | { at: number; kind: 'close'; key: string }
  | { at: number; kind: 'heartbeat-start' }
  | { at: number; kind: 'heartbeat-ping' };

const MIN = 60_000;
const RUNBOOK = 'https://wiki.example.com/runbooks';

const customers = (...names: string[]) => names.map((n) => `customer:${n}`);

/** The timeline, in milliseconds from the start, ordered by time. */
export function buildScenario(): Step[] {
  const outage: SimAlert = {
    message: 'ExpressRoute circuit er-ams-01: BGP session down on primary and secondary links',
    description:
      'Both BGP sessions of ExpressRoute circuit er-ams-01 are down. Traffic to on-premises falls back to the VPN backup where configured.\n\nRunbook: ' +
      `${RUNBOOK}/expressroute-bgp`,
    priority: 'P1',
    entity: 'er-ams-01',
    source: 'Alert Center simulation',
    tags: [...customers('Contoso', 'Fabrikam', 'Litware'), 'network', 'prod', SIM_TAG],
    extraProperties: { service: 'ExpressRoute', region: 'westeurope', circuit: 'er-ams-01', runbook: `${RUNBOOK}/expressroute-bgp` },
    actions: ['Run diagnostics', 'Fail over to secondary'],
    team: true,
  };
  const vpn: SimAlert = {
    message: 'Site-to-site VPN vpngw-hub-weu: tunnel to Contoso headquarters down',
    priority: 'P2',
    entity: 'vpngw-hub-weu',
    source: 'Alert Center simulation',
    tags: [...customers('Contoso'), 'network', SIM_TAG],
    extraProperties: { service: 'VPN Gateway', tunnel: 'cn-contoso-hq' },
    team: true,
  };
  const gateway: SimAlert = {
    message: 'Application Gateway agw-shop-prod: 38% of backend requests return HTTP 502',
    priority: 'P2',
    entity: 'agw-shop-prod',
    source: 'Alert Center simulation',
    tags: [...customers('Fabrikam'), 'web', 'prod', SIM_TAG],
    extraProperties: { service: 'Application Gateway', backendPool: 'shop-api' },
    actions: ['Run diagnostics'],
  };
  const disk: SimAlert = {
    message: 'Virtual machine vm-erp-app-03: data disk 91% full',
    priority: 'P3',
    entity: 'vm-erp-app-03',
    source: 'Alert Center simulation',
    tags: [...customers('Adventure Works'), 'compute', SIM_TAG],
    extraProperties: { service: 'ERP Platform', disk: 'F:' },
  };
  const sql: SimAlert = {
    message: 'Azure SQL Managed Instance sqlmi-fin-prod: replication lag above 15 minutes',
    description: `Geo-replication lag on failover group fog-fin-prod is above the 15 minute threshold.\n\nRunbook: ${RUNBOOK}/sql-replication-lag`,
    priority: 'P1',
    entity: 'sqlmi-fin-prod',
    source: 'Alert Center simulation',
    tags: [...customers('Woodgrove Bank'), 'database', 'prod', SIM_TAG],
    extraProperties: { service: 'Azure SQL', failoverGroup: 'fog-fin-prod' },
    actions: ['Run diagnostics'],
    team: true,
  };
  const patching: SimAlert = {
    message: 'Patch compliance below 90% for update group "Windows Server - Contoso"',
    priority: 'P4',
    entity: 'ug-contoso-windows',
    source: 'Alert Center simulation',
    tags: [...customers('Contoso'), 'patching', SIM_TAG],
    extraProperties: { service: 'Update Manager' },
  };
  const cost: SimAlert = {
    message: 'Cost anomaly: subscription sub-tailspin-dev spent 38% more than forecast',
    priority: 'P5',
    entity: 'sub-tailspin-dev',
    source: 'Alert Center simulation',
    tags: [...customers('Tailspin Toys'), 'finops', SIM_TAG],
    extraProperties: { service: 'Cost Management' },
  };
  const certificate: SimAlert = {
    message: 'Key Vault kv-shared-prod: certificate wildcard-shared expires in 14 days',
    priority: 'P3',
    entity: 'kv-shared-prod',
    source: 'Alert Center simulation',
    tags: [...customers('Contoso', 'Northwind Traders', 'Proseware'), 'certificate', SIM_TAG],
    extraProperties: { service: 'Key Vault', runbook: `${RUNBOOK}/certificate-renewal` },
  };

  const steps: Step[] = [
    { at: 0, kind: 'create', key: 'patching', alert: patching },
    { at: 0.5 * MIN, kind: 'create', key: 'outage', alert: outage },
    { at: 1 * MIN, kind: 'repeat', key: 'outage' },
    { at: 1.25 * MIN, kind: 'create', key: 'vpn', alert: vpn },
    { at: 1.5 * MIN, kind: 'repeat', key: 'outage' },
    { at: 1.75 * MIN, kind: 'create', key: 'gateway', alert: gateway },
    { at: 2 * MIN, kind: 'repeat', key: 'outage' },
    { at: 2.5 * MIN, kind: 'create', key: 'disk', alert: disk },
    { at: 3 * MIN, kind: 'heartbeat-start' },
    { at: 3.5 * MIN, kind: 'close', key: 'disk' },
    { at: 3.8 * MIN, kind: 'heartbeat-ping' },
    { at: 4 * MIN, kind: 'create', key: 'sql', alert: sql },
    { at: 4.5 * MIN, kind: 'create', key: 'disk', alert: disk },
    { at: 4.6 * MIN, kind: 'heartbeat-ping' },
    { at: 5.5 * MIN, kind: 'close', key: 'disk' },
    // The heartbeat is no longer pinged from here: Jira raises its alert after the interval.
    { at: 6 * MIN, kind: 'ack', key: 'outage' },
    { at: 6.2 * MIN, kind: 'note', key: 'outage', note: 'Investigating with the network provider. Customers informed.' },
    { at: 6.5 * MIN, kind: 'create', key: 'disk', alert: disk },
    { at: 8 * MIN, kind: 'create', key: 'cost', alert: cost },
    { at: 9 * MIN, kind: 'ack', key: 'sql' },
    { at: 10 * MIN, kind: 'close', key: 'vpn' },
    { at: 10.2 * MIN, kind: 'close', key: 'gateway' },
    { at: 11 * MIN, kind: 'note', key: 'outage', note: 'Provider restored both links. Monitoring.' },
    { at: 11.2 * MIN, kind: 'close', key: 'outage' },
    { at: 12 * MIN, kind: 'create', key: 'certificate', alert: certificate },
  ];
  return steps.sort((a, b) => a.at - b.at);
}

/** Alias of a scenario alert: stable within one run, distinct between runs. */
export function simAlias(runId: string, key: string): string {
  return `${SIM_TAG}-${runId}-${key}`;
}

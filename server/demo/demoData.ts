import type { RawAlert } from '../jira/schemas';

/**
 * Sample alerts for demo mode, written in the same shape as the Jira
 * Operations API returns them (AlertResponse). They go through the same
 * mapper as live data, so demo mode exercises the real code path:
 * customers come from "customer:" tags or a "customer" extra property,
 * services from a "service" extra property, a "service:" tag, or the entity.
 *
 * All companies, people and hosts are fictional.
 */

export const DEMO_TEAMS: ReadonlyMap<string, string> = new Map([
  ['team-cloud-ops', 'Cloud Operations'],
  ['team-network', 'Network Engineering'],
  ['team-dba', 'Database Team'],
  ['team-identity', 'Identity & Access'],
  ['team-platform', 'Platform Engineering'],
  ['team-servicedesk', 'Service Desk'],
]);

/** Fictional people for the assign and responder pickers. */
export const DEMO_USERS: ReadonlyArray<{ accountId: string; displayName: string }> = [
  'Daniel Okafor',
  'Elena Petrova',
  'Marcus Oyelaran',
  'Priya Nair',
  'Sofia Lindqvist',
  'Tomás Herrera',
  'Yuki Tanaka',
].map((displayName) => ({ accountId: `demo-user-${displayName.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}`, displayName }));

/** The account behind the (imaginary) API token in demo mode. */
export const DEMO_ME = { accountId: 'demo-user-operator', displayName: 'Demo Operator' };

export const DEMO_SCHEDULES = [
  { id: 'sched-cloud-ops', name: 'Cloud Operations on-call' },
  { id: 'sched-dba', name: 'Database on-call' },
  { id: 'sched-network', name: 'Network on-call' },
];

export const DEMO_ESCALATIONS: Readonly<Record<string, Array<{ id: string; name: string }>>> = {
  'team-cloud-ops': [{ id: 'esc-cloud-ops', name: 'Cloud Operations escalation' }],
  'team-network': [{ id: 'esc-network', name: 'Network escalation' }],
  'team-dba': [{ id: 'esc-dba', name: 'Database escalation' }],
  'team-identity': [{ id: 'esc-identity', name: 'Identity escalation' }],
  'team-platform': [{ id: 'esc-platform', name: 'Platform escalation' }, { id: 'esc-platform-major', name: 'Platform major incident' }],
  'team-servicedesk': [{ id: 'esc-servicedesk', name: 'Service Desk escalation' }],
};

/** Names of every non-team responder above, for labelling responders. */
export const DEMO_RESPONDER_NAMES: ReadonlyMap<string, string> = new Map([
  ...[DEMO_ME, ...DEMO_USERS].map((u) => [u.accountId, u.displayName] as const),
  ...DEMO_SCHEDULES.map((s) => [s.id, s.name] as const),
  ...Object.values(DEMO_ESCALATIONS).flat().map((e) => [e.id, e.name] as const),
]);

interface Seed {
  min: number; // created, minutes ago
  upd?: number; // updated, minutes ago (defaults to created)
  p: string;
  status?: 'open' | 'acked' | 'snoozed' | 'closed';
  msg: string;
  desc: string;
  customers?: string[];
  customersInProperty?: boolean; // customer list in an extra property instead of tags
  tags?: string[];
  service?: string;
  serviceTag?: string;
  entity?: string;
  owner?: string;
  teams?: string[];
  users?: string[];
  integration: string;
  type: string;
  source?: string;
  count?: number;
  props?: Record<string, string>;
}

const SEEDS: Seed[] = [
  {
    min: 4, p: 'P1', msg: 'AKS cluster aks-prod-weu-01: API server unreachable from all node pools',
    desc: 'The Kubernetes API server of aks-prod-weu-01 has not answered health probes for 4 minutes. Workloads keep running but deployments, autoscaling and kubectl access fail.\n\nImpact: checkout and order services of two customers cannot scale.\n\nFirst steps:\n1. Check the Azure Service Health page for West Europe.\n2. Verify the private endpoint of the API server and the private DNS zone link.\n3. Review recent changes to the hub firewall rule collection.',
    customers: ['Contoso', 'Fabrikam'], tags: ['prod', 'kubernetes', 'westeurope'], service: 'AKS Platform', entity: 'aks-prod-weu-01',
    teams: ['team-platform', 'team-cloud-ops'], integration: 'Azure Monitor', type: 'AzureMonitor', source: 'Azure Monitor', count: 7,
    props: { region: 'westeurope', subscription: 'sub-prod-shared-01', resourceGroup: 'rg-aks-prod-weu', metric: 'apiserver_request_availability', environment: 'production' },
  },
  {
    min: 11, upd: 3, p: 'P1', status: 'acked', msg: 'Azure SQL Managed Instance sqlmi-fin-prod: failover group replication lag above 15 minutes',
    desc: 'Geo-replication lag on the failover group fog-fin-prod has been above the 15 minute threshold since 09:42. Recovery point objective for the finance platform is 5 minutes.\n\nA long-running index rebuild was started by a maintenance job at 09:30.',
    customers: ['Woodgrove Bank'], tags: ['prod', 'database', 'rpo-breach'], service: 'Azure SQL', entity: 'sqlmi-fin-prod',
    owner: 'Priya Nair', teams: ['team-dba'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 12,
    props: { region: 'northeurope', replicationLagSeconds: '1124', failoverGroup: 'fog-fin-prod', environment: 'production' },
  },
  {
    min: 19, p: 'P1', msg: 'ExpressRoute circuit er-ams-01: BGP session down on primary and secondary path',
    desc: 'Both BGP sessions of ExpressRoute circuit er-ams-01 (Amsterdam) are down. On-premises connectivity for all customers on the shared hub falls back to the site-to-site VPN, which has a 1 Gbps limit.\n\nProvider ticket has not been opened yet.',
    customers: ['Contoso', 'Northwind Traders', 'Adventure Works', 'Litware', 'Tailspin Toys'], tags: ['prod', 'network', 'expressroute', 'hub'],
    service: 'ExpressRoute', entity: 'er-ams-01', teams: ['team-network'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 3,
    props: { peeringLocation: 'Amsterdam', provider: 'Equinix', bgpAvailability: '0', region: 'westeurope' },
  },
  {
    min: 27, upd: 9, p: 'P1', status: 'acked', msg: 'Application Gateway agw-shop-prod: 62% of backend requests return HTTP 502',
    desc: 'The unhealthy host count on backend pool bp-shop-api went from 0 to 5 of 8 instances. Customers see intermittent errors during checkout.\n\nThe health probe fails with a TLS handshake error: the backend certificate expired today at 08:00 UTC.',
    customers: ['Tailspin Toys'], tags: ['prod', 'certificate', 'ecommerce'], service: 'Application Gateway', entity: 'agw-shop-prod',
    owner: 'Marcus Oyelaran', teams: ['team-cloud-ops'], integration: 'Datadog', type: 'Datadog', source: 'datadog-eu', count: 41,
    props: { monitorId: '48211973', failedRequestRate: '62%', backendPool: 'bp-shop-api', environment: 'production' },
  },
  {
    min: 36, p: 'P2', msg: 'Microsoft Entra Connect: password hash synchronisation has not completed for 3 hours',
    desc: 'The last successful password hash synchronisation was 3 hours ago. Users who changed their password on-premises cannot sign in to cloud applications with the new password.',
    customers: ['Northwind Traders'], tags: ['identity', 'hybrid'], service: 'Identity (Entra ID)', entity: 'aadc-nwt-01',
    teams: ['team-identity'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 2,
    props: { tenant: 'northwind', lastSync: '3h 04m ago', connector: 'aadc-nwt-01' },
  },
  {
    min: 44, upd: 20, p: 'P2', status: 'acked', msg: 'Azure Backup: 14 virtual machine backup jobs failed in vault rsv-prod-weu',
    desc: 'Nightly backup jobs failed with error UserErrorGuestAgentStatusUnavailable on 14 virtual machines. The VM agent on the affected machines stopped reporting after the last patch window.',
    customers: ['Adventure Works', 'Litware'], tags: ['backup', 'prod'], service: 'Backup', entity: 'rsv-prod-weu',
    owner: 'Sofia Lindqvist', teams: ['team-cloud-ops'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 14,
    props: { vault: 'rsv-prod-weu', failedJobs: '14', errorCode: 'UserErrorGuestAgentStatusUnavailable' },
  },
  {
    min: 52, p: 'P2', msg: 'API Management apim-partner-prod: p95 latency 4.8 s on /orders (threshold 1.5 s)',
    desc: 'Backend duration for the Orders API has been above the latency objective for 20 minutes. The capacity metric of the gateway is at 91%.',
    customers: ['Fabrikam', 'Proseware'], tags: ['prod', 'latency', 'api'], service: 'API Management', entity: 'apim-partner-prod',
    teams: ['team-platform'], integration: 'Datadog', type: 'Datadog', source: 'datadog-eu', count: 9,
    props: { monitorId: '48220118', p95: '4.8s', capacity: '91%', api: 'orders-v2' },
  },
  {
    min: 63, upd: 58, p: 'P2', msg: 'Site-to-site VPN vpngw-hub-weu: tunnel to Alpine Ski House headquarters is flapping',
    desc: 'The IPsec tunnel to the Alpine Ski House headquarters reconnected 11 times in the last hour. Packet loss reaches 30% during renegotiation.',
    customers: ['Alpine Ski House'], tags: ['network', 'vpn'], service: 'VPN Gateway', entity: 'vpngw-hub-weu',
    teams: ['team-network'], integration: 'Zabbix', type: 'Zabbix', source: 'zabbix-core-01', count: 11,
    props: { tunnel: 'cn-ash-hq', reconnects: '11', packetLoss: '30%' },
  },
  {
    min: 75, upd: 30, p: 'P2', status: 'acked', msg: 'Azure Virtual Desktop host pool hp-avd-fin: 0 of 12 session hosts available',
    desc: 'All session hosts of host pool hp-avd-fin report "Unavailable" after the FSLogix profile storage account became unreachable. About 180 users cannot start a session.',
    customers: ['Woodgrove Bank'], tags: ['avd', 'prod', 'storage'], service: 'Virtual Desktop', entity: 'hp-avd-fin',
    owner: 'Yuki Tanaka', teams: ['team-cloud-ops'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 5,
    props: { hostPool: 'hp-avd-fin', availableHosts: '0/12', affectedUsers: '≈180' },
  },
  {
    min: 88, p: 'P3', msg: 'Storage account stproseweu02: used capacity at 92% of the configured quota',
    desc: 'File share "projects" is at 92% of its 5 TiB quota and grows by about 1% per day.',
    customers: ['Proseware'], tags: ['storage', 'capacity'], service: 'Storage', entity: 'stproseweu02',
    teams: ['team-cloud-ops'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 1,
    props: { share: 'projects', quota: '5 TiB', used: '92%' },
  },
  {
    min: 97, upd: 91, p: 'P3', msg: 'Key Vault kv-contoso-prod: certificate wildcard-contoso-com expires in 9 days',
    desc: 'The certificate is used by Front Door and two application gateways. Automatic renewal is disabled for this issuer.',
    customers: ['Contoso'], tags: ['certificate', 'expiry'], service: 'Key Vault', entity: 'kv-contoso-prod',
    owner: 'Elena Petrova', teams: ['team-platform'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 1,
    props: { certificate: 'wildcard-contoso-com', daysToExpiry: '9', issuer: 'manual' },
  },
  {
    min: 112, p: 'P3', status: 'snoozed', msg: 'Service Bus namespace sb-orders-prod: dead-letter queue depth above 5,000 messages',
    desc: 'Dead-letter count on queue "order-events" keeps growing. The consumer rejects messages with a schema validation error since the release of version 4.12.',
    customers: ['Fabrikam'], tags: ['messaging', 'prod'], serviceTag: 'Service Bus', entity: 'sb-orders-prod',
    owner: 'Daniel Okafor', teams: ['team-platform'], integration: 'Prometheus', type: 'Prometheus', source: 'alertmanager-weu', count: 22,
    props: { queue: 'order-events', deadLetterCount: '5312', alertname: 'ServiceBusDeadLetterGrowing' },
  },
  {
    min: 131, upd: 64, p: 'P3', status: 'acked', msg: 'Azure Front Door fd-global-01: origin group og-web-eu marked degraded (2 of 4 origins healthy)',
    desc: 'Health probes to the two origins in North Europe time out. Traffic is served from West Europe only.',
    customers: ['Contoso', 'Litware'], tags: ['frontdoor', 'prod', 'northeurope'], service: 'Front Door', entity: 'fd-global-01',
    owner: 'Tomás Herrera', teams: ['team-network'], integration: 'Datadog', type: 'Datadog', source: 'datadog-eu', count: 6,
    props: { originGroup: 'og-web-eu', healthyOrigins: '2/4', monitorId: '48233790' },
  },
  {
    min: 146, p: 'P3', msg: 'Virtual machine vm-erp-app-03: CPU above 95% for 30 minutes',
    desc: 'Sustained CPU saturation on the ERP application server. The batch scheduler started the month-end closing run at 07:00.',
    customers: ['Adventure Works'], customersInProperty: true, tags: ['compute', 'erp'], service: 'ERP Platform', entity: 'vm-erp-app-03',
    teams: ['team-cloud-ops'], integration: 'Zabbix', type: 'Zabbix', source: 'zabbix-core-01', count: 4,
    props: { host: 'vm-erp-app-03', cpu: '97%', trigger: 'High CPU utilisation' },
  },
  {
    min: 171, upd: 160, p: 'P3', msg: 'Log Analytics workspace law-shared-prod: daily ingestion cap reached, data collection stopped',
    desc: 'The daily cap of 200 GB was reached at 13:10 UTC. No further logs are collected until 00:00 UTC, which also disables log-based alert rules for every customer on the shared platform.',
    customers: ['Contoso', 'Fabrikam', 'Northwind Traders', 'Proseware', 'Tailspin Toys', 'Wingtip Toys'], tags: ['monitoring', 'shared-platform'],
    service: 'Monitoring Platform', entity: 'law-shared-prod', teams: ['team-platform'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 1,
    props: { dailyCapGb: '200', workspace: 'law-shared-prod' },
  },
  {
    min: 190, p: 'P4', msg: 'Heartbeat missing: backup-proxy-litware-02 has not reported for 25 minutes',
    desc: 'The heartbeat "backup-proxy-litware-02" expired. The proxy is used only during the nightly backup window.',
    customers: ['Litware'], tags: ['heartbeat', 'backup'], service: 'Backup', entity: 'backup-proxy-litware-02',
    teams: ['team-servicedesk'], integration: 'Heartbeat', type: 'Heartbeat', source: 'Heartbeat', count: 1,
  },
  {
    min: 214, upd: 120, p: 'P4', status: 'acked', msg: 'Patch compliance below 90% for update group "Windows Server – ring 2"',
    desc: '17 of 143 machines did not install the monthly security update during the maintenance window.',
    customers: ['Wingtip Toys', 'Alpine Ski House'], tags: ['patching', 'compliance'], service: 'Update Management', entity: 'ring-2',
    owner: 'Sofia Lindqvist', teams: ['team-servicedesk'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 1,
    props: { compliance: '88.1%', missingMachines: '17' },
  },
  {
    min: 236, p: 'P4', msg: 'DNS resolver dnspr-hub-weu: query failure rate 3% (threshold 1%)',
    desc: 'Conditional forwarding to the on-premises DNS servers of one customer times out intermittently.',
    customers: ['Northwind Traders'], tags: ['network', 'dns'], service: 'Private DNS', entity: 'dnspr-hub-weu',
    teams: ['team-network'], integration: 'Prometheus', type: 'Prometheus', source: 'alertmanager-weu', count: 8,
    props: { alertname: 'DnsQueryFailureRateHigh', failureRate: '3.1%' },
  },
  {
    min: 262, upd: 250, p: 'P5', msg: 'Cost anomaly: subscription sub-tailspin-dev spent 38% more than forecast yesterday',
    desc: 'A GPU virtual machine scale set was left running after a load test.',
    customers: ['Tailspin Toys'], tags: ['finops', 'dev'], service: 'Cost Management', entity: 'sub-tailspin-dev',
    teams: ['team-servicedesk'], integration: 'Email', type: 'Email', source: 'cost-alerts@tailspin.example', count: 1,
  },
  {
    min: 301, p: 'P4', msg: 'Synthetic check "Customer portal login" failed from 1 of 5 locations (Singapore)',
    desc: 'The login transaction timed out from the Singapore probe. Other locations are healthy.',
    customers: ['Proseware'], tags: ['synthetic', 'portal'], service: 'Customer Portal', entity: 'portal.proseware.example',
    teams: ['team-platform'], integration: 'Grafana', type: 'Grafana', source: 'grafana-synthetics', count: 2,
    props: { probe: 'Singapore', check: 'Customer portal login' },
  },
  {
    min: 356, p: 'P3', msg: 'Internal monitoring: Zabbix proxy zbx-proxy-02 queue above 10,000 values',
    desc: 'The proxy cannot keep up with incoming values after the database disk became slow. Alert delivery from this proxy is delayed by about 6 minutes.',
    tags: ['monitoring', 'internal'], service: 'Monitoring Platform', entity: 'zbx-proxy-02',
    teams: ['team-platform'], integration: 'Zabbix', type: 'Zabbix', source: 'zabbix-core-01', count: 3,
    props: { queue: '10482', delay: '≈6 min' },
  },
  {
    min: 395, upd: 330, p: 'P2', status: 'closed', msg: 'Azure SQL Database sqldb-crm-prod: DTU consumption at 100% for 20 minutes',
    desc: 'A missing index caused full table scans after the CRM release. The index was created and consumption returned to normal.',
    customers: ['Contoso'], tags: ['database', 'prod'], service: 'Azure SQL', entity: 'sqldb-crm-prod',
    owner: 'Priya Nair', teams: ['team-dba'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 6,
    props: { dtu: '100%', resolution: 'Index IX_Contact_Email created' },
  },
  {
    min: 470, upd: 402, p: 'P1', status: 'closed', msg: 'Hub firewall afw-hub-weu: SNAT port exhaustion, outbound connections dropped',
    desc: 'Outbound connections from all spokes failed for 18 minutes. Two additional public IP addresses were attached to the firewall.',
    customers: ['Contoso', 'Fabrikam', 'Litware', 'Woodgrove Bank'], tags: ['network', 'firewall', 'prod', 'hub'], service: 'Azure Firewall', entity: 'afw-hub-weu',
    owner: 'Tomás Herrera', teams: ['team-network'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 19,
    props: { snatUtilisation: '100%', resolution: '2 public IPs added', postIncidentReview: 'scheduled' },
  },
  {
    min: 540, upd: 505, p: 'P3', status: 'closed', msg: 'Kubernetes: 4 pods in CrashLoopBackOff in namespace payments',
    desc: 'A configuration map referenced a secret that had been rotated. Pods recovered after the deployment was restarted.',
    customers: ['Woodgrove Bank'], tags: ['kubernetes', 'prod'], service: 'AKS Platform', entity: 'aks-fin-prod-01',
    owner: 'Daniel Okafor', teams: ['team-platform'], integration: 'Prometheus', type: 'Prometheus', source: 'alertmanager-weu', count: 13,
    props: { alertname: 'KubePodCrashLooping', namespace: 'payments' },
  },
  {
    min: 655, upd: 610, p: 'P4', status: 'closed', msg: 'Disk C: on vm-print-01 below 10% free space',
    desc: 'Old print spooler files were removed.',
    customers: ['Alpine Ski House'], tags: ['compute', 'capacity'], service: 'Print Services', entity: 'vm-print-01',
    owner: 'Yuki Tanaka', teams: ['team-servicedesk'], integration: 'Zabbix', type: 'Zabbix', source: 'zabbix-core-01', count: 2,
  },
  {
    min: 780, upd: 700, p: 'P2', status: 'closed', msg: 'Azure Files sync: server endpoint fs-adw-01 has 2,340 files not syncing',
    desc: 'Sync sessions failed because of a locked database on the server. The storage sync agent was restarted.',
    customers: ['Adventure Works'], tags: ['storage', 'filesync'], service: 'Storage', entity: 'fs-adw-01',
    owner: 'Marcus Oyelaran', teams: ['team-cloud-ops'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 4,
    props: { filesNotSyncing: '2340' },
  },
  {
    min: 905, upd: 890, p: 'P3', msg: 'Conditional Access: 212 sign-ins blocked by policy "Require compliant device" in 1 hour',
    desc: 'The number of blocked sign-ins is five times the weekly baseline. Most blocked devices lost their compliance state after an Intune policy change.',
    customers: ['Wingtip Toys'], tags: ['identity', 'security'], service: 'Identity (Entra ID)', entity: 'ca-policy-compliant-device',
    teams: ['team-identity'], integration: 'Microsoft Sentinel', type: 'API', source: 'sentinel-soc', count: 1,
    props: { blockedSignIns: '212', baseline: '41', policy: 'Require compliant device' },
  },
  {
    min: 1320, upd: 1290, p: 'P5', status: 'closed', msg: 'Test alert from integration "Grafana – staging"',
    desc: 'Connectivity test triggered from the integration settings page.',
    tags: ['test'], entity: 'grafana-staging', integration: 'Grafana', type: 'Grafana', source: 'grafana-staging', count: 1,
  },
  {
    min: 1500, upd: 1440, p: 'P2', status: 'snoozed', msg: 'Azure Site Recovery: replication health critical for 6 protected machines',
    desc: 'Replication for six machines of the disaster recovery plan "rp-litware-tier1" is behind by more than 4 hours. Snoozed until the storage account firewall change is approved.',
    customers: ['Litware'], tags: ['dr', 'replication'], service: 'Site Recovery', entity: 'rsv-dr-neu',
    owner: 'Elena Petrova', teams: ['team-cloud-ops'], integration: 'Azure Monitor', type: 'AzureMonitor', count: 6,
    props: { recoveryPlan: 'rp-litware-tier1', rpo: '4h 12m' },
  },
  {
    min: 2010, upd: 1985, p: 'P4', msg: 'Azure Advisor: 9 virtual machines are candidates for right-sizing in sub-fabrikam-prod',
    desc: 'Weekly recommendation digest.',
    customers: ['Fabrikam'], tags: ['finops', 'advisor'], service: 'Cost Management', entity: 'sub-fabrikam-prod',
    teams: ['team-servicedesk'], integration: 'Email', type: 'Email', source: 'advisor-digest@fabrikam.example', count: 1,
  },
];

function iso(now: number, minutesAgo: number): string {
  return new Date(now - minutesAgo * 60_000).toISOString();
}

function fromSeed(seed: Seed, index: number, now: number): RawAlert {
  const status = seed.status ?? 'open';
  const updated = seed.upd ?? seed.min;
  const tags = [...(seed.tags ?? [])];
  const props: Record<string, string> = { ...(seed.props ?? {}) };
  if (seed.customersInProperty) props.customer = (seed.customers ?? []).join(', ');
  else for (const customer of seed.customers ?? []) tags.push(`customer:${customer}`);
  if (seed.serviceTag) tags.push(`service:${seed.serviceTag}`);
  if (seed.service) props.service = seed.service;

  const id = `demo-${String(index + 1).padStart(4, '0')}-${(index * 2654435761 >>> 0).toString(16).padStart(8, '0')}`;
  return {
    id,
    tinyId: String(4200 + index),
    message: seed.msg,
    description: seed.desc,
    alias: `${seed.type.toLowerCase()}-${seed.entity ?? id}`,
    entity: seed.entity,
    source: seed.source ?? seed.integration,
    status,
    priority: seed.p,
    acknowledged: status === 'acked',
    snoozed: status === 'snoozed',
    seen: status !== 'open' || index % 3 === 0,
    owner: seed.owner,
    count: seed.count ?? 1,
    tags,
    extraProperties: props,
    responders: [
      ...(seed.teams ?? []).map((teamId) => ({ id: teamId, type: 'team' })),
      ...(seed.users ?? []).map((userId) => ({ id: userId, type: 'user' })),
    ],
    actions: [],
    integrationType: seed.type,
    integrationName: seed.integration,
    createdAt: iso(now, seed.min),
    updatedAt: iso(now, updated),
    lastOccuredAt: iso(now, updated),
    ackTime: status === 'acked' ? iso(now, updated) : undefined,
    closeTime: status === 'closed' ? iso(now, updated) : undefined,
    snoozedUntil: status === 'snoozed' ? new Date(now + 4 * 3_600_000).toISOString() : undefined,
  };
}

/** Small deterministic generator, so a large demo set is identical on every start. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the demo data set: the curated alerts above, plus synthetic
 * variations when `extra` > 0 (DEMO_ALERT_COUNT) to test large volumes.
 */
export function buildDemoAlerts(now: number, extra = 0): RawAlert[] {
  const alerts = SEEDS.map((seed, index) => fromSeed(seed, index, now));
  if (extra <= 0) return alerts;

  const random = mulberry32(20_240_517);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const customers = [...new Set(SEEDS.flatMap((s) => s.customers ?? []))];
  const owners = [...new Set(SEEDS.map((s) => s.owner).filter((o): o is string => Boolean(o)))];
  const statuses = ['open', 'open', 'open', 'acked', 'acked', 'snoozed', 'closed', 'closed'] as const;
  const priorities = ['P1', 'P2', 'P2', 'P3', 'P3', 'P3', 'P4', 'P4', 'P5'];

  for (let i = 0; i < extra; i += 1) {
    const base = pick(SEEDS);
    const status = pick(statuses);
    const created = 5 + Math.floor(random() * 60 * 24 * 14);
    const affected = new Set<string>();
    const affectedCount = random() < 0.15 ? 0 : 1 + Math.floor(random() * random() * 5);
    while (affected.size < affectedCount) affected.add(pick(customers));
    alerts.push(
      fromSeed(
        {
          ...base,
          min: created,
          upd: Math.floor(created * random()),
          p: pick(priorities),
          status,
          msg: `${base.msg} [${String(i + 1).padStart(5, '0')}]`,
          customers: [...affected],
          owner: status === 'open' && random() < 0.7 ? undefined : pick(owners),
          count: 1 + Math.floor(random() * random() * 40),
        },
        SEEDS.length + i,
        now,
      ),
    );
  }
  return alerts;
}

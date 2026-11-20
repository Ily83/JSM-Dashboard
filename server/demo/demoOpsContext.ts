import type {
  Heartbeat,
  HeartbeatsResponse,
  Maintenance,
  MaintenancesResponse,
  MaintenanceTarget,
  MaintenanceTargetsResponse,
  NewMaintenanceRequest,
  OnCallResponse,
} from '../../shared/opsContext';
import { JiraApiError } from '../jira/client';
import { coverageOf, sortMaintenances } from '../jira/opsContext';
import type { OpsContextSource } from '../services/opsContext';
import { DEMO_ESCALATIONS, DEMO_SCHEDULES, DEMO_TEAMS, DEMO_USERS } from './demoData';

/**
 * Maintenance windows, heartbeats and on-call for demo mode. Fictional data,
 * in memory; creating and cancelling maintenances changes this copy only.
 */

const MINUTE = 60_000;

const TARGETS: MaintenanceTarget[] = [
  ...['Azure Monitor', 'Datadog', 'Email', 'Grafana', 'Heartbeat', 'Microsoft Sentinel', 'Prometheus', 'Zabbix'].map((name) => ({
    id: `int-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    type: 'integration' as const,
    name,
    teamId: name === 'Zabbix' ? 'team-network' : null,
    enabled: true,
  })),
  { id: 'pol-suppress-dev', type: 'policy', name: 'Suppress dev environments', teamId: null, enabled: true },
  { id: 'pol-maintenance-routing', type: 'policy', name: 'Route to maintenance queue', teamId: null, enabled: false },
  { id: 'sync-itsm', type: 'sync', name: 'ITSM ticket sync', teamId: null, enabled: true },
];

const SCHEDULE_TEAM: Record<string, string> = {
  'sched-cloud-ops': 'team-cloud-ops',
  'sched-dba': 'team-dba',
  'sched-network': 'team-network',
};

interface StoredMaintenance {
  id: string;
  teamId: string | null;
  description: string;
  start: number;
  end: number;
  cancelled: boolean;
  rules: NewMaintenanceRequest['rules'];
}

function maintenanceStatus(m: StoredMaintenance, t: number): Maintenance['status'] {
  if (m.cancelled) return 'cancelled';
  if (t < m.start) return 'planned';
  if (t < m.end) return 'active';
  return 'past';
}

export class DemoOpsContext implements OpsContextSource {
  private readonly stored: StoredMaintenance[];
  private next = 1;

  constructor(private readonly now: () => number = Date.now) {
    const t = now();
    const tomorrow = new Date(t);
    tomorrow.setHours(22, 0, 0, 0);
    if (tomorrow.getTime() <= t) tomorrow.setDate(tomorrow.getDate() + 1);
    this.stored = [
      {
        id: 'mnt-demo-zabbix',
        teamId: 'team-network',
        description: 'Zabbix proxy upgrade',
        start: t - 20 * MINUTE,
        end: t + 100 * MINUTE,
        cancelled: false,
        rules: [{ entity: { id: 'int-zabbix', type: 'integration' }, state: 'disabled' }],
      },
      {
        id: 'mnt-demo-patching',
        teamId: null,
        description: 'Monthly patching window',
        start: tomorrow.getTime(),
        end: tomorrow.getTime() + 4 * 60 * MINUTE,
        cancelled: false,
        rules: [
          { entity: { id: 'int-azure-monitor', type: 'integration' }, state: 'disabled' },
          { entity: { id: 'pol-maintenance-routing', type: 'policy' }, state: 'enabled' },
        ],
      },
    ];
  }

  private view(m: StoredMaintenance): Maintenance {
    const status = maintenanceStatus(m, this.now());
    return {
      id: m.id,
      teamId: m.teamId,
      teamName: m.teamId ? (DEMO_TEAMS.get(m.teamId) ?? null) : null,
      status,
      description: m.description,
      startDate: m.start,
      endDate: m.end,
      rules: m.rules.map((r) => ({ ...r, name: TARGETS.find((x) => x.id === r.entity.id && x.type === r.entity.type)?.name ?? null })),
    };
  }

  async maintenances(): Promise<MaintenancesResponse> {
    const maintenances = sortMaintenances(this.stored.map((m) => this.view(m)).filter((m) => m.status === 'active' || m.status === 'planned'));
    return { maintenances, coverage: coverageOf(maintenances) };
  }

  async maintenanceTargets(): Promise<MaintenanceTargetsResponse> {
    return { teams: [...DEMO_TEAMS].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), targets: TARGETS };
  }

  async createMaintenance(request: NewMaintenanceRequest): Promise<Maintenance> {
    if (request.teamId && !DEMO_TEAMS.has(request.teamId)) throw new JiraApiError('validation', 422, 'Jira rejected the request (422).');
    for (const rule of request.rules) {
      if (!TARGETS.some((x) => x.id === rule.entity.id && x.type === rule.entity.type)) {
        throw new JiraApiError('validation', 422, 'Jira rejected the request (422).');
      }
    }
    const stored: StoredMaintenance = {
      id: `mnt-demo-${this.next++}`,
      teamId: request.teamId,
      description: request.description,
      start: Date.parse(request.startDate),
      end: Date.parse(request.endDate),
      cancelled: false,
      rules: request.rules,
    };
    this.stored.push(stored);
    return this.view(stored);
  }

  async cancelMaintenance(id: string, teamId: string | null): Promise<Maintenance> {
    const found = this.stored.find((m) => m.id === id && m.teamId === teamId);
    if (!found) throw new JiraApiError('not_found', 404, 'Jira did not find it (404). The maintenance may have ended.');
    found.cancelled = true;
    return this.view(found);
  }

  async heartbeats(): Promise<HeartbeatsResponse> {
    const t = (name: string, teamId: string, status: Heartbeat['status'], interval: number, unit: string): Heartbeat => ({
      name,
      teamId,
      teamName: DEMO_TEAMS.get(teamId) ?? null,
      status,
      enabled: status !== 'Off',
      interval,
      intervalUnit: unit,
      description: null,
    });
    return {
      heartbeats: [
        t('backup-proxy-litware-02', 'team-cloud-ops', 'Unresponsive', 10, 'Minutes'),
        t('zabbix-proxy-02', 'team-network', 'Responsive', 5, 'Minutes'),
        t('prometheus-prod-weu', 'team-platform', 'Responsive', 1, 'Minutes'),
        t('sentinel-connector', 'team-identity', 'Responsive', 15, 'Minutes'),
        t('etl-nightly', 'team-dba', 'Off', 1, 'Days'),
      ],
      failedTeams: 0,
    };
  }

  async onCall(): Promise<OnCallResponse> {
    // Rotates through the fictional people every hour, so the widget changes over a day.
    const hour = Math.floor(this.now() / 3_600_000);
    return {
      schedules: DEMO_SCHEDULES.map((schedule, i) => {
        const teamId = SCHEDULE_TEAM[schedule.id] ?? null;
        const user = DEMO_USERS[(hour + i * 2) % DEMO_USERS.length];
        const escalation = teamId ? DEMO_ESCALATIONS[teamId]?.[0] : undefined;
        return {
          id: schedule.id,
          name: schedule.name,
          teamName: teamId ? (DEMO_TEAMS.get(teamId) ?? null) : null,
          onCall: [
            { id: user.accountId, type: 'user', name: user.displayName },
            ...(escalation && i === 0 ? [{ id: escalation.id, type: 'escalation', name: escalation.name }] : []),
          ],
          error: false,
        };
      }),
    };
  }
}

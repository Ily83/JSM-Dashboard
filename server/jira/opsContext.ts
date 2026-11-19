import type { DirectoryEntry } from '../../shared/actions';
import {
  MAINTENANCE_STATUSES,
  type Heartbeat,
  type HeartbeatsResponse,
  type HeartbeatStatus,
  type Maintenance,
  type MaintenanceEntityType,
  type MaintenancesResponse,
  type MaintenanceTarget,
  type MaintenanceTargetsResponse,
  type NewMaintenanceRequest,
  type OnCallParticipant,
  type OnCallResponse,
} from '../../shared/opsContext';
import { log } from '../logger';
import type { OpsContextSource } from '../services/opsContext';
import { JiraApiError, type JiraClient } from './client';
import type { RawMaintenance, RawOnCallParticipant } from './schemas';

/**
 * Live maintenances, heartbeats and on-call from the JSM Operations API.
 *
 * Request budget: these lists are only asked for while the matching widget
 * is shown, and every result is cached, so a dozen open browsers still cost
 * one request per list and TTL. Per-team and per-schedule requests are made
 * two at a time and capped.
 */

const LIST_TTL_MS = 60_000;
const DIRECTORY_TTL_MS = 5 * 60_000;
const MAX_TEAMS = 25;
const MAX_SCHEDULES = 25;

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

function cached<T>(entry: Cached<T> | null, ttl: number, load: () => Promise<T>): Cached<T> {
  if (entry && Date.now() - entry.at < ttl) return entry;
  const next: Cached<T> = { at: Date.now(), value: load() };
  next.value.catch(() => {
    next.at = 0; // a failure is not kept
  });
  return next;
}

/** Runs `task` over `items`, two at a time. */
async function twoAtATime<T, R>(items: readonly T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  };
  await Promise.all([worker(), worker()]);
  return results;
}

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const ENTITY_TYPES: ReadonlySet<string> = new Set(['integration', 'policy', 'sync']);

export function mapMaintenance(raw: RawMaintenance, teamId: string | null, teamNames: ReadonlyMap<string, string>, entityNames: ReadonlyMap<string, string>): Maintenance {
  const status = (raw.status ?? '').toLowerCase();
  const owner = raw.teamId ?? teamId;
  return {
    id: raw.id,
    teamId: owner ?? null,
    teamName: owner ? (teamNames.get(owner) ?? null) : null,
    status: (MAINTENANCE_STATUSES as readonly string[]).includes(status) ? (status as Maintenance['status']) : 'unknown',
    description: raw.description?.trim() || '',
    startDate: toTime(raw.startDate),
    endDate: toTime(raw.endDate),
    rules: (raw.rules ?? []).flatMap((rule) => {
      const type = (rule.entity?.type ?? '').toLowerCase();
      const id = rule.entity?.id;
      if (!id || !ENTITY_TYPES.has(type)) return [];
      return [
        {
          entity: { id, type: type as MaintenanceEntityType },
          state: rule.state === 'enabled' ? ('enabled' as const) : ('disabled' as const),
          name: entityNames.get(`${type}:${id}`) ?? null,
        },
      ];
    }),
  };
}

/** Integration names disabled by an active maintenance: the alerts they created are covered. */
export function coverageOf(maintenances: readonly Maintenance[]): MaintenancesResponse['coverage'] {
  const coverage: MaintenancesResponse['coverage'] = [];
  const seen = new Set<string>();
  for (const m of maintenances) {
    if (m.status !== 'active') continue;
    for (const rule of m.rules) {
      if (rule.entity.type !== 'integration' || rule.state !== 'disabled' || !rule.name) continue;
      const key = rule.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      coverage.push({ integrationName: rule.name, maintenanceId: m.id });
    }
  }
  return coverage;
}

export function sortMaintenances(list: Maintenance[]): Maintenance[] {
  const rank = (m: Maintenance) => (m.status === 'active' ? 0 : m.status === 'planned' ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || (a.startDate ?? 0) - (b.startDate ?? 0));
}

const HEARTBEAT_STATUSES: ReadonlySet<string> = new Set(['Unresponsive', 'Responsive', 'Off', 'Pending']);

/** Flattens the on-call tree: groups (team, escalation, schedule) and the people under them, each once. */
export function flattenOnCall(nodes: readonly RawOnCallParticipant[], name: (type: string, id: string) => string | null): OnCallParticipant[] {
  const out: OnCallParticipant[] = [];
  const seen = new Set<string>();
  const visit = (node: RawOnCallParticipant) => {
    const id = node.id ?? '';
    const type = (node.type ?? 'unknown').toLowerCase();
    if (id && type !== 'noone' && !seen.has(`${type}:${id}`)) {
      seen.add(`${type}:${id}`);
      out.push({ id, type, name: name(type, id) });
    }
    for (const child of node.onCallParticipants ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}

export class JiraOpsContext implements OpsContextSource {
  private maintenancesCache: Cached<MaintenancesResponse> | null = null;
  private heartbeatsCache: Cached<HeartbeatsResponse> | null = null;
  private onCallCache: Cached<OnCallResponse> | null = null;
  private schedulesCache: Cached<Array<{ id: string; name: string; teamId: string | null }>> | null = null;
  private readonly entityCache = new Map<MaintenanceEntityType, Cached<MaintenanceTarget[]>>();

  constructor(
    private readonly client: JiraClient,
    /** Team list, shared with the pickers (cached there). */
    private readonly teams: () => Promise<DirectoryEntry[]>,
    private readonly escalations: (teamId: string) => Promise<DirectoryEntry[]>,
  ) {}

  private async teamList(): Promise<DirectoryEntry[]> {
    try {
      return await this.teams();
    } catch {
      return []; // without the team list, only global data is shown
    }
  }

  private entities(kind: MaintenanceEntityType): Promise<MaintenanceTarget[]> {
    const entry = cached(this.entityCache.get(kind) ?? null, DIRECTORY_TTL_MS, async () =>
      (await this.client.listMaintenanceEntities(kind)).map((e) => ({
        id: e.id,
        type: kind,
        name: e.name?.trim() || e.id,
        teamId: e.teamId ?? null,
        enabled: e.enabled ?? null,
      })),
    );
    this.entityCache.set(kind, entry);
    return entry.value;
  }

  // ---- Maintenances ------------------------------------------------------------

  maintenances(): Promise<MaintenancesResponse> {
    this.maintenancesCache = cached(this.maintenancesCache, LIST_TTL_MS, () => this.loadMaintenances());
    return this.maintenancesCache.value;
  }

  private async loadMaintenances(): Promise<MaintenancesResponse> {
    const teams = (await this.teamList()).slice(0, MAX_TEAMS);
    const teamNames = new Map(teams.map((t) => [t.id, t.name]));
    // The global list must work; team lists that fail are left out.
    const global = await this.client.listMaintenances();
    const perTeam = await twoAtATime(teams, async (team) => {
      try {
        return (await this.client.listMaintenances(team.id)).map((raw) => ({ raw, teamId: team.id }));
      } catch {
        return [];
      }
    });
    const raws = [...global.map((raw) => ({ raw, teamId: null as string | null })), ...perTeam.flat()];

    // Names of the entities the rules point at; only the kinds actually used are loaded.
    const kinds = new Set<MaintenanceEntityType>();
    for (const { raw } of raws) for (const rule of raw.rules ?? []) {
      const type = (rule.entity?.type ?? '').toLowerCase();
      if (ENTITY_TYPES.has(type)) kinds.add(type as MaintenanceEntityType);
    }
    const entityNames = new Map<string, string>();
    for (const kind of kinds) {
      try {
        for (const e of await this.entities(kind)) entityNames.set(`${kind}:${e.id}`, e.name);
      } catch {
        // Names unknown: rules are shown by type, and no alert is marked as covered.
      }
    }
    const maintenances = sortMaintenances(
      raws
        .map(({ raw, teamId }) => mapMaintenance(raw, teamId, teamNames, entityNames))
        .filter((m) => m.status === 'active' || m.status === 'planned'),
    );
    return { maintenances, coverage: coverageOf(maintenances) };
  }

  async maintenanceTargets(): Promise<MaintenanceTargetsResponse> {
    const teams = await this.teamList();
    const lists = await Promise.all(
      (['integration', 'policy', 'sync'] as const).map((kind) =>
        this.entities(kind).catch((error: unknown) => {
          // A plan or permission may hide one kind; the others still help.
          log.warn('could not list maintenance targets', { kind, status: error instanceof JiraApiError ? (error.status ?? 'none') : 'none' });
          return [] as MaintenanceTarget[];
        }),
      ),
    );
    const targets = lists.flat().sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    return { teams: teams.map((t) => ({ id: t.id, name: t.name })), targets };
  }

  async createMaintenance(request: NewMaintenanceRequest): Promise<Maintenance> {
    const raw = await this.client.createMaintenance(
      { description: request.description, startDate: request.startDate, endDate: request.endDate, rules: request.rules },
      request.teamId,
    );
    this.maintenancesCache = null;
    return this.mapOne(raw, request.teamId);
  }

  async cancelMaintenance(id: string, teamId: string | null): Promise<Maintenance> {
    const raw = await this.client.cancelMaintenance(id, teamId);
    this.maintenancesCache = null;
    return this.mapOne(raw, teamId);
  }

  private async mapOne(raw: RawMaintenance, teamId: string | null): Promise<Maintenance> {
    const teamNames = new Map((await this.teamList()).map((t) => [t.id, t.name]));
    const entityNames = new Map<string, string>();
    for (const kind of ['integration', 'policy', 'sync'] as const) {
      const entry = this.entityCache.get(kind);
      if (!entry) continue;
      try {
        for (const e of await entry.value) entityNames.set(`${kind}:${e.id}`, e.name);
      } catch {
        // ignore
      }
    }
    return mapMaintenance(raw, teamId, teamNames, entityNames);
  }

  // ---- Heartbeats --------------------------------------------------------------

  heartbeats(): Promise<HeartbeatsResponse> {
    this.heartbeatsCache = cached(this.heartbeatsCache, LIST_TTL_MS, async () => {
      const teams = (await this.teamList()).slice(0, MAX_TEAMS);
      let failedTeams = 0;
      const lists = await twoAtATime(teams, async (team) => {
        try {
          return (await this.client.listHeartbeats(team.id)).map<Heartbeat>((h) => ({
            name: h.name,
            teamId: h.ownerTeamId ?? team.id,
            teamName: team.name,
            status: h.status && HEARTBEAT_STATUSES.has(h.status) ? (h.status as HeartbeatStatus) : 'unknown',
            enabled: h.enabled !== false,
            interval: h.interval ?? null,
            intervalUnit: h.intervalUnit ?? null,
            description: h.description ?? null,
          }));
        } catch {
          failedTeams += 1;
          return [];
        }
      });
      return { heartbeats: lists.flat(), failedTeams };
    });
    return this.heartbeatsCache.value;
  }

  // ---- On call -----------------------------------------------------------------

  onCall(): Promise<OnCallResponse> {
    this.onCallCache = cached(this.onCallCache, LIST_TTL_MS, () => this.loadOnCall());
    return this.onCallCache.value;
  }

  private async loadOnCall(): Promise<OnCallResponse> {
    this.schedulesCache = cached(this.schedulesCache, DIRECTORY_TTL_MS, async () =>
      (await this.client.listScheduleDetails())
        .filter((s) => s.enabled !== false)
        .map((s) => ({ id: s.id, name: s.name?.trim() || s.id, teamId: s.teamId ?? null })),
    );
    const schedules = (await this.schedulesCache.value).slice(0, MAX_SCHEDULES);
    const teams = await this.teamList();
    const teamNames = new Map(teams.map((t) => [t.id, t.name]));

    const results = await twoAtATime(schedules, async (schedule) => {
      const escalationNames = new Map<string, string>();
      if (schedule.teamId) {
        try {
          for (const e of await this.escalations(schedule.teamId)) escalationNames.set(e.id, e.name);
        } catch {
          // names stay unknown
        }
      }
      const name = (type: string, id: string): string | null => {
        if (type === 'team') return teamNames.get(id) ?? null;
        if (type === 'escalation') return escalationNames.get(id) ?? null;
        // The Operations API returns user ids only, without names.
        return null;
      };
      try {
        const nodes = await this.client.listOnCall(schedule.id);
        return { id: schedule.id, name: schedule.name, teamName: schedule.teamId ? (teamNames.get(schedule.teamId) ?? null) : null, onCall: flattenOnCall(nodes, name), error: false };
      } catch {
        return { id: schedule.id, name: schedule.name, teamName: schedule.teamId ? (teamNames.get(schedule.teamId) ?? null) : null, onCall: [], error: true };
      }
    });
    return { schedules: results };
  }
}

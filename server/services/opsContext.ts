import { z } from 'zod';
import {
  MAINTENANCE_DESCRIPTION_MAX,
  MAINTENANCE_MAX_DAYS,
  MAINTENANCE_MAX_RULES,
  type HeartbeatsResponse,
  type Maintenance,
  type MaintenancesResponse,
  type MaintenanceTargetsResponse,
  type NewMaintenanceRequest,
  type OnCallResponse,
} from '../../shared/opsContext';
import { log } from '../logger';
import { ActionRequestError } from './operations';

/**
 * Operations context around the alerts: maintenance windows, heartbeats and
 * on-call. Implemented by JiraOpsContext (live) and DemoOpsContext.
 */
export interface OpsContextSource {
  maintenances(): Promise<MaintenancesResponse>;
  /** Teams and the entities a new maintenance can switch off. */
  maintenanceTargets(): Promise<MaintenanceTargetsResponse>;
  createMaintenance(request: NewMaintenanceRequest): Promise<Maintenance>;
  cancelMaintenance(id: string, teamId: string | null): Promise<Maintenance>;
  heartbeats(): Promise<HeartbeatsResponse>;
  onCall(): Promise<OnCallResponse>;
}

// ---- Validation -------------------------------------------------------------

const ID = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9:._-]+$/, 'invalid id');

const NewMaintenanceSchema = z.object({
  description: z.string().trim().min(1).max(MAINTENANCE_DESCRIPTION_MAX),
  startDate: z.iso.datetime({ offset: true }),
  endDate: z.iso.datetime({ offset: true }),
  teamId: ID.nullable(),
  rules: z
    .array(
      z.object({
        entity: z.object({ id: ID, type: z.enum(['integration', 'policy', 'sync']) }),
        state: z.enum(['disabled', 'enabled']),
      }),
    )
    .min(1)
    .max(MAINTENANCE_MAX_RULES),
});

const CancelSchema = z.object({ teamId: ID.nullable() });

/** A start this far in the past is still accepted, for clocks that are slightly off. */
const START_TOLERANCE_MS = 5 * 60_000;
const MAX_LEAD_DAYS = 30;

function fields(error: z.ZodError): string {
  return [...new Set(error.issues.map((i) => i.path.join('.') || 'body'))].join(', ');
}

/** Validates a new maintenance window, or throws ActionRequestError (400). */
export function parseNewMaintenance(body: unknown, now = Date.now()): NewMaintenanceRequest {
  const parsed = NewMaintenanceSchema.safeParse(body);
  // Field names only, never the submitted values.
  if (!parsed.success) throw new ActionRequestError(400, `Invalid maintenance (${fields(parsed.error)}).`);
  const request = parsed.data;
  const start = Date.parse(request.startDate);
  const end = Date.parse(request.endDate);
  if (start < now - START_TOLERANCE_MS) throw new ActionRequestError(400, 'The maintenance cannot start in the past.');
  if (start > now + MAX_LEAD_DAYS * 86_400_000) throw new ActionRequestError(400, `Start within the next ${MAX_LEAD_DAYS} days.`);
  if (end < start + 60_000) throw new ActionRequestError(400, 'The end must be at least one minute after the start.');
  if (end - start > MAINTENANCE_MAX_DAYS * 86_400_000) throw new ActionRequestError(400, `A maintenance can last at most ${MAINTENANCE_MAX_DAYS} days.`);
  for (const rule of request.rules) {
    // Documented: integrations and syncs cannot be enabled by a maintenance.
    if (rule.entity.type !== 'policy' && rule.state !== 'disabled') {
      throw new ActionRequestError(400, 'Integrations and syncs can only be disabled during a maintenance.');
    }
  }
  const seen = new Set<string>();
  const rules = request.rules.filter((r) => {
    const key = `${r.entity.type}:${r.entity.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    description: request.description,
    startDate: new Date(start).toISOString(),
    endDate: new Date(end).toISOString(),
    teamId: request.teamId,
    rules,
  };
}

export function parseCancelMaintenance(body: unknown): { teamId: string | null } {
  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) throw new ActionRequestError(400, `Invalid request (${fields(parsed.error)}).`);
  return parsed.data;
}

/**
 * Gatekeeper for maintenance writes, like ActionService for alert actions:
 * refused unless "maintenance" is enabled in JIRA_WRITE_ACTIONS, validated,
 * and logged with the action, the maintenance id and the outcome only.
 */
export class MaintenanceService {
  constructor(
    private readonly source: OpsContextSource,
    private readonly enabled: boolean,
  ) {}

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new ActionRequestError(403, 'Maintenance windows are not enabled. Add "maintenance" to JIRA_WRITE_ACTIONS in .env.');
    }
  }

  async create(body: unknown): Promise<Maintenance> {
    this.requireEnabled();
    const request = parseNewMaintenance(body);
    const started = Date.now();
    try {
      const created = await this.source.createMaintenance(request);
      log.info('maintenance action', { action: 'create', maintenance: created.id, scope: request.teamId ? 'team' : 'global', rules: request.rules.length, ms: Date.now() - started });
      return created;
    } catch (error) {
      log.warn('maintenance action failed', { action: 'create', ms: Date.now() - started });
      throw error;
    }
  }

  async cancel(id: string, body: unknown): Promise<Maintenance> {
    this.requireEnabled();
    const { teamId } = parseCancelMaintenance(body);
    const started = Date.now();
    try {
      const cancelled = await this.source.cancelMaintenance(id, teamId);
      log.info('maintenance action', { action: 'cancel', maintenance: id, ms: Date.now() - started });
      return cancelled;
    } catch (error) {
      log.warn('maintenance action failed', { action: 'cancel', maintenance: id, ms: Date.now() - started });
      throw error;
    }
  }
}

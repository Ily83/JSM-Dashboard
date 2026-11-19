/**
 * Operations context around the alerts: maintenance windows, heartbeats and
 * who is on call. All of it comes from the Jira Service Management Operations
 * REST API (base https://api.atlassian.com/jsm/ops/api/{cloudId}):
 *
 *   GET  /v1/maintenances?type=non-expired               List global maintenances
 *   GET  /v1/teams/{teamId}/maintenances?type=non-expired List team maintenances
 *   POST /v1/maintenances                                 Create global maintenance
 *   POST /v1/teams/{teamId}/maintenances                  Create team maintenance
 *   POST /v1/maintenances/{id}/cancel                     Cancel global maintenance
 *   POST /v1/teams/{teamId}/maintenances/{id}/cancel      Cancel team maintenance
 *   GET  /v1/integrations, /v1/alerts/policies, /v1/syncs  What a maintenance can switch off
 *   GET  /v1/teams/{teamId}/heartbeats                    List heartbeats
 *   GET  /v1/schedules, /v1/schedules/{id}/on-calls       Who is on call
 *
 * A maintenance does not name alerts. It disables integrations, syncs or
 * policies (or enables policies) for a time window. Alerts carry the name of
 * the integration that created them, so the only coverage that can be shown
 * is "this alert's integration is disabled by an active maintenance".
 */

export const MAINTENANCE_STATUSES = ['planned', 'active', 'past', 'cancelled'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const MAINTENANCE_ENTITY_TYPES = ['integration', 'policy', 'sync'] as const;
export type MaintenanceEntityType = (typeof MAINTENANCE_ENTITY_TYPES)[number];

export interface MaintenanceRule {
  entity: { id: string; type: MaintenanceEntityType };
  /** Integrations and syncs can only be disabled; policies can be enabled or disabled. */
  state: 'disabled' | 'enabled';
}

export interface Maintenance {
  id: string;
  /** Null for a global maintenance. */
  teamId: string | null;
  teamName: string | null;
  status: MaintenanceStatus | 'unknown';
  description: string;
  /** Epoch milliseconds. */
  startDate: number | null;
  endDate: number | null;
  rules: Array<MaintenanceRule & { name: string | null }>;
}

/** Something a maintenance can switch off (or on, for policies). */
export interface MaintenanceTarget {
  id: string;
  type: MaintenanceEntityType;
  name: string;
  /** Owning team, when the entity belongs to one. */
  teamId: string | null;
  enabled: boolean | null;
}

export interface MaintenancesResponse {
  /** Active and planned maintenances, global and per team, soonest first. */
  maintenances: Maintenance[];
  /**
   * Integration names disabled by an active maintenance, with the maintenance
   * id: an alert whose integrationName is listed here is covered.
   */
  coverage: Array<{ integrationName: string; maintenanceId: string }>;
}

export interface MaintenanceTargetsResponse {
  teams: Array<{ id: string; name: string }>;
  targets: MaintenanceTarget[];
}

/** POST /api/maintenances */
export interface NewMaintenanceRequest {
  description: string;
  /** ISO date-time. */
  startDate: string;
  endDate: string;
  /** Null for a global maintenance. */
  teamId: string | null;
  rules: MaintenanceRule[];
}

export const MAINTENANCE_DESCRIPTION_MAX = 200;
export const MAINTENANCE_MAX_DAYS = 14;
export const MAINTENANCE_MAX_RULES = 100;

export type HeartbeatStatus = 'Unresponsive' | 'Responsive' | 'Off' | 'Pending' | 'unknown';

export interface Heartbeat {
  name: string;
  teamId: string;
  teamName: string | null;
  status: HeartbeatStatus;
  enabled: boolean;
  interval: number | null;
  intervalUnit: string | null;
  description: string | null;
}

export interface HeartbeatsResponse {
  heartbeats: Heartbeat[];
  /** Teams whose heartbeats could not be read. */
  failedTeams: number;
}

export interface OnCallParticipant {
  id: string;
  type: string;
  /** Known for teams and escalations; null for users (the Operations API returns user ids only). */
  name: string | null;
}

export interface OnCallSchedule {
  id: string;
  name: string;
  teamName: string | null;
  /** People and groups on call now, flattened; empty when nobody is. */
  onCall: OnCallParticipant[];
  /** The on-call request for this schedule failed. */
  error: boolean;
}

export interface OnCallResponse {
  schedules: OnCallSchedule[];
}

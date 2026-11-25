import { z } from 'zod';

/**
 * Runtime validation of Jira Service Management Operations responses.
 *
 * Field names follow the official OpenAPI document
 * (https://dac-static.atlassian.com/cloud/jira/service-desk-ops/swagger.v3.json,
 * schemas AlertResponse, ListAlertResponse, Responder, PlatformTeamDto).
 *
 * The schemas are deliberately tolerant: only `id` is required, unknown
 * fields are kept, and nulls are accepted, so a new or missing field in Jira
 * degrades one column instead of breaking the whole synchronisation.
 */

export const RawResponderSchema = z.looseObject({
  id: z.string(),
  type: z.string().nullish(),
});

export const RawAlertSchema = z.looseObject({
  id: z.string().min(1),
  tinyId: z.union([z.string(), z.number()]).nullish(),
  message: z.string().nullish(),
  description: z.string().nullish(),
  alias: z.string().nullish(),
  entity: z.string().nullish(),
  source: z.string().nullish(),
  status: z.string().nullish(),
  priority: z.string().nullish(),
  acknowledged: z.boolean().nullish(),
  snoozed: z.boolean().nullish(),
  seen: z.boolean().nullish(),
  owner: z.string().nullish(),
  count: z.number().nullish(),
  tags: z.array(z.string()).nullish(),
  // Documented as string values, but treated as unknown and stringified.
  extraProperties: z.record(z.string(), z.unknown()).nullish(),
  responders: z.array(RawResponderSchema).nullish(),
  actions: z.array(z.string()).nullish(),
  integrationType: z.string().nullish(),
  integrationName: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  // The API spells this field "lastOccuredAt" (one r).
  lastOccuredAt: z.string().nullish(),
  ackTime: z.string().nullish(),
  closeTime: z.string().nullish(),
  snoozedUntil: z.string().nullish(),
});
export type RawAlert = z.infer<typeof RawAlertSchema>;

/** Items are validated one by one so a single bad alert is skipped, not fatal. */
export const ListAlertsResponseSchema = z.looseObject({
  values: z.array(z.unknown()).nullish(),
  count: z.number().nullish(),
  links: z.looseObject({ next: z.string().nullish() }).nullish(),
});

export const ListTeamsResponseSchema = z.array(
  z.looseObject({ teamId: z.string(), teamName: z.string().nullish() }),
);

export const TenantInfoSchema = z.looseObject({ cloudId: z.string().min(1) });

// ---- Write actions and the read-only extras around them -----------------
// Schemas SuccessResponse, AlertNote, AlertLog, AlertAttachmentDto,
// EscalationResponse and Schedule of the same OpenAPI document; users come
// from the Jira platform REST API v3 (User).

/** 202 answer of every asynchronous action. */
export const AcceptedResponseSchema = z.looseObject({
  result: z.string().nullish(),
  requestId: z.string().nullish(),
});

/** GET /v1/alerts/requests/{id} */
export const RequestStatusSchema = z.looseObject({
  action: z.string().nullish(),
  processedAt: z.string().nullish(),
  isSuccess: z.boolean().nullish(),
  status: z.string().nullish(),
  alertId: z.string().nullish(),
});

const NextLinkSchema = z.looseObject({ next: z.string().nullish() }).nullish();

export const NoteSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  createdAt: z.string().nullish(),
  note: z.string().nullish(),
  owner: z.string().nullish(),
});
export const NotesPageSchema = z.looseObject({ values: z.array(z.unknown()).nullish(), links: NextLinkSchema });

export const LogSchema = z.looseObject({
  logTime: z.string().nullish(),
  logType: z.string().nullish(),
  log: z.string().nullish(),
  owner: z.string().nullish(),
});
export const LogsPageSchema = z.looseObject({ values: z.array(z.unknown()).nullish(), links: NextLinkSchema });

// The OpenAPI document names the fields attachmentName and insertedAt; the
// live API (checked 2026-11-19) returns name and createdAt. Both are read.
export const AttachmentSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  attachmentName: z.string().nullish(),
  name: z.string().nullish(),
  insertedAt: z.string().nullish(),
  createdAt: z.string().nullish(),
});
export const AttachmentsPageSchema = z.looseObject({ values: z.array(z.unknown()).nullish(), links: NextLinkSchema });
export const AttachmentUrlSchema = z.looseObject({ url: z.url({ protocol: /^https$/ }) });

const NamedSchema = z.looseObject({ id: z.string().min(1), name: z.string().nullish(), enabled: z.boolean().nullish() });
export const SchedulesPageSchema = z.looseObject({ values: z.array(z.unknown()).nullish(), links: NextLinkSchema });
export const EscalationsPageSchema = z.looseObject({ values: z.array(z.unknown()).nullish(), links: NextLinkSchema });
export { NamedSchema };

/** Jira platform: GET /rest/api/3/user/search and GET /rest/api/3/myself */
export const PlatformUserSchema = z.looseObject({
  accountId: z.string().min(1),
  accountType: z.string().nullish(),
  displayName: z.string().nullish(),
  active: z.boolean().nullish(),
});
export const PlatformUsersSchema = z.array(z.unknown());

// ---- Operations context: maintenances, integrations, heartbeats, on-call ------
// Schemas GetGlobalMaintenance, GetTeamMaintenance, MaintenanceRule,
// Integration list, alert policy list, sync list, Heartbeat, Schedule and
// OnCallResponse of the same OpenAPI document.

const MaintenanceRuleSchema = z.looseObject({
  entity: z.looseObject({ id: z.string().nullish(), type: z.string().nullish() }).nullish(),
  state: z.string().nullish(),
});

export const MaintenanceSchema = z.looseObject({
  id: z.string().min(1),
  teamId: z.string().nullish(),
  status: z.string().nullish(),
  description: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  rules: z.array(MaintenanceRuleSchema).nullish(),
});
export type RawMaintenance = z.infer<typeof MaintenanceSchema>;

export const PagedValuesSchema = z.looseObject({
  values: z.array(z.unknown()).nullish(),
  links: z.looseObject({ next: z.string().nullish() }).nullish(),
});

/** Integrations, syncs and alert policies share these fields. */
export const OpsEntitySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().nullish(),
  type: z.string().nullish(),
  enabled: z.boolean().nullish(),
  teamId: z.string().nullish(),
});

export const ScheduleSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().nullish(),
  enabled: z.boolean().nullish(),
  teamId: z.string().nullish(),
});

export const HeartbeatSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string().nullish(),
  interval: z.number().nullish(),
  intervalUnit: z.string().nullish(),
  enabled: z.boolean().nullish(),
  status: z.string().nullish(),
  ownerTeamId: z.string().nullish(),
});

export interface RawOnCallParticipant {
  id?: string | null;
  type?: string | null;
  onCallParticipants?: RawOnCallParticipant[] | null;
}
const OnCallParticipantSchema: z.ZodType<RawOnCallParticipant> = z.lazy(() =>
  z.looseObject({
    id: z.string().nullish(),
    type: z.string().nullish(),
    onCallParticipants: z.array(OnCallParticipantSchema).nullish(),
  }),
);
export const OnCallResponseSchema = z.looseObject({
  onCallParticipants: z.array(OnCallParticipantSchema).nullish(),
  onCallUsers: z.array(z.string()).nullish(),
});

// ---- Personal notification settings (contacts, notification rules) ----------

export const RawContactSchema = z.looseObject({
  id: z.string().min(1),
  method: z.string(),
  to: z.string(),
  status: z.looseObject({ enabled: z.boolean().nullish() }).nullish(),
  applyOrder: z.number().nullish(),
});
export type RawContact = z.infer<typeof RawContactSchema>;

const RawTimeSchema = { startHour: z.number(), startMin: z.number(), endHour: z.number(), endMin: z.number() };
export const RawNotificationRuleSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().nullish(),
  actionType: z.string(),
  enabled: z.boolean().nullish(),
  order: z.number().nullish(),
  criteria: z.looseObject({
    type: z.string(),
    query: z.string().nullish(),
    conditions: z.array(z.looseObject({
      field: z.string(), key: z.string().nullish(), not: z.boolean().nullish(), operation: z.string(), expectedValue: z.string().nullish(),
    })).nullish(),
  }).nullish(),
  timeRestriction: z.union([
    z.looseObject({ type: z.literal('time-of-day'), restriction: z.looseObject(RawTimeSchema) }),
    z.looseObject({ type: z.literal('weekday-and-time-of-day'), restrictions: z.array(z.looseObject({ ...RawTimeSchema, startDay: z.string(), endDay: z.string() })) }),
  ]).nullish(),
  notificationTime: z.array(z.string()).nullish(),
  repeat: z.looseObject({ enabled: z.boolean().nullish(), loopAfter: z.number().nullish() }).nullish(),
  steps: z.array(z.looseObject({
    id: z.string().min(1), sendAfter: z.number().nullish(), enabled: z.boolean().nullish(),
    contact: z.looseObject({ method: z.string(), to: z.string() }),
  })).nullish(),
});
export type RawNotificationRule = z.infer<typeof RawNotificationRuleSchema>;

export const CreatedIdSchema = z.looseObject({ id: z.string().min(1) });

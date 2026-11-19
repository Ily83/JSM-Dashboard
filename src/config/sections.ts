import type { Alert, AlertStatus, Priority } from '../../shared/types';

/**
 * Sidebar sections. A section is a fixed scope over the cached alert list;
 * filters narrow within it. Adding a section means adding an entry here.
 */
export const SECTION_IDS = ['all', 'critical', 'active', 'acknowledged', 'resolved'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface SectionDef {
  id: SectionId;
  label: string;
  /** Values the section allows. Filters can narrow within them, not widen. */
  priority?: Priority[];
  status?: AlertStatus[];
}

const ACTIVE: AlertStatus[] = ['open', 'acked', 'snoozed'];

export const SECTIONS: Record<SectionId, SectionDef> = {
  all: { id: 'all', label: 'Alert Center' },
  critical: { id: 'critical', label: 'Critical Alerts', priority: ['P1'], status: ACTIVE },
  active: { id: 'active', label: 'Active Alerts', status: ACTIVE },
  acknowledged: { id: 'acknowledged', label: 'Acknowledged Alerts', status: ['acked'] },
  resolved: { id: 'resolved', label: 'Resolved Alerts', status: ['closed'] },
};

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && (SECTION_IDS as readonly string[]).includes(value);
}

export function inSection(alert: Alert, section: SectionDef): boolean {
  if (section.priority && !section.priority.includes(alert.priority)) return false;
  if (section.status && !section.status.includes(alert.status)) return false;
  return true;
}

export function isActive(alert: Alert): boolean {
  return alert.status !== 'closed';
}

export function isCritical(alert: Alert): boolean {
  return alert.priority === 'P1' && alert.status !== 'closed';
}

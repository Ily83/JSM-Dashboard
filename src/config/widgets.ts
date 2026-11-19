/**
 * Dashboard widget registry (metadata only). The component for each id is in
 * components/dashboard/widgets.tsx. To add a widget: add an entry here and a
 * component there; show/hide, drag, resize, persistence and the settings page
 * pick it up automatically.
 *
 * Sizes are in grid units: the dashboard has 12 columns, and one row unit is
 * a fixed height that depends on the density setting.
 */
export const GRID_COLUMNS = 12;

export interface WidgetDef {
  id: string;
  title: string;
  description: string;
  w: number;
  h: number;
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  defaultVisible: boolean;
}

const kpi = { w: 2, h: 2, minW: 2, maxW: 6, minH: 2, maxH: 3 };
const panel = { w: 4, h: 5, minW: 3, maxW: 12, minH: 3, maxH: 9 };

export const WIDGETS = [
  { id: 'kpiActive', title: 'Total active alerts', description: 'Alerts that are not closed.', ...kpi, defaultVisible: true },
  { id: 'kpiCritical', title: 'Critical alerts', description: 'Active P1 alerts.', ...kpi, defaultVisible: true },
  { id: 'kpiHigh', title: 'High-priority alerts', description: 'Active P2 alerts.', ...kpi, defaultVisible: true },
  { id: 'kpiCustomers', title: 'Affected customers', description: 'Customers with at least one active alert.', ...kpi, defaultVisible: true },
  { id: 'kpiUnassigned', title: 'Unassigned alerts', description: 'Active alerts without an assignee.', ...kpi, defaultVisible: true },
  { id: 'kpiAcked', title: 'Acknowledged alerts', description: 'Active alerts somebody is working on.', ...kpi, defaultVisible: true },
  { id: 'topCustomers', title: 'Alerts by customer', description: 'Customers ranked by number of active alerts.', ...panel, defaultVisible: false },
  { id: 'priorityBreakdown', title: 'Alerts by priority', description: 'Active alerts per priority.', ...panel, h: 4, defaultVisible: false },
  { id: 'topServices', title: 'Alerts by service', description: 'Services ranked by number of active alerts.', ...panel, defaultVisible: false },
  { id: 'topSources', title: 'Alerts by source', description: 'Monitoring sources ranked by number of active alerts.', ...panel, defaultVisible: false },
  { id: 'attention', title: 'Waiting longest', description: 'Oldest open P1 and P2 alerts nobody has acknowledged.', ...panel, w: 6, defaultVisible: false },
] as const satisfies readonly WidgetDef[];

export type WidgetId = (typeof WIDGETS)[number]['id'];

export const WIDGET_BY_ID = Object.fromEntries(WIDGETS.map((w) => [w.id, w])) as Record<WidgetId, WidgetDef>;

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === 'string' && value in WIDGET_BY_ID;
}

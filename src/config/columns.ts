/**
 * Column registry: ids, labels and default sizes. Sorting behaviour and cell
 * rendering for each id are in components/table/columns.tsx.
 * To add a column: add it here, then add its accessor and its cell there.
 */
export const COLUMN_IDS = [
  'priority',
  'summary',
  'customers',
  'status',
  'service',
  'assignee',
  'createdAt',
  'updatedAt',
  'source',
  'tinyId',
  'count',
] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];

export interface ColumnInfo {
  label: string;
  size: number;
  minSize: number;
  hideable: boolean;
  defaultVisible: boolean;
}

export const COLUMN_INFO: Record<ColumnId, ColumnInfo> = {
  priority: { label: 'Priority', size: 88, minSize: 56, hideable: true, defaultVisible: true },
  summary: { label: 'Summary', size: 430, minSize: 160, hideable: false, defaultVisible: true },
  customers: { label: 'Affected customers / tags', size: 300, minSize: 120, hideable: true, defaultVisible: true },
  status: { label: 'Status', size: 112, minSize: 76, hideable: true, defaultVisible: true },
  service: { label: 'Service', size: 160, minSize: 80, hideable: true, defaultVisible: true },
  assignee: { label: 'Assignee / responder', size: 190, minSize: 90, hideable: true, defaultVisible: true },
  createdAt: { label: 'Created', size: 104, minSize: 76, hideable: true, defaultVisible: true },
  updatedAt: { label: 'Updated', size: 104, minSize: 76, hideable: true, defaultVisible: true },
  source: { label: 'Alert source', size: 140, minSize: 80, hideable: true, defaultVisible: true },
  tinyId: { label: 'ID', size: 76, minSize: 56, hideable: true, defaultVisible: false },
  count: { label: 'Count', size: 76, minSize: 56, hideable: true, defaultVisible: false },
};

export function isColumnId(value: unknown): value is ColumnId {
  return typeof value === 'string' && (COLUMN_IDS as readonly string[]).includes(value);
}

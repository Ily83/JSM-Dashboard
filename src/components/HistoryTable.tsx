import type { Alert } from '../../shared/types';
import { PriorityBadge, StatusBadge } from './ui/badges';

const created = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

export function HistoryTable({ alerts }: { alerts: Alert[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-panel text-xs text-muted">
          <tr>
            <th scope="col" className="px-3 py-2">Created (UTC)</th>
            <th scope="col" className="px-3 py-2">Priority</th>
            <th scope="col" className="px-3 py-2">Status</th>
            <th scope="col" className="px-3 py-2">Customers</th>
            <th scope="col" className="px-3 py-2">Tags</th>
            <th scope="col" className="px-3 py-2">Summary</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id} className="border-t border-line">
              <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums">{created.format(alert.createdAt)}</td>
              <td className="px-3 py-2"><PriorityBadge priority={alert.priority} /></td>
              <td className="px-3 py-2"><StatusBadge status={alert.status} /></td>
              <td className="px-3 py-2 text-xs text-muted">{alert.customers.join(', ') || '—'}</td>
              <td className="max-w-60 px-3 py-2 text-xs text-muted">{alert.tags.join(', ') || '—'}</td>
              <td className="w-full min-w-48 px-3 py-2">
                {alert.url ? <a href={alert.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{alert.summary}</a> : alert.summary}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

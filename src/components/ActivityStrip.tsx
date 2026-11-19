import { memo, useMemo } from 'react';
import type { Alert } from '../../shared/types';
import { activityLevel, HOUR_MS, hourlyActivity } from '../lib/activity';

const hour = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/**
 * 24 hourly blocks, oldest left. Darker = more alerts created (or last
 * re-occurring) in that hour. Each block has its own tooltip.
 */
export const ActivityStrip = memo(function ActivityStrip({ alerts, end }: { alerts: readonly Alert[]; end: number }) {
  const activity = useMemo(() => hourlyActivity(alerts, end), [alerts, end]);
  const total = activity.created.reduce((a, b) => a + b, 0);
  const recurredTotal = activity.recurred.reduce((a, b) => a + b, 0);
  const label = `Last 24 h, per hour: ${total} created${recurredTotal ? `, ${recurredTotal} re-occurred` : ''}`;
  return (
    <span className="activity-strip" role="img" aria-label={label}>
      {activity.created.map((created, i) => {
        const recurred = activity.recurred[i]!;
        const from = activity.start + i * HOUR_MS;
        const tip = `${i === 0 || new Date(from).getHours() === 0 ? `${day.format(from)} ` : ''}${hour.format(from)}–${hour.format(from + HOUR_MS)}\n${created} created${recurred ? ` · ${recurred} re-occurred` : ''}`;
        return <span key={i} data-level={activityLevel(created + recurred, activity.max)} data-tip={tip} data-tip-always="" />;
      })}
    </span>
  );
});

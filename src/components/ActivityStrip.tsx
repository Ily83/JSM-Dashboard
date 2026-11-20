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
  const recurredLabel = recurredTotal ? `, ${recurredTotal} re-occurred` : '';
  const label = `Last 24 h, per hour: ${total} created${recurredLabel}`;
  return (
    <span className="activity-strip" role="img" aria-label={label}>
      {activity.created.map((created, i) => {
        const recurred = activity.recurred[i];
        const from = activity.start + i * HOUR_MS;
        // The first block and each midnight also name the day.
        const dayLabel = i === 0 || new Date(from).getHours() === 0 ? `${day.format(from)} ` : '';
        const recurredTip = recurred ? ` · ${recurred} re-occurred` : '';
        const tip = `${dayLabel}${hour.format(from)}–${hour.format(from + HOUR_MS)}\n${created} created${recurredTip}`;
        // Each block is one clock hour: its start time identifies it.
        return <span key={from} data-level={activityLevel(created + recurred, activity.max)} data-tip={tip} data-tip-always="" />;
      })}
    </span>
  );
});

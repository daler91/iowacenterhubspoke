import {
  BookOpen, Clock, Car, CheckCircle2, CalendarDays,
} from 'lucide-react';
import { ProfileStatsGrid } from './profile-stats-grid';

/**
 * The 5-card schedule summary grid used by EmployeeProfile,
 * LocationProfile, and ClassProfile. Previously each profile inlined an
 * identical 30-line stats array — extracting the full grid (not just the
 * layout primitive) is what actually dedupes the code, since the icons,
 * labels, colors, and value formatters are the same across all three.
 *
 * The only things that vary per profile:
 *   - the label and testid on the first card ("Total Classes" vs
 *     "Total Schedules")
 *   - the numeric source field for the "total" value
 *
 * Everything else (Class Time, Drive Time, Completed, Upcoming) is
 * fully identical across profiles and lives here once.
 */

export interface ScheduleStatsData {
  readonly total: number;
  readonly total_class_minutes: number;
  readonly total_drive_minutes: number;
  readonly completed: number;
  readonly upcoming: number;
}

interface ScheduleStatsGridProps {
  readonly data: ScheduleStatsData;
  readonly totalLabel: string;
  readonly totalTestId?: string;
}

function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

export function ScheduleStatsGrid({
  data,
  totalLabel,
  totalTestId,
}: ScheduleStatsGridProps) {
  return (
    <ProfileStatsGrid
      stats={[
        {
          icon: <BookOpen className="w-5 h-5 text-hub" aria-hidden="true" />,
          value: data.total,
          label: totalLabel,
          testId: totalTestId,
        },
        {
          icon: <Clock className="w-5 h-5 text-spoke" aria-hidden="true" />,
          value: formatHours(data.total_class_minutes),
          label: 'Class Time',
        },
        {
          icon: <Car className="w-5 h-5 text-warn" aria-hidden="true" />,
          value: formatHours(data.total_drive_minutes),
          label: 'Drive Time',
        },
        {
          icon: <CheckCircle2 className="w-5 h-5 text-spoke" aria-hidden="true" />,
          value: data.completed,
          label: 'Completed',
        },
        {
          icon: <CalendarDays className="w-5 h-5 text-ownership-partner" aria-hidden="true" />,
          value: data.upcoming,
          label: 'Upcoming',
        },
      ]}
    />
  );
}

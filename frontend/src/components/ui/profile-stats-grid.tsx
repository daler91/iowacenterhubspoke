import type { ReactNode } from 'react';
import { Card } from './card';
import { cn } from '@/lib/utils';

/**
 * Shared stat-card grid used by EmployeeProfile / LocationProfile /
 * ClassProfile. Previously each profile page inlined its own 5-card grid
 * with identical markup — extracting this primitive cuts duplication and
 * keeps the stat typography / spacing consistent across profiles.
 */

interface ProfileStat {
  readonly icon: ReactNode;
  readonly value: ReactNode;
  readonly label: string;
  readonly testId?: string;
}

interface ProfileStatsGridProps {
  readonly stats: ProfileStat[];
  readonly className?: string;
}

export function ProfileStatsGrid({ stats, className }: ProfileStatsGridProps) {
  return (
    <div className={cn('grid grid-cols-2 lg:grid-cols-5 gap-4', className)}>
      {stats.map((stat) => (
        <Card key={stat.label} className="p-4 text-center">
          <div className="w-5 h-5 mx-auto mb-2">{stat.icon}</div>
          <p
            className="text-2xl font-bold text-foreground font-display"
            data-testid={stat.testId}
          >
            {stat.value}
          </p>
          <p className="text-xs text-foreground/80">{stat.label}</p>
        </Card>
      ))}
    </div>
  );
}

export type { ProfileStat, ProfileStatsGridProps };

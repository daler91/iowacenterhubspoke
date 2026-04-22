import { useMemo } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
  CalendarPlus, UserPlus, MapPinPlus, Trash2, CheckCircle2,
  PlayCircle, Clock, Activity
} from 'lucide-react';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';

const ACTION_CONFIG = {
  schedule_created: { icon: CalendarPlus, color: 'text-indigo-600', bg: 'bg-indigo-50', label: 'Scheduled' },
  schedule_deleted: { icon: Trash2, color: 'text-danger', bg: 'bg-danger-soft', label: 'Removed' },
  employee_created: { icon: UserPlus, color: 'text-teal-600', bg: 'bg-teal-50', label: 'New Employee' },
  location_created: { icon: MapPinPlus, color: 'text-spoke', bg: 'bg-spoke-soft', label: 'New Location' },
  status_completed: { icon: CheckCircle2, color: 'text-spoke', bg: 'bg-spoke-soft', label: 'Completed' },
  status_in_progress: { icon: PlayCircle, color: 'text-amber-600', bg: 'bg-amber-50', label: 'In Progress' },
  status_upcoming: { icon: Clock, color: 'text-indigo-500', bg: 'bg-indigo-50', label: 'Reset' },
};

import { useOutletContext } from 'react-router-dom';

interface ActivityFeedProps {
  activities?: unknown[];
}

interface ActivityRow {
  readonly key: string;
  readonly id: string | number;
  readonly action: string;
  readonly description: string;
  readonly user_name: string;
  readonly timeAgo: string;
}

export default function ActivityFeed(props: Readonly<ActivityFeedProps>) {
  const outlet = useOutletContext<Record<string, unknown>>() ?? {};
  const activities = (props.activities ?? outlet.activities) as Array<Record<string, unknown>> | undefined;

  // Group by date + pre-compute `timeAgo` strings once per activities array.
  // The feed rerenders whenever anything above it does (the Insights tab
  // wrapper rerenders on search-param changes), so without memoization we
  // were calling `formatDistanceToNow` once per row on every render.
  const grouped = useMemo<Array<[string, ActivityRow[]]>>(() => {
    if (!activities || activities.length === 0) return [];
    const byDate = new Map<string, ActivityRow[]>();
    activities.forEach((a, idx) => {
      const ts = typeof a.timestamp === 'string' ? a.timestamp : '';
      const dateKey = ts.split('T')[0] || 'Unknown';
      let timeAgo = '';
      if (ts) {
        try {
          timeAgo = formatDistanceToNow(parseISO(ts), { addSuffix: true });
        } catch { timeAgo = ''; }
      }
      // Narrow id to string|number before stringifying so a malformed row
      // with an object id doesn't collapse to "[object Object]" as a React
      // key (and collide with every other malformed sibling).
      const rawId = a.id;
      const safeId: string | number =
        typeof rawId === 'string' || typeof rawId === 'number' ? rawId : idx;
      const row: ActivityRow = {
        key: String(safeId),
        id: safeId,
        action: typeof a.action === 'string' ? a.action : '',
        description: typeof a.description === 'string' ? a.description : '',
        user_name: typeof a.user_name === 'string' ? a.user_name : '',
        timeAgo,
      };
      const bucket = byDate.get(dateKey);
      if (bucket) bucket.push(row);
      else byDate.set(dateKey, [row]);
    });
    return Array.from(byDate.entries());
  }, [activities]);

  if (!activities || activities.length === 0) {
    return (
      <div className="space-y-6 animate-slide-in" data-testid="activity-feed">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-gray-100">Activity Feed</h2>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">Recent actions and updates</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-12 text-center">
          <Activity className="w-12 h-12 mx-auto text-gray-200 dark:text-gray-700 mb-3" />
          <p className="text-muted-foreground text-sm">No activity yet. Start scheduling to see updates here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-in" data-testid="activity-feed">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-gray-100">Activity Feed</h2>
        <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">Recent actions and updates across the team</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 overflow-hidden">
        <ScrollArea className="max-h-[calc(100vh-220px)]">
          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Recent team activity"
            className="divide-y divide-gray-50 dark:divide-gray-800"
          >
            {grouped.map(([date, items]) => (
              <div key={date}>
                <div className="px-5 py-2 bg-gray-50/50 dark:bg-gray-800/50 sticky top-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{date}</p>
                </div>
                {items.map(row => {
                  const config = ACTION_CONFIG[row.action] || {
                    icon: Activity, color: 'text-slate-500', bg: 'bg-gray-50', label: row.action
                  };
                  const Icon = config.icon;

                  return (
                    <div key={row.key} className="px-5 py-4 flex items-start gap-4 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors" data-testid={`activity-item-${row.id}`}>
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${config.bg}`}>
                        <Icon className={`w-4 h-4 ${config.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Badge className={`${config.bg} ${config.color} border-0 text-[10px] px-1.5`}>
                            {config.label}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">{row.timeAgo}</span>
                        </div>
                        <p className="text-sm text-slate-700 dark:text-gray-200">{row.description}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">by {row.user_name}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}


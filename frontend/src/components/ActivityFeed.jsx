import { useState, useEffect } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
  CalendarPlus, UserPlus, MapPinPlus, Trash2, CheckCircle2,
  PlayCircle, Clock, AlertTriangle, Activity
} from 'lucide-react';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';

const ACTION_CONFIG = {
  schedule_created: { icon: CalendarPlus, color: 'text-indigo-600', bg: 'bg-indigo-50', label: 'Scheduled' },
  schedule_deleted: { icon: Trash2, color: 'text-red-500', bg: 'bg-red-50', label: 'Removed' },
  employee_created: { icon: UserPlus, color: 'text-teal-600', bg: 'bg-teal-50', label: 'New Employee' },
  location_created: { icon: MapPinPlus, color: 'text-green-600', bg: 'bg-green-50', label: 'New Location' },
  status_completed: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', label: 'Completed' },
  status_in_progress: { icon: PlayCircle, color: 'text-amber-600', bg: 'bg-amber-50', label: 'In Progress' },
  status_upcoming: { icon: Clock, color: 'text-indigo-500', bg: 'bg-indigo-50', label: 'Reset' },
};

export default function ActivityFeed({ activities }) {
  if (!activities || activities.length === 0) {
    return (
      <div className="space-y-6 animate-slide-in" data-testid="activity-feed">
        <div>
          <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>Activity Feed</h2>
          <p className="text-sm text-slate-500 mt-1">Recent actions and updates</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <Activity className="w-12 h-12 mx-auto text-gray-200 mb-3" />
          <p className="text-slate-400 text-sm">No activity yet. Start scheduling to see updates here.</p>
        </div>
      </div>
    );
  }

  // Group by date
  const grouped = {};
  activities.forEach(a => {
    const dateKey = a.timestamp?.split('T')[0] || 'Unknown';
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(a);
  });

  return (
    <div className="space-y-6 animate-slide-in" data-testid="activity-feed">
      <div>
        <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>Activity Feed</h2>
        <p className="text-sm text-slate-500 mt-1">Recent actions and updates across the team</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <ScrollArea className="max-h-[calc(100vh-220px)]">
          <div className="divide-y divide-gray-50">
            {Object.entries(grouped).map(([date, items]) => (
              <div key={date}>
                <div className="px-5 py-2 bg-gray-50/50 sticky top-0">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{date}</p>
                </div>
                {items.map((activity, idx) => {
                  const config = ACTION_CONFIG[activity.action] || {
                    icon: Activity, color: 'text-slate-500', bg: 'bg-gray-50', label: activity.action
                  };
                  const Icon = config.icon;
                  let timeAgo = '';
                  try {
                    timeAgo = formatDistanceToNow(parseISO(activity.timestamp), { addSuffix: true });
                  } catch { timeAgo = ''; }

                  return (
                    <div key={activity.id || idx} className="px-5 py-4 flex items-start gap-4 hover:bg-gray-50/50 transition-colors" data-testid={`activity-item-${activity.id}`}>
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${config.bg}`}>
                        <Icon className={`w-4 h-4 ${config.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Badge className={`${config.bg} ${config.color} border-0 text-[10px] px-1.5`}>
                            {config.label}
                          </Badge>
                          <span className="text-[11px] text-slate-400">{timeAgo}</span>
                        </div>
                        <p className="text-sm text-slate-700">{activity.description}</p>
                        <p className="text-xs text-slate-400 mt-0.5">by {activity.user_name}</p>
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

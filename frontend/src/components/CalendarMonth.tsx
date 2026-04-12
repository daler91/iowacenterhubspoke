import { useMemo } from 'react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, isSameMonth, isToday
} from 'date-fns';
import { cn } from '../lib/utils';
import { COLORS } from '../lib/constants';

export default function CalendarMonth({ currentDate, schedules, onDateClick }) {
  const calStartTime = useMemo(() => startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 }).getTime(), [currentDate]);
  const calEndTime = useMemo(() => endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 }).getTime(), [currentDate]);

  const weeks = useMemo(() => {
    const rows = [];
    let day = new Date(calStartTime);
    const calEnd = new Date(calEndTime);
    while (day <= calEnd) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        week.push(new Date(day));
        day = addDays(day, 1);
      }
      rows.push(week);
    }
    return rows;
  }, [calStartTime, calEndTime]);

  const schedulesByDate = useMemo(() => {
    const map = {};
    (schedules || []).forEach(s => {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    });
    return map;
  }, [schedules]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden" data-testid="calendar-month">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} className="p-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {weeks.map((week, wi) => (
          <div key={format(week[0], 'yyyy-MM-dd')} className="grid grid-cols-7 divide-x divide-gray-100 dark:divide-gray-800">
            {week.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const daySchedules = schedulesByDate[dateStr] || [];
              const inMonth = isSameMonth(day, currentDate);
              const today = isToday(day);

              return (
                <button
                  type="button"
                  key={dateStr}
                  data-testid={`month-cell-${dateStr}`}
                  onClick={() => onDateClick?.(day)}
                  className={cn(
                    "min-h-[100px] p-2 cursor-pointer transition-colors hover:bg-indigo-50/30 dark:hover:bg-indigo-950/30 appearance-none border-0 bg-transparent text-left",
                    !inMonth && "bg-gray-50/50 dark:bg-gray-800/50"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn(
                      "text-sm font-medium",
                      today && "bg-indigo-600 text-white w-7 h-7 rounded-full flex items-center justify-center",
                      !today && inMonth && "text-slate-700 dark:text-gray-200",
                      !today && !inMonth && "text-muted-foreground"
                    )}>
                      {format(day, 'd')}
                    </span>
                    {daySchedules.length > 0 && (
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {daySchedules.length}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {daySchedules.slice(0, 3).map(s => (
                      <div
                        key={s.id}
                        data-testid={`month-class-pill-${s.id}`}
                        className="text-[10px] px-1.5 py-0.5 rounded-md truncate font-medium"
                        style={{
                          backgroundColor: `${s.class_color || s.employees?.[0]?.color || COLORS.DEFAULT_CLASS}20`,
                          color: s.class_color || s.employees?.[0]?.color || COLORS.DEFAULT_CLASS,
                        }}
                      >
                        {s.class_name || s.location_name}
                      </div>
                    ))}
                    {daySchedules.length > 3 && (
                      <p className="text-[10px] text-muted-foreground font-medium">+{daySchedules.length - 3} more</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}


import { useMemo } from 'react';
import { format, startOfWeek, addDays, parseISO, addMinutes, isSameDay } from 'date-fns';
import { Clock, Car, AlertTriangle, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

const HOURS = Array.from({ length: 14 }, (_, i) => i + 6); // 6 AM to 7 PM

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTop(minutes) {
  const startMinutes = 6 * 60; // 6 AM
  return ((minutes - startMinutes) / 60) * 60; // 60px per hour
}

export default function CalendarWeek({ currentDate, schedules, onDeleteSchedule, onEditSchedule }) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const schedulesByDay = useMemo(() => {
    const map = {};
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      map[dateStr] = (schedules || []).filter(s => s.date === dateStr);
    });
    return map;
  }, [schedules, days]);

  const renderBlock = (schedule, dateStr) => {
    const startMin = timeToMinutes(schedule.start_time);
    const endMin = timeToMinutes(schedule.end_time);
    const driveMin = schedule.drive_time_minutes || 0;

    const classTop = minutesToTop(startMin);
    const classHeight = ((endMin - startMin) / 60) * 60;
    const driveBeforeTop = minutesToTop(startMin - driveMin);
    const driveBeforeHeight = (driveMin / 60) * 60;
    const driveAfterTop = minutesToTop(endMin);
    const driveAfterHeight = (driveMin / 60) * 60;

    const empColor = schedule.employee_color || '#4F46E5';

    return (
      <div key={schedule.id}>
        {/* Drive time BEFORE */}
        {driveMin > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  data-testid={`drive-before-${schedule.id}`}
                  className="schedule-block drive-block"
                  style={{ top: `${driveBeforeTop}px`, height: `${Math.max(driveBeforeHeight, 20)}px` }}
                >
                  <div className="flex items-center gap-1">
                    <Car className="w-3 h-3" />
                    <span className="text-[10px] font-medium">{driveMin}m drive</span>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Drive from Hub to {schedule.location_name}: {driveMin} min</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Class block */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                data-testid={`class-block-${schedule.id}`}
                className="schedule-block class-block cursor-pointer"
                style={{
                  top: `${classTop}px`,
                  height: `${Math.max(classHeight, 30)}px`,
                  backgroundColor: empColor,
                  borderLeftColor: empColor.replace(/E5$/, 'A3'),
                }}
                onClick={() => onEditSchedule?.(schedule)}
              >
                <div className="flex flex-col h-full justify-between">
                  <div>
                    <p className="font-semibold text-[11px] truncate">{schedule.location_name}</p>
                    <p className="text-[10px] opacity-80">{schedule.employee_name}</p>
                  </div>
                  <p className="text-[10px] opacity-70">
                    {schedule.start_time} - {schedule.end_time}
                  </p>
                </div>
                {schedule.town_to_town && (
                  <div className="absolute top-1 right-1">
                    <AlertTriangle className="w-3 h-3 text-amber-300" />
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <div className="space-y-1">
                <p className="font-semibold">{schedule.location_name}</p>
                <p className="text-xs">Employee: {schedule.employee_name}</p>
                <p className="text-xs">Time: {schedule.start_time} - {schedule.end_time}</p>
                <p className="text-xs">Drive: {schedule.drive_time_minutes}m each way</p>
                {schedule.town_to_town_warning && (
                  <p className="text-xs text-amber-600 font-medium">{schedule.town_to_town_warning}</p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Drive time AFTER */}
        {driveMin > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  data-testid={`drive-after-${schedule.id}`}
                  className="schedule-block drive-block"
                  style={{ top: `${driveAfterTop}px`, height: `${Math.max(driveAfterHeight, 20)}px` }}
                >
                  <div className="flex items-center gap-1">
                    <Car className="w-3 h-3" />
                    <span className="text-[10px] font-medium">{driveMin}m return</span>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Return drive from {schedule.location_name} to Hub: {driveMin} min</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Warning block for town-to-town */}
        {schedule.town_to_town && (
          <div
            data-testid={`warning-${schedule.id}`}
            className="schedule-block warning-block"
            style={{ top: `${classTop - 16}px`, height: '14px', zIndex: 25 }}
          >
            <div className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              <span className="text-[9px] font-semibold">Town-to-Town</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" data-testid="calendar-week">
      {/* Header row */}
      <div className="grid grid-cols-8 border-b border-gray-200 bg-gray-50/50">
        <div className="p-3 text-xs font-medium text-slate-400 uppercase tracking-wider border-r border-gray-100">
          Time
        </div>
        {days.map(day => (
          <div key={day.toISOString()} className="p-3 text-center border-r border-gray-100 last:border-r-0">
            <p className="text-xs font-medium text-slate-400 uppercase">{format(day, 'EEE')}</p>
            <p className={cn(
              "text-lg font-bold mt-0.5",
              isSameDay(day, new Date()) ? "text-indigo-600" : "text-slate-800"
            )} style={{ fontFamily: 'Manrope, sans-serif' }}>
              {format(day, 'd')}
            </p>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
        <div className="grid grid-cols-8 relative">
          {/* Time labels column */}
          <div className="border-r border-gray-100">
            {HOURS.map(hour => (
              <div key={hour} className="h-[60px] px-2 flex items-start justify-end pt-1">
                <span className="text-[11px] text-slate-400 font-medium">
                  {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const daySchedules = schedulesByDay[dateStr] || [];
            return (
              <div key={dateStr} className="border-r border-gray-100 last:border-r-0 relative">
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className="h-[60px] border-b border-gray-50 hover:bg-indigo-50/30 transition-colors"
                  />
                ))}
                {/* Schedule blocks */}
                {daySchedules.map(schedule => renderBlock(schedule, dateStr))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

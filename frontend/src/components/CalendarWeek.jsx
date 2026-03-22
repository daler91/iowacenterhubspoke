import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { format, startOfWeek, addDays, isSameDay } from 'date-fns';
import { Car, AlertTriangle, GripVertical } from 'lucide-react';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useAuth } from '../lib/auth';
import { COLORS } from '../lib/constants';

const HOURS = Array.from({ length: 14 }, (_, i) => i + 6); // 6 AM to 7 PM

function formatHourLabel(hour) {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTop(minutes) {
  const startMinutes = 6 * 60; // 6 AM
  return ((minutes - startMinutes) / 60) * 60; // 60px per hour
}

export default function CalendarWeek({ currentDate, schedules, onDeleteSchedule, onEditSchedule, onRelocate }) {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'scheduler';

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

    const classColor = schedule.class_color || schedule.employee_color || COLORS.DEFAULT_CLASS;
    const className = schedule.class_name || 'Unassigned Class';

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
              <button
                type="button"
                data-testid={`class-block-${schedule.id}`}
                draggable={canEdit}
                onDragStart={(e) => {
                  e.dataTransfer.setData('scheduleId', schedule.id);
                  e.dataTransfer.setData('originalDate', dateStr);
                  e.dataTransfer.setData('startTime', schedule.start_time);
                  e.dataTransfer.setData('endTime', schedule.end_time);
                  e.dataTransfer.effectAllowed = 'move';
                  e.currentTarget.style.opacity = '0.4';
                }}
                onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; }}
                className={cn(
                  "schedule-block class-block active:cursor-grabbing group appearance-none border-0 p-0 text-left",
                  canEdit ? "cursor-grab" : "cursor-default"
                )}
                style={{
                  top: `${classTop}px`,
                  height: `${Math.max(classHeight, 30)}px`,
                  backgroundColor: classColor,
                  borderLeft: `4px solid ${classColor}`,
                }}
                onClick={() => canEdit && onEditSchedule?.(schedule)}
              >
                <GripVertical className="w-3 h-3 absolute top-1 right-1 opacity-0 group-hover:opacity-50 text-white" />
                <div className="flex flex-col h-full justify-between">
                  <div>
                    <p className="font-semibold text-[10px] uppercase tracking-wide truncate" data-testid={`calendar-class-name-${schedule.id}`}>{className}</p>
                    <p className="text-[10px] opacity-90 truncate">{schedule.location_name}</p>
                    <p className="text-[10px] opacity-75 truncate">{schedule.employee_name}</p>
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
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <div className="space-y-1">
                <p className="font-semibold">{className}</p>
                <p className="text-xs">Location: {schedule.location_name}</p>
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
                  {formatHourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const daySchedules = schedulesByDay[dateStr] || [];
            return (
              <section
                key={dateStr}
                aria-label={`Schedule drop zone for ${dateStr}`}
                className="border-r border-gray-100 last:border-r-0 relative"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const scheduleId = e.dataTransfer.getData('scheduleId');
                  const startTime = e.dataTransfer.getData('startTime');
                  const endTime = e.dataTransfer.getData('endTime');
                  if (scheduleId && onRelocate && canEdit) {
                    // Calculate drop hour from mouse position
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    const hourOffset = Math.floor(y / 60);
                    const dropHour = 6 + hourOffset;
                    const duration = timeToMinutes(endTime) - timeToMinutes(startTime);
                    const newStartMin = dropHour * 60;
                    const newEndMin = newStartMin + duration;
                    const pad = (n) => String(n).padStart(2, '0');
                    const newStart = `${pad(Math.floor(newStartMin / 60))}:${pad(newStartMin % 60)}`;
                    const newEnd = `${pad(Math.floor(newEndMin / 60))}:${pad(newEndMin % 60)}`;
                    onRelocate(scheduleId, dateStr, newStart, newEnd);
                  }
                }}
              >
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className="h-[60px] border-b border-gray-50 hover:bg-indigo-50/30 transition-colors"
                  />
                ))}
                {/* Schedule blocks */}
                {daySchedules.map(schedule => renderBlock(schedule, dateStr))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

CalendarWeek.propTypes = {
  currentDate: PropTypes.instanceOf(Date).isRequired,
  schedules: PropTypes.array,
  onDeleteSchedule: PropTypes.func,
  onEditSchedule: PropTypes.func,
  onRelocate: PropTypes.func,
};

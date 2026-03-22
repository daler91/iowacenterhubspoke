import PropTypes from 'prop-types';
import { format } from 'date-fns';
import { Car, AlertTriangle, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { COLORS } from '../lib/constants';


const HOURS = Array.from({ length: 14 }, (_, i) => i + 6);

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
  return ((minutes - 6 * 60) / 60) * 80; // 80px per hour for day view
}

export default function CalendarDay({ currentDate, schedules, onEditSchedule, selectionMode, isSelected, toggleItem }) {
  const dateStr = format(currentDate, 'yyyy-MM-dd');
  const daySchedules = (schedules || []).filter(s => s.date === dateStr);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" data-testid="calendar-day">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-gray-50/50">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{format(currentDate, 'EEEE')}</p>
        <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
          {format(currentDate, 'MMMM d, yyyy')}
        </p>
        {daySchedules.length > 0 && (
          <p className="text-sm text-slate-500 mt-1">{daySchedules.length} class{daySchedules.length === 1 ? '' : 'es'} scheduled</p>
        )}
      </div>

      {/* Time grid */}
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
        <div className="grid grid-cols-[80px_1fr] relative">
          {/* Time labels */}
          <div className="border-r border-gray-100">
            {HOURS.map(hour => (
              <div key={hour} className="h-[80px] px-3 flex items-start justify-end pt-1">
                <span className="text-xs text-slate-400 font-medium">
                  {formatHourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Schedule area */}
          <div className="relative">
            {HOURS.map(hour => (
              <div key={hour} className="h-[80px] border-b border-gray-50 hover:bg-indigo-50/20 transition-colors" />
            ))}

            {daySchedules.map(schedule => {
              const startMin = timeToMinutes(schedule.start_time);
              const endMin = timeToMinutes(schedule.end_time);
              const driveMin = schedule.drive_time_minutes || 0;
              const classColor = schedule.class_color || schedule.employee_color || COLORS.DEFAULT_CLASS;
              const className = schedule.class_name || 'Unassigned Class';
              const selected = selectionMode && isSelected?.(schedule.id);

              const classTop = minutesToTop(startMin);
              const classHeight = ((endMin - startMin) / 60) * 80;
              const driveBeforeTop = Math.max(0, minutesToTop(startMin - driveMin));
              const driveBeforeHeight = (driveMin / 60) * 80;
              const driveAfterTop = minutesToTop(endMin);
              const driveAfterHeight = (driveMin / 60) * 80;

              return (
                <div key={schedule.id}>
                  {/* Drive before */}
                  {driveMin > 0 && (
                    <div
                      className="schedule-block drive-block"
                      style={{ top: `${driveBeforeTop}px`, height: `${Math.max(driveBeforeHeight, 24)}px`, right: '16px' }}
                    >
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4" />
                        <span className="text-xs font-medium">Drive from Hub - {driveMin} min</span>
                      </div>
                    </div>
                  )}

                  {/* Class */}
                  <button
                    type="button"
                    className={cn(
                      "schedule-block class-block appearance-none border-0 p-0 text-left",
                      selectionMode ? "cursor-pointer" : "cursor-default",
                      selected && "ring-2 ring-indigo-500 ring-offset-1"
                    )}
                    style={{
                      top: `${classTop}px`,
                      height: `${Math.max(classHeight, 40)}px`,
                      right: '16px',
                      backgroundColor: classColor,
                    }}
                    onClick={() => {
                      if (selectionMode) {
                        toggleItem?.(schedule.id);
                      } else {
                        onEditSchedule?.(schedule);
                      }
                    }}
                    data-testid={`day-class-block-${schedule.id}`}
                  >
                    {/* Selection checkbox overlay */}
                    {selectionMode && (
                      <div className={cn(
                        "absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center z-10",
                        selected ? "bg-white border-white" : "border-white/70 bg-transparent"
                      )}>
                        {selected && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                      </div>
                    )}
                    <div className={cn("flex flex-col h-full justify-between", selectionMode && "pl-7")}>
                      <div>
                        <p className="font-semibold text-xs uppercase tracking-wide">{className}</p>
                        <p className="text-sm">{schedule.location_name}</p>
                        <p className="text-xs opacity-80">{schedule.employee_name}</p>
                      </div>
                      <p className="text-xs opacity-70">{schedule.start_time} - {schedule.end_time}</p>
                    </div>
                    {schedule.town_to_town && !selectionMode && (
                      <div className="absolute top-2 right-2 bg-amber-400 rounded-full p-1">
                        <AlertTriangle className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>

                  {/* Drive after */}
                  {driveMin > 0 && (
                    <div
                      className="schedule-block drive-block"
                      style={{ top: `${driveAfterTop}px`, height: `${Math.max(driveAfterHeight, 24)}px`, right: '16px' }}
                    >
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4" />
                        <span className="text-xs font-medium">Return to Hub - {driveMin} min</span>
                      </div>
                    </div>
                  )}

                  {/* Warning */}
                  {schedule.town_to_town && (
                    <div
                      className="absolute left-2 right-[16px] bg-amber-50 border border-amber-200 rounded-lg p-2 z-30"
                      style={{ top: `${classTop - 28}px` }}
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span className="text-xs font-semibold text-amber-700">Town-to-Town Travel Detected</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

CalendarDay.propTypes = {
  currentDate: PropTypes.instanceOf(Date).isRequired,
  schedules: PropTypes.array,
  onEditSchedule: PropTypes.func,
  selectionMode: PropTypes.bool,
  isSelected: PropTypes.func,
  toggleItem: PropTypes.func,
};

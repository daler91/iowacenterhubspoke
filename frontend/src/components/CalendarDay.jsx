import PropTypes from "prop-types";
import { format } from "date-fns";
import { Car, AlertTriangle } from "lucide-react";
import {
  HOURS,
  formatHourLabel,
  timeToMinutes,
  minutesToTop,
} from "../lib/utils";

export default function CalendarDay({
  currentDate,
  schedules,
  onEditSchedule,
}) {
  const dateStr = format(currentDate, "yyyy-MM-dd");
  const daySchedules = (schedules || []).filter((s) => s.date === dateStr);

  return (
    <div
      className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
      data-testid="calendar-day"
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-gray-50/50">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          {format(currentDate, "EEEE")}
        </p>
        <p
          className="text-2xl font-bold text-slate-800"
          style={{ fontFamily: "Manrope, sans-serif" }}
        >
          {format(currentDate, "MMMM d, yyyy")}
        </p>
        {daySchedules.length > 0 && (
          <p className="text-sm text-slate-500 mt-1">
            {daySchedules.length} class{daySchedules.length === 1 ? "" : "es"}{" "}
            scheduled
          </p>
        )}
      </div>

      {/* Time grid */}
      <div
        className="overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 280px)" }}
      >
        <div className="grid grid-cols-[80px_1fr] relative">
          {/* Time labels */}
          <div className="border-r border-gray-100">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="h-[80px] px-3 flex items-start justify-end pt-1"
              >
                <span className="text-xs text-slate-400 font-medium">
                  {formatHourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Schedule area */}
          <div className="relative">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="h-[80px] border-b border-gray-50 hover:bg-indigo-50/20 transition-colors"
              />
            ))}

            {daySchedules.map((schedule) => {
              const startMin = timeToMinutes(schedule.start_time);
              const endMin = timeToMinutes(schedule.end_time);
              const driveMin = schedule.drive_time_minutes || 0;
              const classColor =
                schedule.class_color || schedule.employee_color || "#0F766E";
              const className = schedule.class_name || "Unassigned Class";

              const classTop = minutesToTop(startMin, 80);
              const classHeight = ((endMin - startMin) / 60) * 80;
              const driveBeforeTop = minutesToTop(startMin - driveMin, 80);
              const driveBeforeHeight = (driveMin / 60) * 80;
              const driveAfterTop = minutesToTop(endMin, 80);
              const driveAfterHeight = (driveMin / 60) * 80;

              return (
                <div key={schedule.id}>
                  {/* Drive before */}
                  {driveMin > 0 && (
                    <div
                      className="schedule-block drive-block"
                      style={{
                        top: `${driveBeforeTop}px`,
                        height: `${Math.max(driveBeforeHeight, 24)}px`,
                        right: "16px",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4" />
                        <span className="text-xs font-medium">
                          Drive from Hub - {driveMin} min
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Class */}
                  <button
                    type="button"
                    className="schedule-block class-block cursor-pointer appearance-none border-0 p-0 text-left"
                    style={{
                      top: `${classTop}px`,
                      height: `${Math.max(classHeight, 40)}px`,
                      right: "16px",
                      backgroundColor: classColor,
                    }}
                    onClick={() => onEditSchedule?.(schedule)}
                    data-testid={`day-class-block-${schedule.id}`}
                  >
                    <div className="flex flex-col h-full justify-between">
                      <div>
                        <p className="font-semibold text-xs uppercase tracking-wide">
                          {className}
                        </p>
                        <p className="text-sm">{schedule.location_name}</p>
                        <p className="text-xs opacity-80">
                          {schedule.employee_name}
                        </p>
                      </div>
                      <p className="text-xs opacity-70">
                        {schedule.start_time} - {schedule.end_time}
                      </p>
                    </div>
                    {schedule.town_to_town && (
                      <div className="absolute top-2 right-2 bg-amber-400 rounded-full p-1">
                        <AlertTriangle className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>

                  {/* Drive after */}
                  {driveMin > 0 && (
                    <div
                      className="schedule-block drive-block"
                      style={{
                        top: `${driveAfterTop}px`,
                        height: `${Math.max(driveAfterHeight, 24)}px`,
                        right: "16px",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4" />
                        <span className="text-xs font-medium">
                          Return to Hub - {driveMin} min
                        </span>
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
                        <span className="text-xs font-semibold text-amber-700">
                          Town-to-Town Travel Detected
                        </span>
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
};

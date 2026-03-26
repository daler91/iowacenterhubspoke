import { useState, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { format, startOfWeek, addDays, isSameDay } from 'date-fns';
import { Car, AlertTriangle, GripVertical, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useAuth } from '../lib/auth';
import { COLORS } from '../lib/constants';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';

const HOURS = Array.from({ length: 14 }, (_, i) => i + 6); // 6 AM to 7 PM
const PX_PER_HOUR = 60;
const SNAP_MINUTES = 30;
const START_HOUR = 6;

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
  return ((minutes - START_HOUR * 60) / 60) * PX_PER_HOUR;
}

function minutesToTimeStr(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Snap pixel offset to nearest SNAP_MINUTES interval and return minutes from 6 AM */
function snapYToMinutes(y) {
  const rawMinutes = (y / PX_PER_HOUR) * 60;
  const snappedMinutes = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, START_HOUR * 60 + snappedMinutes);
}

// ─── Draggable schedule block ─────────────────────────────────────────────
function DraggableBlock({ schedule, dateStr, canEdit, selectionMode, isSelected, toggleItem, onEditSchedule }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: schedule.id,
    data: { schedule, dateStr },
    disabled: !canEdit || selectionMode,
  });

  const startMin = timeToMinutes(schedule.start_time);
  const endMin = timeToMinutes(schedule.end_time);
  const driveMin = schedule.drive_time_minutes || 0;

  const classTop = minutesToTop(startMin);
  const classHeight = ((endMin - startMin) / 60) * PX_PER_HOUR;
  const driveBeforeTop = minutesToTop(startMin - driveMin);
  const driveBeforeHeight = (driveMin / 60) * PX_PER_HOUR;
  const driveAfterTop = minutesToTop(endMin);
  const driveAfterHeight = (driveMin / 60) * PX_PER_HOUR;

  const classColor = schedule.class_color || schedule.employee_color || COLORS.DEFAULT_CLASS;
  const className = schedule.class_name || 'Unassigned Class';
  const selected = selectionMode && isSelected?.(schedule.id);

  return (
    <div style={{ opacity: isDragging ? 0.3 : 1, transition: 'opacity 0.15s' }}>
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

      {/* Class block (draggable) */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={setNodeRef}
              {...(selectionMode ? {} : { ...listeners, ...attributes })}
              type="button"
              data-testid={`class-block-${schedule.id}`}
              className={cn(
                "schedule-block class-block active:cursor-grabbing group appearance-none border-0 p-0 text-left",
                (() => {
                  if (selectionMode) return "cursor-pointer";
                  if (canEdit) return "cursor-grab";
                  return "cursor-default";
                })(),
                selected && "ring-2 ring-indigo-500 ring-offset-1"
              )}
              style={{
                top: `${classTop}px`,
                height: `${Math.max(classHeight, 30)}px`,
                backgroundColor: classColor,
                borderLeft: `4px solid ${classColor}`,
              }}
              onClick={() => {
                if (selectionMode) {
                  toggleItem?.(schedule.id);
                } else if (canEdit) {
                  onEditSchedule?.(schedule);
                }
              }}
            >
              {selectionMode && (
                <div className={cn(
                  "absolute top-1 left-1 w-4 h-4 rounded border-2 flex items-center justify-center z-10",
                  selected ? "bg-white border-white" : "border-white/70 bg-transparent"
                )}>
                  {selected && <Check className="w-3 h-3 text-indigo-600" />}
                </div>
              )}
              {!selectionMode && (
                <GripVertical className="w-3 h-3 absolute top-1 right-1 opacity-0 group-hover:opacity-50 text-white" />
              )}
              <div className={cn("flex flex-col h-full justify-between", selectionMode && "pl-5")}>
                <div>
                  <p className="font-semibold text-[10px] uppercase tracking-wide truncate" data-testid={`calendar-class-name-${schedule.id}`}>{className}</p>
                  <p className="text-[10px] opacity-90 truncate">{schedule.location_name}</p>
                  <p className="text-[10px] opacity-75 truncate">{schedule.employee_name}</p>
                </div>
                <p className="text-[10px] opacity-70">
                  {schedule.start_time} - {schedule.end_time}
                </p>
              </div>
              {schedule.town_to_town && !selectionMode && (
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
              {schedule.town_to_town_drive_minutes && (
                <p className="text-xs text-amber-500">~{schedule.town_to_town_drive_minutes} min drive between towns</p>
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

      {/* Town-to-town warning */}
      {schedule.town_to_town && (
        <div
          data-testid={`warning-${schedule.id}`}
          className="schedule-block warning-block"
          style={{ top: `${classTop - 16}px`, height: '14px', zIndex: 25 }}
        >
          <div className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            <span className="text-[9px] font-semibold">
              {schedule.town_to_town_drive_minutes
                ? `Town-to-Town: ${schedule.town_to_town_drive_minutes}m`
                : 'Town-to-Town'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

DraggableBlock.propTypes = {
  schedule: PropTypes.object.isRequired,
  dateStr: PropTypes.string.isRequired,
  canEdit: PropTypes.bool,
  selectionMode: PropTypes.bool,
  isSelected: PropTypes.func,
  toggleItem: PropTypes.func,
  onEditSchedule: PropTypes.func,
};

// ─── Droppable day column ─────────────────────────────────────────────────
function DroppableDay({ dateStr, children, dropIndicatorMinutes }) {
  const { setNodeRef, isOver } = useDroppable({ id: dateStr });

  return (
    <section
      ref={setNodeRef}
      aria-label={`Schedule drop zone for ${dateStr}`}
      className={cn(
        "border-r border-gray-100 last:border-r-0 relative",
        isOver && "bg-indigo-50/20"
      )}
    >
      {HOURS.map(hour => (
        <div
          key={hour}
          className="h-[60px] border-b border-gray-50 hover:bg-indigo-50/30 transition-colors"
        />
      ))}

      {/* Drop position indicator */}
      {isOver && dropIndicatorMinutes != null && (
        <div
          className="dnd-drop-indicator"
          style={{ top: `${minutesToTop(dropIndicatorMinutes)}px` }}
        >
          <span className="dnd-drop-indicator-label">
            {minutesToTimeStr(dropIndicatorMinutes)}
          </span>
        </div>
      )}

      {children}
    </section>
  );
}

DroppableDay.propTypes = {
  dateStr: PropTypes.string.isRequired,
  children: PropTypes.node,
  dropIndicatorMinutes: PropTypes.number,
};

// ─── Drag overlay ghost card ──────────────────────────────────────────────
function DragOverlayCard({ schedule }) {
  if (!schedule) return null;
  const classColor = schedule.class_color || schedule.employee_color || COLORS.DEFAULT_CLASS;
  const className = schedule.class_name || 'Unassigned Class';
  const duration = timeToMinutes(schedule.end_time) - timeToMinutes(schedule.start_time);

  return (
    <div
      className="dnd-overlay-card"
      style={{
        backgroundColor: classColor,
        borderLeft: `4px solid ${classColor}`,
        height: `${Math.max((duration / 60) * PX_PER_HOUR, 30)}px`,
      }}
    >
      <p className="font-semibold text-[10px] uppercase tracking-wide truncate">{className}</p>
      <p className="text-[10px] opacity-90 truncate">{schedule.location_name}</p>
      <p className="text-[10px] opacity-75 truncate">{schedule.employee_name}</p>
      <p className="text-[10px] opacity-70 mt-auto">
        {schedule.start_time} - {schedule.end_time}
      </p>
    </div>
  );
}

DragOverlayCard.propTypes = {
  schedule: PropTypes.object,
};

// ─── Main component ───────────────────────────────────────────────────────
export default function CalendarWeek({ currentDate, schedules, onDeleteSchedule, onEditSchedule, onRelocate, selectionMode, isSelected, toggleItem }) {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'scheduler';

  const [activeSchedule, setActiveSchedule] = useState(null);
  const [dropIndicator, setDropIndicator] = useState({ dateStr: null, minutes: null });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

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

  // Build a quick lookup for schedule by id
  const schedulesById = useMemo(() => {
    const map = {};
    (schedules || []).forEach(s => { map[s.id] = s; });
    return map;
  }, [schedules]);

  const handleDragStart = useCallback((event) => {
    const schedule = event.active.data.current?.schedule;
    if (schedule) setActiveSchedule(schedule);
  }, []);

  const handleDragOver = useCallback((event) => {
    const { over, active } = event;
    if (!over || !active) {
      setDropIndicator({ dateStr: null, minutes: null });
      return;
    }

    // Calculate drop position from the pointer coordinates
    const overElement = over.rect;
    const pointerY = event.activatorEvent?.clientY;
    // Use delta to compute current pointer position
    const deltaY = event.delta?.y ?? 0;
    const startPointerY = pointerY ?? 0;
    const currentPointerY = startPointerY + deltaY;

    const relativeY = currentPointerY - overElement.top;
    const snappedMinutes = snapYToMinutes(relativeY);

    setDropIndicator({ dateStr: over.id, minutes: snappedMinutes });
  }, []);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    setActiveSchedule(null);
    setDropIndicator({ dateStr: null, minutes: null });

    if (!over || !active || !onRelocate || !canEdit) return;

    const schedule = active.data.current?.schedule;
    if (!schedule) return;

    const targetDateStr = over.id;

    // Calculate the new start time from the last known indicator position or fallback to pointer calc
    const overElement = over.rect;
    const pointerY = event.activatorEvent?.clientY;
    const deltaY = event.delta?.y ?? 0;
    const currentPointerY = (pointerY ?? 0) + deltaY;
    const relativeY = currentPointerY - overElement.top;
    const newStartMinutes = snapYToMinutes(relativeY);

    const duration = timeToMinutes(schedule.end_time) - timeToMinutes(schedule.start_time);
    const newEndMinutes = newStartMinutes + duration;

    const newStart = minutesToTimeStr(newStartMinutes);
    const newEnd = minutesToTimeStr(newEndMinutes);

    // Don't relocate if nothing changed
    if (targetDateStr === schedule.date && newStart === schedule.start_time) return;

    onRelocate(schedule.id, targetDateStr, newStart, newEnd);
  }, [onRelocate, canEdit]);

  const handleDragCancel = useCallback(() => {
    setActiveSchedule(null);
    setDropIndicator({ dateStr: null, minutes: null });
  }, []);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
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

            {/* Day columns (droppable) */}
            {days.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const daySchedules = schedulesByDay[dateStr] || [];
              const indicatorMinutes = dropIndicator.dateStr === dateStr ? dropIndicator.minutes : null;
              return (
                <DroppableDay key={dateStr} dateStr={dateStr} dropIndicatorMinutes={indicatorMinutes}>
                  {daySchedules.map(schedule => (
                    <DraggableBlock
                      key={schedule.id}
                      schedule={schedule}
                      dateStr={dateStr}
                      canEdit={canEdit}
                      selectionMode={selectionMode}
                      isSelected={isSelected}
                      toggleItem={toggleItem}
                      onEditSchedule={onEditSchedule}
                    />
                  ))}
                </DroppableDay>
              );
            })}
          </div>
        </div>
      </div>

      {/* Drag overlay — rendered in a portal, follows cursor */}
      <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
        {activeSchedule && <DragOverlayCard schedule={activeSchedule} />}
      </DragOverlay>
    </DndContext>
  );
}

CalendarWeek.propTypes = {
  currentDate: PropTypes.instanceOf(Date).isRequired,
  schedules: PropTypes.array,
  onDeleteSchedule: PropTypes.func,
  onEditSchedule: PropTypes.func,
  onRelocate: PropTypes.func,
  selectionMode: PropTypes.bool,
  isSelected: PropTypes.func,
  toggleItem: PropTypes.func,
};

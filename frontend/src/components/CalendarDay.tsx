import { useState, useCallback, useMemo, memo } from 'react';
import { format } from 'date-fns';
import { Car, GripVertical, Check, ArrowRightLeft } from 'lucide-react';
import { cn, computeDriveChain } from '../lib/utils';
import { COLORS, CALENDAR } from '../lib/constants';
import { useAuth } from '../lib/auth';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';

const HOURS = Array.from({ length: CALENDAR.DISPLAY_HOURS }, (_, i) => i + CALENDAR.START_HOUR);
const PX_PER_HOUR = CALENDAR.PX_PER_HOUR_DAY;
const SNAP_MINUTES = CALENDAR.SNAP_MINUTES;
const START_HOUR = CALENDAR.START_HOUR;

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

function snapYToMinutes(y) {
  const rawMinutes = (y / PX_PER_HOUR) * 60;
  const snappedMinutes = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, START_HOUR * 60 + snappedMinutes);
}

// ─── Overlap layout algorithm ─────────────────────────────────────────────
function assignColumns(sorted) {
  const columns = [];
  const assignment = {};
  for (const s of sorted) {
    const startMin = timeToMinutes(s.start_time);
    const col = columns.findIndex(c => (c.at(-1)?.endMin ?? Infinity) <= startMin);
    if (col >= 0) {
      columns[col].push({ id: s.id, endMin: timeToMinutes(s.end_time) });
      assignment[s.id] = col;
    } else {
      columns.push([{ id: s.id, endMin: timeToMinutes(s.end_time) }]);
      assignment[s.id] = columns.length - 1;
    }
  }
  return { columns, assignment };
}

function countOverlapping(columns, sStart, sEnd, sorted) {
  let count = 0;
  for (const col of columns) {
    const hasOverlap = col.some(item => {
      const iS = sorted.find(x => x.id === item.id);
      return iS && timeToMinutes(iS.start_time) < sEnd && item.endMin > sStart;
    });
    if (hasOverlap) count++;
  }
  return count;
}

function computeOverlapLayout(schedules) {
  if (schedules.length <= 1) {
    const result = {};
    for (const s of schedules) result[s.id] = { column: 0, totalColumns: 1 };
    return result;
  }
  const sorted = [...schedules].sort((a, b) => {
    const diff = timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
    return diff === 0 ? timeToMinutes(b.end_time) - timeToMinutes(a.end_time) : diff;
  });
  const { columns, assignment } = assignColumns(sorted);
  const result = {};
  for (const s of sorted) {
    const sStart = timeToMinutes(s.start_time);
    const sEnd = timeToMinutes(s.end_time);
    const maxOverlap = countOverlapping(columns, sStart, sEnd, sorted);
    result[s.id] = { column: assignment[s.id], totalColumns: Math.max(maxOverlap, 1) };
  }
  return result;
}

// ─── Draggable schedule block ─────────────────────────────────────────────
const DraggableDayBlock = memo(function DraggableDayBlock({ schedule, canEdit, selectionMode, isSelected, toggleItem, onEditSchedule, chainInfo, overlapInfo }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: schedule.id,
    data: { schedule },
    disabled: !canEdit || selectionMode,
  });

  const startMin = timeToMinutes(schedule.start_time);
  const endMin = timeToMinutes(schedule.end_time);
  const classColor = schedule.class_color || schedule.employees?.[0]?.color || COLORS.DEFAULT_CLASS;
  const className = schedule.class_name || 'Unassigned Class';
  const employeeDisplay = schedule.employees?.map(e => e.name).join(', ') || 'Unassigned';
  const selected = selectionMode && isSelected?.(schedule.id);

  // Use chain info for contextual drive blocks
  const ci = chainInfo || {};
  const driveBeforeMin = ci.driveBeforeMin ?? (schedule.drive_time_minutes || 0);
  const driveAfterMin = ci.driveAfterMin ?? (schedule.drive_time_minutes || 0);
  const isTTAfter = ci.driveAfterStyle === 'town-to-town';

  const classTop = minutesToTop(startMin);
  const classHeight = ((endMin - startMin) / 60) * PX_PER_HOUR;
  const driveBeforeTop = Math.max(0, minutesToTop(startMin - driveBeforeMin));
  const driveBeforeHeight = (driveBeforeMin / 60) * PX_PER_HOUR;
  const driveAfterTop = minutesToTop(endMin);
  const driveAfterHeight = (driveAfterMin / 60) * PX_PER_HOUR;

  // Overlap layout
  const ol = overlapInfo || { column: 0, totalColumns: 1 };
  const hasOverlap = ol.totalColumns > 1;
  const colWidthPct = 100 / ol.totalColumns;
  const leftPct = ol.column * colWidthPct;
  const overlapStyle = hasOverlap
    ? { left: `${leftPct}%`, width: `${colWidthPct - 1}%`, right: 'auto' }
    : {};

  return (
    <div style={{ opacity: isDragging ? 0.3 : 1, transition: 'opacity 0.15s' }}>
      {/* Drive before (hub drive for first class, nothing for others in chain) */}
      {driveBeforeMin > 0 && (
        <div
          className="schedule-block drive-block"
          style={{ top: `${driveBeforeTop}px`, height: `${Math.max(driveBeforeHeight, 24)}px`, right: hasOverlap ? 'auto' : '16px', ...overlapStyle }}
        >
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4" />
            <span className="text-xs font-medium">
              {ci.driveBeforeLabel || `Drive from Hub - ${driveBeforeMin} min`}
            </span>
          </div>
        </div>
      )}

      {/* Class block (draggable) */}
      <button
        ref={setNodeRef}
        {...(selectionMode ? {} : { ...listeners, ...attributes })}
        type="button"
        className={cn(
          "schedule-block class-block appearance-none border-0 p-0 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1",
          (() => {
            if (selectionMode) return "cursor-pointer";
            if (canEdit) return "cursor-grab";
            return "cursor-default";
          })(),
          selected && "ring-2 ring-indigo-500 ring-offset-1"
        )}
        style={{
          top: `${classTop}px`,
          height: `${Math.max(classHeight, 40)}px`,
          right: hasOverlap ? 'auto' : '16px',
          backgroundColor: classColor,
          ...overlapStyle,
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
        {selectionMode && (
          <div className={cn(
            "absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center z-10",
            selected ? "bg-white border-white" : "border-white/70 bg-transparent"
          )}>
            {selected && <Check className="w-3.5 h-3.5 text-indigo-600" />}
          </div>
        )}
        {!selectionMode && canEdit && (
          <GripVertical className="w-4 h-4 absolute top-2 right-2 opacity-0 group-hover:opacity-50 text-white" />
        )}
        <div className={cn("flex flex-col h-full justify-between group", selectionMode && "pl-7")}>
          <div>
            <p className="font-semibold text-xs uppercase tracking-wide">{className}</p>
            <p className="text-sm">{schedule.location_name}</p>
            <p className="text-xs opacity-80">{employeeDisplay}</p>
          </div>
          <p className="text-xs opacity-70">{schedule.start_time} - {schedule.end_time}</p>
        </div>
        {schedule.town_to_town && !selectionMode && (
          <div className="absolute top-2 right-2 bg-teal-500 rounded-full p-1">
            <ArrowRightLeft className="w-3 h-3 text-white" />
          </div>
        )}
      </button>

      {/* Drive after (hub return for last, city-to-city for others in chain) */}
      {driveAfterMin > 0 && (
        <div
          className={cn("schedule-block drive-block", isTTAfter && "!bg-teal-100 !text-teal-700 !border-teal-200")}
          style={{ top: `${driveAfterTop}px`, height: `${Math.max(driveAfterHeight, 24)}px`, right: hasOverlap ? 'auto' : '16px', ...overlapStyle }}
        >
          <div className="flex items-center gap-2">
            {isTTAfter ? <ArrowRightLeft className="w-4 h-4" /> : <Car className="w-4 h-4" />}
            <span className="text-xs font-medium">
              {ci.driveAfterLabel || `Return to Hub - ${driveAfterMin} min`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});


// ─── Droppable area ───────────────────────────────────────────────────────
function DroppableDayArea({ dateStr, children, dropIndicatorMinutes }) {
  const { setNodeRef, isOver } = useDroppable({ id: dateStr });

  return (
    <div ref={setNodeRef} className="relative">
      {HOURS.map(hour => (
        <div key={hour} className={cn("h-[80px] border-b border-gray-50 transition-colors", isOver && "bg-indigo-50/20")} />
      ))}

      {/* Drop indicator */}
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
    </div>
  );
}


// ─── Drag overlay ghost card ──────────────────────────────────────────────
function DayDragOverlayCard({ schedule }) {
  if (!schedule) return null;
  const classColor = schedule.class_color || schedule.employees?.[0]?.color || COLORS.DEFAULT_CLASS;
  const className = schedule.class_name || 'Unassigned Class';
  const employeeDisplay = schedule.employees?.map(e => e.name).join(', ') || 'Unassigned';
  const duration = timeToMinutes(schedule.end_time) - timeToMinutes(schedule.start_time);

  return (
    <div
      className="dnd-overlay-card"
      style={{
        backgroundColor: classColor,
        borderLeft: `4px solid ${classColor}`,
        height: `${Math.max((duration / 60) * PX_PER_HOUR, 40)}px`,
        width: '280px',
      }}
    >
      <p className="font-semibold text-xs uppercase tracking-wide truncate">{className}</p>
      <p className="text-sm truncate">{schedule.location_name}</p>
      <p className="text-xs opacity-80 truncate">{employeeDisplay}</p>
      <p className="text-xs opacity-70 mt-auto">{schedule.start_time} - {schedule.end_time}</p>
    </div>
  );
}


// ─── Main component ───────────────────────────────────────────────────────
export default function CalendarDay({ currentDate, schedules, onEditSchedule, onRelocate, selectionMode, isSelected, toggleItem }) {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'scheduler';
  const dateStr = format(currentDate, 'yyyy-MM-dd');
  const daySchedules = useMemo(
    () => (schedules || []).filter(s => s.date === dateStr),
    [schedules, dateStr]
  );
  const driveChain = useMemo(() => computeDriveChain(daySchedules), [daySchedules]);
  const overlapLayout = useMemo(() => computeOverlapLayout(daySchedules), [daySchedules]);

  const [activeSchedule, setActiveSchedule] = useState(null);
  const [dropIndicatorMinutes, setDropIndicatorMinutes] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = useCallback((event) => {
    const schedule = event.active.data.current?.schedule;
    if (schedule) setActiveSchedule(schedule);
  }, []);

  const handleDragOver = useCallback((event) => {
    const { over } = event;
    if (!over) { setDropIndicatorMinutes(null); return; }

    const overElement = over.rect;
    const pointerY = event.activatorEvent?.clientY ?? 0;
    const deltaY = event.delta?.y ?? 0;
    const relativeY = (pointerY + deltaY) - overElement.top;
    setDropIndicatorMinutes(snapYToMinutes(relativeY));
  }, []);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    setActiveSchedule(null);
    setDropIndicatorMinutes(null);

    if (!over || !active || !onRelocate || !canEdit) return;

    const schedule = active.data.current?.schedule;
    if (!schedule) return;

    const overElement = over.rect;
    const pointerY = event.activatorEvent?.clientY ?? 0;
    const deltaY = event.delta?.y ?? 0;
    const relativeY = (pointerY + deltaY) - overElement.top;
    const newStartMinutes = snapYToMinutes(relativeY);
    const duration = timeToMinutes(schedule.end_time) - timeToMinutes(schedule.start_time);
    const newEndMinutes = newStartMinutes + duration;

    const newStart = minutesToTimeStr(newStartMinutes);
    const newEnd = minutesToTimeStr(newEndMinutes);

    if (newStart === schedule.start_time) return;

    onRelocate(schedule.id, dateStr, newStart, newEnd);
  }, [onRelocate, canEdit, dateStr]);

  const handleDragCancel = useCallback(() => {
    setActiveSchedule(null);
    setDropIndicatorMinutes(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden" data-testid="calendar-day">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 bg-gray-50/50">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{format(currentDate, 'EEEE')}</p>
          <p className="text-2xl font-bold text-slate-800 font-display">
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
                  <span className="text-xs text-muted-foreground font-medium">
                    {formatHourLabel(hour)}
                  </span>
                </div>
              ))}
            </div>

            {/* Schedule area (droppable) */}
            <DroppableDayArea dateStr={dateStr} dropIndicatorMinutes={dropIndicatorMinutes}>
              {daySchedules.map(schedule => (
                <DraggableDayBlock
                  key={schedule.id}
                  schedule={schedule}
                  canEdit={canEdit}
                  selectionMode={selectionMode}
                  isSelected={isSelected}
                  toggleItem={toggleItem}
                  onEditSchedule={onEditSchedule}
                  chainInfo={driveChain[schedule.id]}
                  overlapInfo={overlapLayout[schedule.id]}
                />
              ))}
            </DroppableDayArea>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
        {activeSchedule && <DayDragOverlayCard schedule={activeSchedule} />}
      </DragOverlay>
    </DndContext>
  );
}


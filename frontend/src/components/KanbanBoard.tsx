import { useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Clock, MapPin, Car, User, GripVertical, ChevronRight, AlertTriangle, ListChecks, Check, Handshake, CalendarDays } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { PageShell } from './ui/page-shell';
import { toast } from 'sonner';
import { schedulesAPI } from '../lib/api';
import { cn } from '../lib/utils';
import { EntityLink } from './ui/entity-link';
import { mutate } from 'swr';
import { SCHEDULE_STATUS, COLORS } from '../lib/constants';
import BulkActionBar from './BulkActionBar';
import useSelectionMode from '../hooks/useSelectionMode';
import {
  DndContext, closestCenter, type DragEndEvent,
  PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core';

const COLUMNS = [
  { id: SCHEDULE_STATUS.UPCOMING, label: 'Upcoming', color: COLORS.STATUS.UPCOMING, lightColor: COLORS.STATUS_LIGHT.UPCOMING, textColor: COLORS.STATUS_TEXT.UPCOMING },
  { id: SCHEDULE_STATUS.IN_PROGRESS, label: 'In Progress', color: COLORS.STATUS.IN_PROGRESS, lightColor: COLORS.STATUS_LIGHT.IN_PROGRESS, textColor: COLORS.STATUS_TEXT.IN_PROGRESS },
  { id: SCHEDULE_STATUS.COMPLETED, label: 'Completed', color: COLORS.STATUS.COMPLETED, lightColor: COLORS.STATUS_LIGHT.COMPLETED, textColor: COLORS.STATUS_TEXT.COMPLETED },
];

const DND_INSTRUCTIONS_ID = 'kanban-board-dnd-instructions';

function KanbanCard({ schedule, onStatusChange, onEdit, selectionMode, isSelected, toggleItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: schedule.id,
    data: { schedule },
    disabled: selectionMode,
  });
  const transformStyle = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;
  const classColor = schedule.class_color || COLORS.DEFAULT_CLASS;
  const className = schedule.class_name || 'Unassigned Class';
  const selected = selectionMode && isSelected?.(schedule.id);

  // In drag mode, capture dnd-kit's own onKeyDown BEFORE the spread so we
  // can chain it — otherwise our custom onKeyDown (spread last) silently
  // overrides the KeyboardSensor activator and drag pickup stops working.
  // Enter still auto-fires the native <button> onClick (→ onEdit), so we
  // only need custom handling for selection mode's Space/Enter toggle
  // and for delegating Space/arrows to dnd-kit in drag mode.
  const dndKeyDown = selectionMode ? undefined : listeners?.onKeyDown;

  const handleKeyDown = (e) => {
    if (selectionMode) {
      // Selection mode: Space toggles. Enter already fires native click
      // on the <button>, which calls toggleItem — no extra handling.
      if (e.key === ' ') {
        e.preventDefault();
        toggleItem?.(schedule.id);
      }
      return;
    }
    // Drag mode: delegate everything to dnd-kit's KeyboardSensor (Space
    // for pickup, arrows for move, Escape for cancel). Enter falls
    // through to native button click → onEdit.
    if (e.key !== 'Enter') {
      dndKeyDown?.(e);
    }
  };

  // The card root is a native <button type="button">, positioned inside a
  // relative wrapper so the "Move" action can sit next to it as a sibling
  // rather than a nested <button> (which would be invalid HTML). The old
  // inline "Edit details" link was removed — it was redundant with the
  // card's own onClick that already fires onEdit. Mouse and keyboard users
  // get the same behaviour: click or Enter on the card to open details,
  // Space to start a drag, click the floating Move button to advance the
  // schedule status without opening the dialog.
  const canAdvance =
    !selectionMode && (schedule.status || 'upcoming') !== 'completed';

  return (
    <div className="relative mb-2">
      <button
        ref={setNodeRef}
        type="button"
        {...(selectionMode ? {} : { ...listeners, ...attributes })}
        data-testid={`kanban-card-${schedule.id}`}
        aria-describedby={selectionMode ? undefined : DND_INSTRUCTIONS_ID}
        onClick={() => {
          if (selectionMode) {
            toggleItem?.(schedule.id);
          } else {
            onEdit?.(schedule);
          }
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 border-l-4 p-4 hover:shadow-md transition-all group text-left w-full touch-none block",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1",
          selectionMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
          isDragging && "opacity-50 scale-95",
          selected && "ring-2 ring-indigo-500 ring-offset-1"
        )}
        style={{ borderLeftColor: classColor, ...transformStyle }}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {selectionMode ? (
              <div className={cn(
                "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0",
                selected ? "bg-indigo-600 border-indigo-600" : "border-gray-300 bg-transparent"
              )}>
                {selected && <Check className="w-3 h-3 text-white" />}
              </div>
            ) : (
              <GripVertical className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white truncate max-w-[180px]"
              style={{ backgroundColor: classColor }}
              data-testid={`kanban-class-name-${schedule.id}`}
            >
              {className}
            </span>
          </div>
          {schedule.town_to_town && (
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          )}
        </div>

        <div className="pl-[26px] space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-gray-300">
            <MapPin className="w-3 h-3" />
            <EntityLink type="location" id={schedule.location_id}>{schedule.location_name}</EntityLink>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
            <User className="w-3 h-3" />
            {schedule.employees?.length > 0 ? (
              schedule.employees.map((emp, i) => (
                <span key={emp.id}>
                  <EntityLink type="employee" id={emp.id}>{emp.name}</EntityLink>
                  {i < schedule.employees.length - 1 && ', '}
                </span>
              ))
            ) : (
              <span>Unassigned</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
            <Clock className="w-3 h-3" />
            <span>{schedule.date} | {schedule.start_time} - {schedule.end_time}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Car className="w-3 h-3" />
            <span>{schedule.drive_time_minutes}m drive each way</span>
          </div>
          {schedule.linked_project && (
            <div className="flex items-center gap-1.5 text-xs text-indigo-600">
              <Handshake className="w-3 h-3" />
              <span className="truncate font-medium">{schedule.linked_project.title}</span>
              <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-auto shrink-0">
                {schedule.linked_project.phase?.replace('_', ' ')}
              </Badge>
            </div>
          )}
          {schedule.notes && (
            <p className="text-[11px] text-muted-foreground italic truncate">{schedule.notes}</p>
          )}
        </div>
      </button>

      {canAdvance && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onStatusChange(schedule.id, (schedule.status || 'upcoming') === 'upcoming' ? 'in_progress' : 'completed')}
          className="absolute bottom-2 right-2 h-6 text-[10px] px-2 text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm"
          data-testid={`kanban-advance-${schedule.id}`}
        >
          <ChevronRight className="w-3 h-3 mr-0.5" />
          Move
        </Button>
      )}
    </div>
  );
}

function DroppableColumn({ id, children }: Readonly<{ id: string; children: React.ReactNode }>) {
  const { setNodeRef, isOver } = useDroppable({ id });
  // Indigo accent on hover — visually distinct from the teal-accented
  // Project Board so the two kanbans don't blur together.
  return (
    <div ref={setNodeRef} className={cn('transition-colors rounded-lg', isOver && 'bg-hub-soft ring-2 ring-hub/20')}>
      {children}
    </div>
  );
}

export default function KanbanBoard() {
  const navigate = useNavigate();
  const { schedules, employees, locations, classes, onEditSchedule, fetchSchedules, fetchActivities, fetchWorkload, fetchErrors } = useOutletContext();

  const {
    selectionMode,
    selectedIds,
    selectedCount,
    toggleSelectionMode,
    toggleItem,
    selectAll,
    deselectAll,
    isSelected,
    clearSelection,
  } = useSelectionMode();

  const onRefresh = () => {
    fetchSchedules();
    fetchActivities();
    fetchWorkload();
  };
  const handleStatusChange = async (scheduleId, newStatus) => {
    // Optimistic UI cache swap for instantaneous feedback
    mutate('schedules', (currentData) => {
      if (!currentData) return currentData;
      return currentData.map(s => s.id === scheduleId ? { ...s, status: newStatus } : s);
    }, { revalidate: false });

    try {
      const res = await schedulesAPI.updateStatus(scheduleId, newStatus);
      const updated = res.data;
      toast.success(`Status updated to ${newStatus.replace('_', ' ')}`);
      onRefresh();

      // Post-completion prompt: navigate to project for outcome entry
      if (newStatus === SCHEDULE_STATUS.COMPLETED && updated?.linked_project) {
        toast('Enter attendance for this event?', {
          description: updated.linked_project.title,
          action: {
            label: 'Enter Outcomes',
            onClick: () => navigate(`/coordination/projects/${updated.linked_project.id}`),
          },
          duration: 8000,
        });
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to update status');
      // Rollback cache
      mutate('schedules');
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !active.data.current?.schedule) return;
    const schedule = active.data.current.schedule;
    const targetStatus = over.id as string;
    const currentStatus = schedule.status || SCHEDULE_STATUS.UPCOMING;
    if (currentStatus === targetStatus) return;
    await handleStatusChange(schedule.id, targetStatus);
  }, [handleStatusChange]);

  const getColumnSchedules = (status) =>
    (schedules || []).filter(s => (s.status || SCHEDULE_STATUS.UPCOMING) === status)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

  const handleBulkComplete = () => {
    clearSelection();
    onRefresh();
  };

  const handleColumnSelectAll = (columnItems) => {
    const columnIds = columnItems.map(s => s.id);
    const allSelected = columnIds.every(id => selectedIds.has(id));
    if (allSelected) {
      // Deselect all in this column
      const newIds = new Set(selectedIds);
      columnIds.forEach(id => newIds.delete(id));
      selectAll(Array.from(newIds));
    } else {
      // Add all column items to selection
      const newIds = new Set(selectedIds);
      columnIds.forEach(id => newIds.add(id));
      selectAll(Array.from(newIds));
    }
  };

  return (
    <PageShell
      testId="kanban-board"
      breadcrumbs={[{ label: 'Planning' }, { label: 'Delivery Pipeline' }]}
      title="Delivery Pipeline"
      subtitle="Track class delivery status — drag cards through upcoming, in progress, and completed"
      actions={
        <Button
          variant={selectionMode ? 'default' : 'outline'}
          size="sm"
          data-testid="kanban-select-mode"
          onClick={toggleSelectionMode}
          className={selectionMode ? '' : 'border-gray-200 dark:border-gray-700'}
        >
          <ListChecks className="w-4 h-4 mr-1" aria-hidden="true" />
          Bulk Select
        </Button>
      }
    >
      {fetchErrors?.schedules && (
        <div className="bg-danger-soft border border-danger/30 rounded-lg p-3 flex items-center justify-between" data-testid="schedule-fetch-error" role="alert">
          <p className="text-sm text-danger">Failed to load schedules: {fetchErrors.schedules}. Data may be outdated.</p>
          <button type="button" onClick={() => onRefresh()} className="text-sm font-medium text-danger hover:underline underline-offset-2">Retry</button>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <p id={DND_INSTRUCTIONS_ID} className="sr-only">
          Press Space to pick up, arrow keys to move, Enter to drop, Escape to cancel.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {COLUMNS.map(col => {
          const items = getColumnSchedules(col.id);
          const allSelected = selectionMode && items.length > 0 && items.every(s => selectedIds.has(s.id));
          return (
            <DroppableColumn key={col.id} id={col.id}>
              <section
                aria-label={`${col.label} column`}
                data-testid={`kanban-column-${col.id}`}
                className="bg-gray-50/80 dark:bg-gray-800/80 rounded-lg border border-gray-200 dark:border-gray-700 min-h-[400px]"
              >
                {/* Column header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {selectionMode && items.length > 0 && (
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={() => handleColumnSelectAll(items)}
                        className="mr-1"
                        data-testid={`kanban-select-all-${col.id}`}
                      />
                    )}
                    <div className={cn("w-2.5 h-2.5 rounded-full", col.color)} />
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-gray-200">{col.label}</h3>
                  </div>
                  <Badge className={cn("border-0 text-[10px] px-2", col.lightColor, col.textColor)}>
                    {items.length}
                  </Badge>
                </div>

                {/* Cards */}
                <div className="p-3 space-y-3">
                  {items.map(schedule => (
                    <KanbanCard
                      key={schedule.id}
                      schedule={schedule}
                      onStatusChange={handleStatusChange}
                      onEdit={onEditSchedule}
                      selectionMode={selectionMode}
                      isSelected={isSelected}
                      toggleItem={toggleItem}
                    />
                  ))}
                  {items.length === 0 && (
                    <div className="text-center py-8">
                      <CalendarDays className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {col.id === SCHEDULE_STATUS.UPCOMING ? 'No upcoming classes. Schedule one from the Calendar.' : `No ${col.label.toLowerCase()} classes`}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </DroppableColumn>
          );
        })}
        </div>
      </DndContext>

      {selectedCount > 0 && (
        <BulkActionBar
          selectedCount={selectedCount}
          selectedIds={selectedIds}
          onComplete={handleBulkComplete}
          onDeselectAll={deselectAll}
          employees={employees}
          locations={locations}
          classes={classes}
        />
      )}
    </PageShell>
  );
}


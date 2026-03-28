import { useState } from 'react';
import PropTypes from 'prop-types';
import { Clock, MapPin, Car, User, GripVertical, ChevronRight, AlertTriangle, ListChecks, Check } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { toast } from 'sonner';
import { schedulesAPI } from '../lib/api';
import { cn } from '../lib/utils';
import { EntityLink } from './ui/entity-link';
import { mutate } from 'swr';
import { SCHEDULE_STATUS, COLORS } from '../lib/constants';
import BulkActionBar from './BulkActionBar';
import useSelectionMode from '../hooks/useSelectionMode';

const COLUMNS = [
  { id: SCHEDULE_STATUS.UPCOMING, label: 'Upcoming', color: COLORS.STATUS.UPCOMING, lightColor: COLORS.STATUS_LIGHT.UPCOMING, textColor: COLORS.STATUS_TEXT.UPCOMING },
  { id: SCHEDULE_STATUS.IN_PROGRESS, label: 'In Progress', color: COLORS.STATUS.IN_PROGRESS, lightColor: COLORS.STATUS_LIGHT.IN_PROGRESS, textColor: COLORS.STATUS_TEXT.IN_PROGRESS },
  { id: SCHEDULE_STATUS.COMPLETED, label: 'Completed', color: COLORS.STATUS.COMPLETED, lightColor: COLORS.STATUS_LIGHT.COMPLETED, textColor: COLORS.STATUS_TEXT.COMPLETED },
];

function KanbanCard({ schedule, onStatusChange, onEdit, selectionMode, isSelected, toggleItem }) {
  const [dragging, setDragging] = useState(false);
  const classColor = schedule.class_color || COLORS.DEFAULT_CLASS;
  const className = schedule.class_name || 'Unassigned Class';
  const selected = selectionMode && isSelected?.(schedule.id);

  return (
    <button
      type="button"
      data-testid={`kanban-card-${schedule.id}`}
      draggable={!selectionMode}
      onDragStart={(e) => {
        if (selectionMode) { e.preventDefault(); return; }
        e.dataTransfer.setData('scheduleId', schedule.id);
        e.dataTransfer.setData('currentStatus', schedule.status || SCHEDULE_STATUS.UPCOMING);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={() => {
        if (selectionMode) {
          toggleItem?.(schedule.id);
        } else {
          onEdit?.(schedule);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (selectionMode) {
            toggleItem?.(schedule.id);
          } else {
            onEdit?.(schedule);
          }
        }
      }}
      className={cn(
        "bg-white rounded-lg border border-gray-100 border-l-4 p-4 hover:shadow-md transition-all group text-left w-full",
        selectionMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50 scale-95",
        selected && "ring-2 ring-indigo-500 ring-offset-1"
      )}
      style={{ borderLeftColor: classColor }}
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
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <MapPin className="w-3 h-3" />
          <EntityLink type="location" id={schedule.location_id}>{schedule.location_name}</EntityLink>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <User className="w-3 h-3" />
          <EntityLink type="employee" id={schedule.employee_id}>{schedule.employee_name}</EntityLink>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Clock className="w-3 h-3" />
          <span>{schedule.date} | {schedule.start_time} - {schedule.end_time}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Car className="w-3 h-3" />
          <span>{schedule.drive_time_minutes}m drive each way</span>
        </div>
        {schedule.notes && (
          <p className="text-[11px] text-slate-400 italic truncate">{schedule.notes}</p>
        )}
      </div>

      {!selectionMode && (
        <div className="flex items-center justify-between mt-3 pl-[26px]">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit?.(schedule); }}
            className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium"
            data-testid={`kanban-edit-${schedule.id}`}
          >
            Edit details
          </button>
          <div className="flex gap-1">
            {(schedule.status || 'upcoming') !== 'completed' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onStatusChange(schedule.id, (schedule.status || 'upcoming') === 'upcoming' ? 'in_progress' : 'completed'); }}
                className="h-6 text-[10px] px-2 text-slate-500 hover:text-slate-700"
                data-testid={`kanban-advance-${schedule.id}`}
              >
                <ChevronRight className="w-3 h-3 mr-0.5" />
                Move
              </Button>
            )}
          </div>
        </div>
      )}
    </button>
  );
}

KanbanCard.propTypes = {
  schedule: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    class_color: PropTypes.string,
    class_name: PropTypes.string,
    status: PropTypes.string,
    town_to_town: PropTypes.bool,
    location_name: PropTypes.string,
    employee_name: PropTypes.string,
    date: PropTypes.string,
    start_time: PropTypes.string,
    end_time: PropTypes.string,
    drive_time_minutes: PropTypes.number,
    notes: PropTypes.string,
  }).isRequired,
  onStatusChange: PropTypes.func.isRequired,
  onEdit: PropTypes.func,
  selectionMode: PropTypes.bool,
  isSelected: PropTypes.func,
  toggleItem: PropTypes.func,
};

import { useOutletContext } from 'react-router-dom';

export default function KanbanBoard() {
  const { schedules, employees, locations, classes, onEditSchedule, fetchSchedules, fetchActivities, fetchWorkload } = useOutletContext();

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
      await schedulesAPI.updateStatus(scheduleId, newStatus);
      toast.success(`Status updated to ${newStatus.replace('_', ' ')}`);
      onRefresh();
    } catch (err) {
      console.error(err);
      toast.error('Failed to update status');
      // Rollback cache
      mutate('schedules');
    }
  };

  const handleDrop = async (e, targetStatus) => {
    if (selectionMode) return;
    e.preventDefault();
    const scheduleId = e.dataTransfer.getData('scheduleId');
    const currentStatus = e.dataTransfer.getData('currentStatus');
    if (currentStatus === targetStatus) return;
    await handleStatusChange(scheduleId, targetStatus);
  };

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
    <div className="space-y-6 animate-slide-in" data-testid="kanban-board">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Status Board
          </h2>
          <p className="text-sm text-slate-500 mt-1" data-testid="kanban-subtitle">Drag cards between columns to update class status</p>
        </div>
        <Button
          variant={selectionMode ? 'default' : 'outline'}
          size="sm"
          data-testid="kanban-select-mode"
          onClick={toggleSelectionMode}
          className={selectionMode ? '' : 'border-gray-200'}
        >
          <ListChecks className="w-4 h-4 mr-1" />
          Bulk Select
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {COLUMNS.map(col => {
          const items = getColumnSchedules(col.id);
          const allSelected = selectionMode && items.length > 0 && items.every(s => selectedIds.has(s.id));
          return (
            <section
              key={col.id}
              aria-label={`${col.label} column`}
              data-testid={`kanban-column-${col.id}`}
              onDragOver={(e) => { if (!selectionMode) e.preventDefault(); }}
              onDrop={(e) => handleDrop(e, col.id)}
              className="bg-gray-50/80 rounded-xl border border-gray-200 min-h-[400px]"
            >
              {/* Column header */}
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
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
                  <h3 className="text-sm font-semibold text-slate-700">{col.label}</h3>
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
                  <div className="text-center py-8 text-slate-300">
                    <p className="text-sm">No classes</p>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

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
    </div>
  );
}


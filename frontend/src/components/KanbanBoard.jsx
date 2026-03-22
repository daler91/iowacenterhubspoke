import { useState } from 'react';
import PropTypes from 'prop-types';
import { Clock, MapPin, Car, User, GripVertical, ChevronRight, AlertTriangle } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { schedulesAPI } from '../lib/api';
import { cn } from '../lib/utils';

const COLUMNS = [
  { id: 'upcoming', label: 'Upcoming', color: 'bg-indigo-500', lightColor: 'bg-indigo-50', textColor: 'text-indigo-700' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-amber-500', lightColor: 'bg-amber-50', textColor: 'text-amber-700' },
  { id: 'completed', label: 'Completed', color: 'bg-green-500', lightColor: 'bg-green-50', textColor: 'text-green-700' },
];

function KanbanCard({ schedule, onStatusChange, onEdit }) {
  const [dragging, setDragging] = useState(false);
  const classColor = schedule.class_color || '#0F766E';
  const className = schedule.class_name || 'Unassigned Class';

  return (
    <button
      type="button"
      data-testid={`kanban-card-${schedule.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('scheduleId', schedule.id);
        e.dataTransfer.setData('currentStatus', schedule.status || 'upcoming');
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={() => onEdit?.(schedule)}
      className={cn(
        "bg-white rounded-lg border border-gray-100 border-l-4 p-4 cursor-grab active:cursor-grabbing hover:shadow-md transition-all group appearance-none text-left w-full",
        dragging && "opacity-50 scale-95"
      )}
      style={{ borderLeftColor: classColor }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="w-4 h-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
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
          <span>{schedule.location_name}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <User className="w-3 h-3" />
          <span>{schedule.employee_name}</span>
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

      <div className="flex items-center justify-between mt-3 pl-[26px]">
        <button
          onClick={() => onEdit?.(schedule)}
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
              onClick={() => onStatusChange(schedule.id, (schedule.status || 'upcoming') === 'upcoming' ? 'in_progress' : 'completed')}
              className="h-6 text-[10px] px-2 text-slate-500 hover:text-slate-700"
              data-testid={`kanban-advance-${schedule.id}`}
            >
              <ChevronRight className="w-3 h-3 mr-0.5" />
              Move
            </Button>
          )}
        </div>
      </div>
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
};

export default function KanbanBoard({ schedules, onEditSchedule, onRefresh }) {
  const handleStatusChange = async (scheduleId, newStatus) => {
    try {
      await schedulesAPI.updateStatus(scheduleId, newStatus);
      toast.success(`Status updated to ${newStatus.replace('_', ' ')}`);
      onRefresh?.();
    } catch (err) {
      console.error(err);
      toast.error('Failed to update status');
    }
  };

  const handleDrop = async (e, targetStatus) => {
    e.preventDefault();
    const scheduleId = e.dataTransfer.getData('scheduleId');
    const currentStatus = e.dataTransfer.getData('currentStatus');
    if (currentStatus === targetStatus) return;
    await handleStatusChange(scheduleId, targetStatus);
  };

  const getColumnSchedules = (status) =>
    (schedules || []).filter(s => (s.status || 'upcoming') === status)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

  return (
    <div className="space-y-6 animate-slide-in" data-testid="kanban-board">
      <div>
        <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Status Board
        </h2>
        <p className="text-sm text-slate-500 mt-1" data-testid="kanban-subtitle">Drag cards between columns to update class status</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {COLUMNS.map(col => {
          const items = getColumnSchedules(col.id);
          return (
            <section
              key={col.id}
              aria-label={`${col.label} column`}
              data-testid={`kanban-column-${col.id}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, col.id)}
              className="bg-gray-50/80 rounded-xl border border-gray-200 min-h-[400px]"
            >
              {/* Column header */}
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
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
    </div>
  );
}

KanbanBoard.propTypes = {
  schedules: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      status: PropTypes.string,
      date: PropTypes.string,
      start_time: PropTypes.string,
    })
  ),
  onEditSchedule: PropTypes.func,
  onRefresh: PropTypes.func,
};

import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import {
  DndContext, closestCenter, type DragEndEvent,
  PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { ArrowLeft, Plus, Check, X, Paperclip, MessageSquare, CalendarDays, MapPin, Building2, ChevronDown, ChevronRight, Megaphone, Users } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { PageBreadcrumb } from '../ui/page-breadcrumb';
import { useProject, useProjectTasks } from '../../hooks/useCoordinationData';
import { projectTasksAPI } from '../../lib/coordination-api';
import { schedulesAPI } from '../../lib/api';
import {
  PROJECT_PHASES, PHASE_LABELS, PHASE_DOT_COLORS, PHASE_COLORS,
  OWNER_COLORS, OWNER_LABELS, type Task, type TaskPhase,
} from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import OutcomeTracker from './OutcomeTracker';
import PromotionChecklist from './PromotionChecklist';
import ExportButton from './ExportButton';
import TaskDetailModal from './TaskDetailModal';

function PhaseDroppable({ phase, children }: Readonly<{ phase: string; children: React.ReactNode }>) {
  const { setNodeRef, isOver } = useDroppable({ id: phase });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex-1 min-w-[260px] rounded-xl p-3 transition-colors',
        isOver ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'bg-gray-50 dark:bg-gray-900/50',
      )}
    >
      {children}
    </div>
  );
}

function TaskCard({
  task, projectId, onRefresh, onOpen,
}: Readonly<{
  task: Task; projectId: string; onRefresh: () => void; onOpen: () => void;
}>) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const isOverdue = !task.completed && task.due_date < new Date().toISOString();

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await projectTasksAPI.toggleComplete(projectId, task.id);
      onRefresh();
    } catch {
      toast.error('Failed to update task');
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn('touch-none', isDragging && 'opacity-50')}
    >
      <Card
        className={cn(
          'p-3 mb-2 border transition-shadow hover:shadow-md cursor-pointer',
          task.completed && 'opacity-45',
        )}
        onClick={onOpen}
      >
        <div className="flex items-start gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); handleToggle(); }}
            className={cn(
              'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors',
              task.completed
                ? 'bg-green-500 border-green-500 text-white'
                : 'border-slate-300 dark:border-slate-600 hover:border-indigo-400',
            )}
          >
            {task.completed && <Check className="w-3 h-3" />}
          </button>
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-sm font-medium text-slate-800 dark:text-slate-100',
              task.completed && 'line-through text-slate-400',
            )}>
              {task.title}
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge className={cn('text-[10px] px-1.5 py-0', OWNER_COLORS[task.owner])}>
                {OWNER_LABELS[task.owner]}
              </Badge>
              <span className={cn(
                'text-[10px]',
                isOverdue ? 'text-red-500 font-semibold' : 'text-slate-400',
              )}>
                {new Date(task.due_date).toLocaleDateString()}
              </span>
              {(task.attachment_count ?? 0) > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                  <Paperclip className="w-3 h-3" /> {task.attachment_count}
                </span>
              )}
              {(task.comment_count ?? 0) > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                  <MessageSquare className="w-3 h-3" /> {task.comment_count}
                </span>
              )}
            </div>
            {task.details && (
              <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{task.details}</p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function AddTaskInline({
  projectId, phase, onCreated, defaultDueDate,
}: Readonly<{
  projectId: string; phase: TaskPhase; onCreated: () => void; defaultDueDate?: string;
}>) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState<'internal' | 'partner' | 'both'>('internal');
  const [dueDate, setDueDate] = useState(defaultDueDate || new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      await projectTasksAPI.create(projectId, {
        title: title.trim(),
        phase,
        owner,
        due_date: new Date(dueDate).toISOString(),
      });
      setTitle('');
      setOwner('internal');
      setOpen(false);
      onCreated();
      toast.success('Task added');
    } catch {
      toast.error('Failed to add task');
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-xs text-slate-400 hover:text-indigo-500 py-2 flex items-center justify-center gap-1 transition-colors"
      >
        <Plus className="w-3 h-3" /> Add task
      </button>
    );
  }

  return (
    <div className="space-y-1.5 mt-1">
      <div className="flex items-center gap-1">
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Task title"
          className="text-sm h-8"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          autoFocus
        />
        <Button size="sm" onClick={handleAdd} disabled={loading} className="h-8 px-2 bg-indigo-600 text-white">
          <Check className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-8 px-2">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="text-xs h-7 w-32" />
        <div className="flex gap-0.5">
          {(['internal', 'partner', 'both'] as const).map(o => (
            <button
              key={o}
              type="button"
              onClick={() => setOwner(o)}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize',
                owner === o
                  ? o === 'internal' ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : o === 'partner' ? 'bg-purple-100 border-purple-300 text-purple-700'
                    : 'bg-orange-100 border-orange-300 text-orange-700'
                  : 'border-slate-200 text-slate-400 hover:border-slate-300',
              )}
            >
              {OWNER_LABELS[o]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const context = useOutletContext<Record<string, unknown>>() ?? {};
  const employees = (context.employees || []) as Array<{ id: string; name: string; email?: string; color?: string; created_at: string }>;
  const { project, isLoading: projectLoading } = useProject(id);
  const { tasks, mutateTasks, isLoading: tasksLoading } = useProjectTasks(id);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [linkedSchedule, setLinkedSchedule] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (project?.schedule_id) {
      schedulesAPI.getAll({ ids: project.schedule_id }).then(res => {
        const items = res.data?.items ?? res.data;
        if (Array.isArray(items) && items.length > 0) setLinkedSchedule(items[0]);
      }).catch(() => {});
    }
  }, [project?.schedule_id]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const tasksByPhase = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const phase of PROJECT_PHASES) {
      grouped[phase] = tasks
        .filter(t => t.phase === phase)
        .sort((a, b) => a.sort_order - b.sort_order);
    }
    return grouped;
  }, [tasks]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !active.data.current?.task) return;
    const task = active.data.current.task as Task;
    const newPhase = over.id as string;
    if (task.phase === newPhase) return;

    try {
      await projectTasksAPI.update(projectId, task.id, { phase: newPhase });
      mutateTasks();
    } catch {
      toast.error('Failed to move task');
    }
  };

  if (projectLoading || tasksLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!project || !id) {
    return <div className="p-6 text-slate-500">Project not found</div>;
  }

  const projectId = id;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <PageBreadcrumb segments={[
          { label: 'Coordination', path: '/coordination' },
          { label: 'Projects', path: '/coordination/board' },
          { label: project.title },
        ]} />
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {project.title}
          </h1>
          <Badge className={cn('text-xs', PHASE_COLORS[project.phase], 'text-white')}>
            {PHASE_LABELS[project.phase]}
          </Badge>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          {new Date(project.event_date).toLocaleDateString()} &middot; {project.venue_name}
          {project.location_name && <> &middot; <MapPin className="w-3 h-3 inline" /> {project.location_name}</>}
          {!project.location_name && project.community && <> &middot; {project.community}</>}
          {project.partner_org_name && (
            <> &middot; <Building2 className="w-3 h-3 inline" /> {project.partner_org_name}</>
          )}
          {project.partner_org_status && (
            <Badge variant="secondary" className="ml-2 text-[10px]">{project.partner_org_status}</Badge>
          )}
        </p>
        {/* Venue details from partner org */}
        {project.partner_org_venue_details && Object.values(project.partner_org_venue_details).some(Boolean) && (
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
            {project.partner_org_venue_details.capacity && (
              <span>Capacity: {project.partner_org_venue_details.capacity}</span>
            )}
            {project.partner_org_venue_details.wifi !== undefined && project.partner_org_venue_details.wifi !== null && (
              <span>WiFi: {project.partner_org_venue_details.wifi ? 'Yes' : 'No'}</span>
            )}
            {project.partner_org_venue_details.parking && (
              <span>Parking: {project.partner_org_venue_details.parking}</span>
            )}
            {project.partner_org_venue_details.accessibility && (
              <span>Access: {project.partner_org_venue_details.accessibility}</span>
            )}
          </div>
        )}
      </div>

      {/* Linked Schedule */}
      {linkedSchedule && (
        <Card className="p-4 mb-6 border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20">
          <div className="flex items-center gap-3">
            <CalendarDays className="w-5 h-5 text-indigo-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Linked Schedule</p>
              <p className="text-xs text-slate-500">
                {linkedSchedule.date as string} &middot; {(linkedSchedule.start_time as string) || ''} – {(linkedSchedule.end_time as string) || ''}
                {linkedSchedule.class_name && <> &middot; {linkedSchedule.class_name as string}</>}
                {linkedSchedule.location_name && <> &middot; {linkedSchedule.location_name as string}</>}
              </p>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {(linkedSchedule.status as string) || 'upcoming'}
            </Badge>
          </div>
        </Card>
      )}

      {/* Task Kanban */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {PROJECT_PHASES.map(phase => {
            const phaseTasks = tasksByPhase[phase] ?? [];
            const completed = phaseTasks.filter(t => t.completed).length;
            return (
              <PhaseDroppable key={phase} phase={phase}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className={cn('w-2.5 h-2.5 rounded-full', PHASE_DOT_COLORS[phase])} />
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {PHASE_LABELS[phase]}
                  </h3>
                  <span className="text-xs text-slate-400 ml-auto">
                    {completed}/{phaseTasks.length}
                  </span>
                </div>
                <div className="space-y-0">
                  {phaseTasks.map(task => (
                    <TaskCard key={task.id} task={task} projectId={projectId} onRefresh={mutateTasks} onOpen={() => setSelectedTaskId(task.id)} />
                  ))}
                </div>
                <AddTaskInline projectId={projectId} phase={phase} onCreated={mutateTasks} defaultDueDate={project.event_date?.split('T')[0]} />
              </PhaseDroppable>
            );
          })}
        </div>
      </DndContext>

      {/* Promotion Checklist */}
      <div className="mt-6">
        {project.phase === 'promotion' ? (
          <PromotionChecklist projectId={projectId} />
        ) : (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left group">
              <ChevronRight className="w-4 h-4 text-slate-400 transition-transform group-data-[state=open]:rotate-90" />
              <Megaphone className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-500 text-sm">Promotion Checklist</span>
              <Badge variant="secondary" className="text-[10px] ml-1">Active during Promotion</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <PromotionChecklist projectId={projectId} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Outcome Tracker */}
      <div className="mt-6">
        {project.phase === 'follow_up' || project.phase === 'complete' ? (
          <OutcomeTracker projectId={projectId} />
        ) : (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left group">
              <ChevronRight className="w-4 h-4 text-slate-400 transition-transform group-data-[state=open]:rotate-90" />
              <Users className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-500 text-sm">Outcomes</span>
              <Badge variant="secondary" className="text-[10px] ml-1">Active during Follow-Up</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <OutcomeTracker projectId={projectId} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Export */}
      <div className="mt-4 flex justify-end">
        <ExportButton
          endpoint="/exports/tasks"
          params={{ project_id: projectId }}
          label="Export Tasks"
        />
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-blue-100" /> You (Internal)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-purple-100" /> Partner
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded bg-orange-100" /> Both
        </span>
      </div>

      {/* Task Detail Modal */}
      {selectedTaskId && (
        <TaskDetailModal
          projectId={projectId}
          taskId={selectedTaskId}
          open={!!selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={mutateTasks}
          projectTitle={project?.title}
          employees={employees}
        />
      )}
    </div>
  );
}

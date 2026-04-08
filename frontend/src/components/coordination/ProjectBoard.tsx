import { useState, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  DndContext, closestCenter, type DragEndEvent,
  PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Plus, AlertTriangle } from 'lucide-react';
import { useProjectBoard } from '../../hooks/useCoordinationData';
import { projectsAPI } from '../../lib/coordination-api';
import {
  PROJECT_PHASES, PHASE_LABELS, PHASE_DOT_COLORS,
  EVENT_FORMAT_LABELS, type Project,
} from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import ProjectCreateDialog from './ProjectCreateDialog';

function DroppableColumn({ phase, children }: Readonly<{ phase: string; children: React.ReactNode }>) {
  const { setNodeRef, isOver } = useDroppable({ id: phase });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex-1 min-w-[280px] rounded-xl p-3 transition-colors',
        isOver ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'bg-gray-50 dark:bg-gray-900/50',
      )}
    >
      {children}
    </div>
  );
}

function DraggableProjectCard({ project }: Readonly<{ project: Project }>) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: project.id,
    data: { project },
  });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const progress = project.task_total
    ? Math.round(((project.task_completed ?? 0) / project.task_total) * 100)
    : 0;
  const hasOverdue = (project.partner_overdue ?? 0) > 0;

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
          'p-3 mb-2 cursor-pointer hover:shadow-md transition-shadow border',
          hasOverdue && 'border-amber-400 dark:border-amber-600',
        )}
        onClick={() => navigate(`/coordination/projects/${project.id}`)}
      >
        <div className="flex items-start justify-between mb-1.5">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100 line-clamp-2 flex-1">
            {project.title}
          </h4>
          {hasOverdue && (
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 ml-1" />
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
          {new Date(project.event_date).toLocaleDateString()} &middot; {project.venue_name}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">{project.community}</p>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {EVENT_FORMAT_LABELS[project.event_format] || project.event_format}
          </Badge>
        </div>
        {project.task_total ? (
          <div>
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>{project.task_completed}/{project.task_total} tasks</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export default function ProjectBoard() {
  const context = useOutletContext<Record<string, unknown>>() ?? {};
  const classes = (context.classes || []) as Array<{ id: string; name: string; color?: string }>;
  const [communityFilter, setCommunityFilter] = useState('');
  const [eventFormatFilter, setEventFormatFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { board, mutateBoard, isLoading } = useProjectBoard({
    ...(communityFilter && { community: communityFilter }),
    ...(eventFormatFilter && { event_format: eventFormatFilter }),
    ...(classFilter && { class_id: classFilter }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const communities = useMemo(() => {
    if (!board?.columns) return [];
    const set = new Set<string>();
    Object.values(board.columns).flat().forEach(p => set.add(p.community));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [board]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !active.data.current?.project) return;
    const project = active.data.current.project as Project;
    const newPhase = over.id as string;
    if (project.phase === newPhase) return;

    try {
      await projectsAPI.update(project.id, { phase: newPhase });
      mutateBoard();
      toast.success(`Moved "${project.title}" to ${PHASE_LABELS[newPhase]}`);
    } catch {
      toast.error('Failed to update project phase');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Project Board
        </h1>
        <div className="flex items-center gap-3">
          <select
            value={communityFilter}
            onChange={e => setCommunityFilter(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700"
          >
            <option value="">All Communities</option>
            {communities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={eventFormatFilter}
            onChange={e => setEventFormatFilter(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700"
          >
            <option value="">All Formats</option>
            {Object.entries(EVENT_FORMAT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700"
          >
            <option value="">All Classes</option>
            {classes.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus className="w-4 h-4 mr-1" /> New Project
          </Button>
        </div>
      </div>

      {/* Kanban Columns */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {PROJECT_PHASES.map(phase => {
            const projects = board?.columns?.[phase] ?? [];
            return (
              <DroppableColumn key={phase} phase={phase}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className={cn('w-2.5 h-2.5 rounded-full', PHASE_DOT_COLORS[phase])} />
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {PHASE_LABELS[phase]}
                  </h3>
                  <span className="text-xs text-slate-400 ml-auto">{projects.length}</span>
                </div>
                <div className="space-y-0">
                  {projects.map(project => (
                    <DraggableProjectCard key={project.id} project={project} />
                  ))}
                  {projects.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-8">No projects</p>
                  )}
                </div>
              </DroppableColumn>
            );
          })}
        </div>
      </DndContext>

      {showCreate && (
        <ProjectCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); mutateBoard(); }}
        />
      )}
    </div>
  );
}

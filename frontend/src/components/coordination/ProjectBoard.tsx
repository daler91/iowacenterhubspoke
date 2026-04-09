import { useState, useMemo } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  DndContext, closestCenter, type DragEndEvent,
  PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Plus, AlertTriangle, Search, ChevronDown, ChevronRight, CheckCircle2, FolderOpen } from 'lucide-react';
import { Input } from '../ui/input';
import { useProjectBoard } from '../../hooks/useCoordinationData';
import { projectsAPI } from '../../lib/coordination-api';
import {
  PROJECT_PHASES, PHASE_LABELS, PHASE_DOT_COLORS,
  EVENT_FORMAT_LABELS, type Project,
} from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import ProjectCreateDialog from './ProjectCreateDialog';
import { SearchableSelect } from '../ui/searchable-select';

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
  const employees = (context.employees || []) as Array<{ id: string; name: string; email?: string; color?: string; created_at: string }>;
  const [searchParams, setSearchParams] = useSearchParams();
  const [communityFilter, setCommunityFilter] = useState(searchParams.get('community') || '');
  const [eventFormatFilter, setEventFormatFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [showCreate, setShowCreate] = useState(() => searchParams.get('create') === 'true');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);

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

  // Phase gate state
  const [phaseGateWarning, setPhaseGateWarning] = useState<{
    projectId: string;
    projectTitle: string;
    incompleteTasks: { id: string; title: string }[];
    completionPercentage: number;
    currentPhase: string;
    nextPhase: string;
  } | null>(null);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !active.data.current?.project) return;
    const project = active.data.current.project as Project;
    const newPhase = over.id as string;
    if (project.phase === newPhase) return;

    // Determine if this is a forward phase advancement
    const phaseOrder = PROJECT_PHASES as readonly string[];
    const currentIdx = phaseOrder.indexOf(project.phase);
    const newIdx = phaseOrder.indexOf(newPhase);
    const isForwardMove = newIdx > currentIdx && newIdx === currentIdx + 1;

    if (isForwardMove) {
      try {
        const res = await projectsAPI.advancePhase(project.id);
        const data = res.data;
        if (data.warning) {
          // Show phase gate dialog
          setPhaseGateWarning({
            projectId: project.id,
            projectTitle: project.title,
            incompleteTasks: data.incomplete_tasks,
            completionPercentage: data.completion_percentage,
            currentPhase: data.current_phase,
            nextPhase: data.next_phase,
          });
          return;
        }
        mutateBoard();
        toast.success(`Moved "${project.title}" to ${PHASE_LABELS[newPhase]}`);
      } catch {
        toast.error('Failed to advance project phase');
      }
    } else {
      // Backward or multi-step move: direct update without gate
      try {
        await projectsAPI.update(project.id, { phase: newPhase });
        mutateBoard();
        toast.success(`Moved "${project.title}" to ${PHASE_LABELS[newPhase]}`);
      } catch {
        toast.error('Failed to update project phase');
      }
    }
  };

  const handleForceAdvance = async () => {
    if (!phaseGateWarning) return;
    try {
      await projectsAPI.advancePhase(phaseGateWarning.projectId, true);
      mutateBoard();
      toast.success(`Moved "${phaseGateWarning.projectTitle}" to ${PHASE_LABELS[phaseGateWarning.nextPhase]}`);
    } catch {
      toast.error('Failed to advance project phase');
    } finally {
      setPhaseGateWarning(null);
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
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Project Board
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage partner coordination — track projects through planning, promotion, delivery, and follow-up</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-48">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="pl-8 h-10 text-sm"
            />
          </div>
          <div className="w-44">
            <SearchableSelect
              options={communities.map(c => ({ value: c, label: c }))}
              value={communityFilter}
              onValueChange={setCommunityFilter}
              placeholder="All Communities"
              searchPlaceholder="Search communities..."
              emptyMessage="No communities found."
            />
          </div>
          <div className="w-40">
            <SearchableSelect
              options={Object.entries(EVENT_FORMAT_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              value={eventFormatFilter}
              onValueChange={setEventFormatFilter}
              placeholder="All Formats"
              searchPlaceholder="Search formats..."
              emptyMessage="No formats found."
            />
          </div>
          <div className="w-40">
            <SearchableSelect
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              value={classFilter}
              onValueChange={setClassFilter}
              placeholder="All Classes"
              searchPlaceholder="Search classes..."
              emptyMessage="No classes found."
            />
          </div>
          <Button onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus className="w-4 h-4 mr-1" /> New Project
          </Button>
        </div>
      </div>

      {/* Kanban Columns */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex flex-col md:flex-row gap-4 md:overflow-x-auto pb-4">
          {PROJECT_PHASES.map(phase => {
            const allProjects = board?.columns?.[phase] ?? [];
            const projects = searchQuery
              ? allProjects.filter(p =>
                  p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  p.venue_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  p.community?.toLowerCase().includes(searchQuery.toLowerCase())
                )
              : allProjects;
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
                    <div className="text-center py-8">
                      <FolderOpen className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                      <p className="text-xs text-slate-400">
                        {searchQuery ? 'No matching projects' : `No projects in ${PHASE_LABELS[phase]}`}
                      </p>
                      {!searchQuery && phase === 'planning' && (
                        <button
                          onClick={() => setShowCreate(true)}
                          className="text-xs text-indigo-500 hover:text-indigo-600 mt-1"
                        >
                          Create your first project
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </DroppableColumn>
            );
          })}
        </div>
      </DndContext>

      {/* Completed Projects Section */}
      {board?.columns?.complete && board.columns.complete.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
          >
            {showCompleted ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Completed ({board.columns.complete.length})
          </button>
          {showCompleted && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {board.columns.complete.map(project => (
                <Card
                  key={project.id}
                  className="p-3 cursor-pointer hover:shadow-md transition-shadow border opacity-75 hover:opacity-100"
                  onClick={() => navigate(`/coordination/projects/${project.id}`)}
                >
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 line-clamp-1">{project.title}</h4>
                  <p className="text-xs text-slate-400 mt-1">
                    {new Date(project.event_date).toLocaleDateString()} &middot; {project.community}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {EVENT_FORMAT_LABELS[project.event_format] || project.event_format}
                    </Badge>
                    {project.task_total ? (
                      <span className="text-[10px] text-green-600">{project.task_completed}/{project.task_total} tasks</span>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <ProjectCreateDialog
          classes={classes}
          employees={employees}
          onClose={() => { setShowCreate(false); setSearchParams((prev) => { prev.delete('create'); return prev; }, { replace: true }); }}
          onCreated={() => { setShowCreate(false); setSearchParams((prev) => { prev.delete('create'); return prev; }, { replace: true }); mutateBoard(); }}
        />
      )}

      {/* Phase Gate Warning Dialog */}
      <Dialog open={!!phaseGateWarning} onOpenChange={() => setPhaseGateWarning(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Incomplete Tasks
            </DialogTitle>
          </DialogHeader>
          {phaseGateWarning && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                <strong>{phaseGateWarning.completionPercentage}%</strong> of tasks in{' '}
                <strong>{PHASE_LABELS[phaseGateWarning.currentPhase]}</strong> are complete.
                The following tasks are still open:
              </p>
              <ul className="max-h-48 overflow-y-auto space-y-1 text-sm">
                {phaseGateWarning.incompleteTasks.map(t => (
                  <li key={t.id} className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                    {t.title}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-slate-500">
                Advance to <strong>{PHASE_LABELS[phaseGateWarning.nextPhase]}</strong> anyway?
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPhaseGateWarning(null)}>Cancel</Button>
            <Button onClick={handleForceAdvance} className="bg-amber-600 hover:bg-amber-700 text-white">
              Advance Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

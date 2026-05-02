import { useEffect, useState } from 'react';
import {
  DndContext, closestCenter, type DragEndEvent,
  PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core';
import { AlertTriangle, MessageSquare, Paperclip, Star } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { TASK_STATUSES, TASK_STATUS_COLORS, TASK_STATUS_LABELS, OWNER_COLORS, OWNER_LABELS, type Project, type Task, type TaskStatus } from '../../lib/coordination-types';
import { cn } from '../../lib/utils';

const DND_ID = 'portal-task-board-dnd';

function statusForTask(task: Task): TaskStatus {
  return task.completed ? 'completed' : (task.status || 'to_do');
}

function DroppableColumn({ status, children }: Readonly<{ status: TaskStatus; children: React.ReactNode }>) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return <div ref={setNodeRef} className={cn('rounded-lg bg-muted/50 dark:bg-card/50 p-3 min-h-[10rem] transition-colors', isOver && 'bg-hub-soft/30')}>{children}</div>;
}

function DraggableTaskCard({ task, onOpen }: Readonly<{ task: Task; onOpen: () => void }>) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id: task.id, data: { task } });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  const isOverdue = !task.completed && task.due_date < new Date().toISOString();
  return (
    <Card ref={setNodeRef} style={style} {...listeners} {...attributes} aria-describedby={DND_ID} className={cn('p-2.5 border cursor-grab active:cursor-grabbing touch-none', isDragging && 'opacity-50', task.completed && 'opacity-60', task.spotlight && 'border-l-4 border-l-warn bg-warn-soft/30', task.at_risk && !task.spotlight && 'border-l-4 border-l-danger bg-danger-soft/30')}>
      {task.at_risk && <div className="mb-2 inline-flex items-center gap-1 rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger-strong"><AlertTriangle className="h-3 w-3" />AT RISK</div>}
      {task.spotlight && <Star className="mb-1 h-3.5 w-3.5 text-warn-strong fill-warn" />}
      <button type="button" onClick={onOpen} className={cn('text-sm text-left hover:underline w-full', task.completed && 'line-through text-muted-foreground')}>{task.title}</button>
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        <span className={cn('text-[11px]', isOverdue ? 'text-danger-strong font-semibold' : 'text-muted-foreground')}>{new Date(task.due_date).toLocaleDateString()}</span>
        <Badge className={cn('text-[10px] px-1.5', OWNER_COLORS[task.owner])}>{OWNER_LABELS[task.owner]}</Badge>
        {(task.attachment_count ?? 0) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground"><Paperclip className="h-3 w-3" />{task.attachment_count}</span>}
        {(task.comment_count ?? 0) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground"><MessageSquare className="h-3 w-3" />{task.comment_count}</span>}
      </div>
    </Card>
  );
}

function StatusColumn({ status, tasks, onOpenTask }: Readonly<{ status: TaskStatus; tasks: Task[]; onOpenTask: (taskId: string) => void }>) {
  return (
    <DroppableColumn status={status}>
      <div className="mb-3 flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 rounded-full', TASK_STATUS_COLORS[status])} />
        <h4 className="text-sm font-semibold">{TASK_STATUS_LABELS[status]}</h4>
        <span className="ml-auto text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="space-y-2">
        {tasks.length
          ? tasks.map((task) => <DraggableTaskCard key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />)
          : <p className="text-xs text-muted-foreground py-4 text-center">No tasks</p>}
      </div>
    </DroppableColumn>
  );
}

function ProjectBoardSection({ project, tasks, onOpenTask }: Readonly<{ project: Project; tasks: Task[]; onOpenTask: (projectId: string, taskId: string) => void }>) {
  const tasksByStatus = TASK_STATUSES.reduce<Record<TaskStatus, Task[]>>((acc, status) => {
    acc[status] = [];
    return acc;
  }, {} as Record<TaskStatus, Task[]>);

  tasks.forEach((task) => {
    const status = statusForTask(task);
    if (!Object.prototype.hasOwnProperty.call(tasksByStatus, status)) return;
    tasksByStatus[status].push(task);
  });

  return (
    <section>
      <h3 className="font-semibold text-foreground mb-2">{project.title}</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {TASK_STATUSES.map((status) => (
          <StatusColumn key={status} status={status} tasks={tasksByStatus[status]} onOpenTask={(taskId) => onOpenTask(project.id, taskId)} />
        ))}
      </div>
    </section>
  );
}

export default function PortalTaskBoard({ projects, allTasks, onOpenTask, onMoveTask }: Readonly<{ projects: Project[]; allTasks: Record<string, Task[]>; onOpenTask: (projectId: string, taskId: string) => void; onMoveTask: (projectId: string, task: Task, status: TaskStatus) => Promise<{ ok: boolean; message?: string }>; }>) {
  const [optimistic, setOptimistic] = useState<Record<string, Task[]>>(allTasks);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));

  useEffect(() => setOptimistic(allTasks), [allTasks]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !active.data.current?.task) return;
    const task = active.data.current.task as Task;
    const newStatus = over.id as TaskStatus;
    const currentStatus = statusForTask(task);
    if (currentStatus === newStatus) return;
    const list = optimistic[task.project_id] || [];
    setOptimistic({ ...optimistic, [task.project_id]: list.map(t => t.id === task.id ? { ...t, status: newStatus, completed: newStatus === 'completed' } : t) });
    const res = await onMoveTask(task.project_id, task, newStatus);
    if (!res.ok) setOptimistic(allTasks);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <p id={DND_ID} className="sr-only">Press Space to pick up, arrow keys to move, Enter to drop, Escape to cancel.</p>
      <div className="space-y-4">
        {projects.map((project) => {
          const tasks = optimistic[project.id] || [];
          if (tasks.length === 0) return null;

          return (
            <ProjectBoardSection key={project.id} project={project} tasks={tasks} onOpenTask={onOpenTask} />
          );
        })}
      </div>
    </DndContext>
  );
}

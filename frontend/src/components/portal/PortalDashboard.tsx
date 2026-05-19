import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import {
  AlertTriangle,
  Bell,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  Columns3,
  Download,
  Eye,
  FileText,
  GraduationCap,
  Inbox,
  List,
  Mail,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { PageShell } from '../ui/page-shell';
import { SearchableSelect } from '../ui/searchable-select';
import AttachmentPreviewDialog from '../coordination/AttachmentPreviewDialog';
import MentionTextarea, { renderMentionBody } from '../coordination/MentionTextarea';
import NotificationPreferences from '../NotificationPreferences';
import { canPreview, previewKind } from '../../lib/attachment-preview';
import { portalAPI } from '../../lib/coordination-api';
import {
  EVENT_FORMAT_LABELS,
  OWNER_COLORS,
  OWNER_LABELS,
  PHASE_DOT_COLORS,
  PHASE_LABELS,
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type Mention,
  type Message,
  type PortalActivityEvent,
  type PortalWorkspace,
  type Project,
  type ProjectDocument,
  type ProjectMember,
  type Task,
  type TaskStatus,
} from '../../lib/coordination-types';
import { formatCalendarDate, isPastCalendarDate } from '../../lib/date-format';
import { describeApiError } from '../../lib/error-messages';
import { cn } from '../../lib/utils';
import { usePortalProjectWorkspace, usePortalSession, usePortalWorkspace } from '../../hooks/usePortalData';
import PortalShell from './PortalShell';
import PortalTaskBoard from './PortalTaskBoard';
import PortalTaskDetailModal from './PortalTaskDetailModal';
import { runPortalAsync } from './async';

const INVALID_PORTAL_LINK_MESSAGE = 'This portal link is invalid or expired.';
const REQUEST_LINK_SUCCESS_MESSAGE = 'If that email is registered, a new link has been sent.';
const LEGACY_PORTAL_TOKEN_KEY = 'portal_session_token';
const ALL_PROJECTS = 'all';
const ALL_STATUSES = 'all';
const OVERDUE_ONLY = 'overdue';

type PortalSection = 'home' | 'projects' | 'project' | 'tasks' | 'documents' | 'messages' | 'settings';
type TaskViewMode = 'list' | 'board';
type TasksByProject = Record<string, Task[]>;

interface NotificationSummary {
  mentions_requested?: number;
  mentions_resolved?: number;
  message_recipients_notified?: number;
  mention_recipients_notified?: number;
}

interface PreviewState {
  doc: ProjectDocument;
  url: string;
}

type ProjectSummary = PortalWorkspace['projects'][number];

function setPendingKey(
  setter: Dispatch<SetStateAction<Record<string, boolean>>>,
  key: string,
  pending: boolean,
) {
  setter((prev) => {
    if (pending) return { ...prev, [key]: true };
    const next = { ...prev };
    delete next[key];
    return next;
  });
}

function taskActionKey(projectId: string, taskId: string) {
  return `${projectId}:${taskId}`;
}

function documentActionKey(action: 'preview' | 'download', projectId: string, docId: string) {
  return `${action}:${projectId}:${docId}`;
}

function portalPath(token: string, section: string, projectId?: string) {
  if (projectId) return `/portal/${token}/projects/${projectId}`;
  if (section === 'home') return `/portal/${token}`;
  return `/portal/${token}/${section}`;
}

function routeSection(pathname: string, projectId?: string): PortalSection {
  if (projectId) return 'project';
  if (pathname.includes('/tasks')) return 'tasks';
  if (pathname.includes('/documents')) return 'documents';
  if (pathname.includes('/messages')) return 'messages';
  if (pathname.includes('/settings')) return 'settings';
  if (pathname.endsWith('/projects')) return 'projects';
  return 'home';
}

function pluralizeRecipients(count: number): string {
  return `${count} recipient${count === 1 ? '' : 's'}`;
}

function buildDeliverySummaryFromMessageDoc(messageDoc: unknown, mentionsSent: number): NotificationSummary {
  const doc = (messageDoc && typeof messageDoc === 'object') ? (messageDoc as { mentions?: unknown[] }) : null;
  const resolvedMentions = Array.isArray(doc?.mentions) ? doc.mentions.length : 0;
  return {
    mentions_requested: mentionsSent,
    mentions_resolved: resolvedMentions,
    mention_recipients_notified: 0,
    message_recipients_notified: 0,
  };
}

function messageDeliveryText(summary: NotificationSummary | undefined, mentionsSent: number): string {
  if (!summary) return 'Message sent';
  if (mentionsSent > 0) {
    const mentionDeliveries = summary.mention_recipients_notified ?? 0;
    if (mentionDeliveries > 0) {
      return `Message sent. Mention notifications sent to ${pluralizeRecipients(mentionDeliveries)}.`;
    }
    if ((summary.mentions_resolved ?? 0) === 0) {
      return 'Message sent, but no matching mention recipients were found.';
    }
    return 'Message sent. Mention recipients had notifications off or already received the alert.';
  }
  const messageDeliveries = summary.message_recipients_notified ?? 0;
  if (messageDeliveries > 0) return `Message sent. Notifications sent to ${pluralizeRecipients(messageDeliveries)}.`;
  return 'Message sent';
}

function activityLabel(action: string) {
  return action
    .split('_').join(' ')
    .replace(/\b\w/g, (char: string) => char.toUpperCase());
}

function projectProgress(project: ProjectSummary | Project, taskOverride?: readonly Task[]) {
  if (taskOverride) {
    const total = taskOverride.length;
    const completed = taskOverride.filter((task) => task.completed).length;
    return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
  }
  const counts = 'portal_task_counts' in project ? project.portal_task_counts : undefined;
  const total = counts?.total ?? project.task_total ?? 0;
  const completed = counts?.completed ?? project.task_completed ?? 0;
  return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
}

function statusForTask(task: Task): TaskStatus {
  return task.completed ? 'completed' : (task.status || 'to_do');
}

function taskMatchesStatusFilter(task: Task, statusFilter: string) {
  if (statusFilter === OVERDUE_ONLY) return !task.completed && isPastCalendarDate(task.due_date);
  if (statusFilter !== ALL_STATUSES) return statusForTask(task) === statusFilter;
  return true;
}

function filteredTasksForProject(
  project: ProjectSummary,
  allTasks: TasksByProject,
  statusFilter: string,
) {
  return (allTasks[project.id] || []).filter((task) => taskMatchesStatusFilter(task, statusFilter));
}

function buildFilteredTasks(
  projects: readonly ProjectSummary[],
  allTasks: TasksByProject,
  statusFilter: string,
) {
  return projects.flatMap((project) => filteredTasksForProject(project, allTasks, statusFilter));
}

function buildFilteredTaskMap(
  projects: readonly ProjectSummary[],
  allTasks: TasksByProject,
  statusFilter: string,
) {
  return Object.fromEntries(
    projects.map((project) => [project.id, filteredTasksForProject(project, allTasks, statusFilter)]),
  );
}

function phaseBadgeClass(phase: string) {
  switch (phase) {
    case 'planning':
      return 'bg-info-soft text-info-strong border-info/20';
    case 'promotion':
      return 'bg-warn-soft text-warn-strong border-warn/20';
    case 'delivery':
      return 'bg-spoke-soft text-spoke-strong border-spoke/20';
    case 'follow_up':
      return 'bg-ownership-partner-soft text-ownership-partner-strong border-ownership-partner/20';
    default:
      return 'bg-muted text-foreground/80 border-border';
  }
}

function neutralBadgeClass(extra = '') {
  return cn('bg-muted text-foreground/80 border-border', extra);
}

function ProgressBar({ percent, label = 'Progress' }: Readonly<{ percent: number; label?: string }>) {
  return (
    <div
      className="h-2 w-full rounded-full bg-muted overflow-hidden"
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-spoke transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}

function hasPartnerWriteAccess(task: Task) {
  return task.owner === 'partner' || task.owner === 'both';
}

function usePortalTasks(token: string, projects: readonly ProjectSummary[] | undefined) {
  const projectIds = useMemo(() => (projects ?? []).map(project => project.id), [projects]);
  const key = token && projectIds.length ? ['portal-tasks', token, projectIds.join('|')] : null;
  const { data, error, isLoading, mutate } = useSWR<Record<string, Task[]>>(
    key,
    async () => {
      const res = await portalAPI.bulkProjectTasks(projectIds, token);
      const items = (res.data?.items || {}) as Record<string, Task[]>;
      return Object.fromEntries(projectIds.map(id => [id, items[id] || []]));
    },
    { shouldRetryOnError: false },
  );
  return {
    allTasks: data ?? Object.fromEntries(projectIds.map(id => [id, []])),
    error,
    isLoading,
    mutateTasks: mutate,
  };
}

function usePortalDocuments(token: string, projects: readonly ProjectSummary[] | undefined) {
  const projectIds = useMemo(() => (projects ?? []).map(project => project.id), [projects]);
  const key = token && projectIds.length ? ['portal-documents', token, projectIds.join('|')] : null;
  const { data, error, isLoading, mutate } = useSWR<Record<string, ProjectDocument[]>>(
    key,
    async () => {
      const entries = await Promise.all(projectIds.map(async (projectId) => {
        const res = await portalAPI.projectDocuments(projectId, token);
        return [projectId, (res.data?.items || []) as ProjectDocument[]] as const;
      }));
      return Object.fromEntries(entries);
    },
    { shouldRetryOnError: false },
  );
  return {
    documents: data ?? Object.fromEntries(projectIds.map(id => [id, []])),
    error,
    isLoading,
    mutateDocuments: mutate,
  };
}

function PortalLoading() {
  return (
    <div
      className="flex h-screen bg-background overflow-hidden"
      role="status"
      aria-label="Loading portal"
      aria-live="polite"
    >
      <div className="hidden md:block w-[260px] border-r border-border bg-card" />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 border-b border-border bg-card shrink-0" />
        <main className="flex-1 flex items-center justify-center">
          <span className="w-10 h-10 border-4 border-hub border-t-transparent rounded-full animate-spin" />
        </main>
      </div>
    </div>
  );
}

function PortalRecovery() {
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [requestingLink, setRequestingLink] = useState(false);
  const [requestLinkMessage, setRequestLinkMessage] = useState('');
  const [requestLinkError, setRequestLinkError] = useState('');

  const handleRequestLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = recoveryEmail.trim();
    if (!email) return;

    setRequestingLink(true);
    setRequestLinkError('');
    setRequestLinkMessage('');
    try {
      await portalAPI.requestLink(email);
      setRequestLinkMessage(REQUEST_LINK_SUCCESS_MESSAGE);
    } catch (err) {
      setRequestLinkError(describeApiError(err, "We couldn't send a new link. Please try again."));
    } finally {
      setRequestingLink(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/50 p-4">
      <Card className="p-6 sm:p-8 w-full max-w-md" role="alert" data-testid="portal-recovery">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-warn-soft flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-warn-strong" aria-hidden="true" />
          </div>
          <p className="text-xs uppercase text-foreground/60 font-semibold mb-1">
            HubSpoke Partner Portal
          </p>
          <h2 className="text-xl font-semibold mb-2">Request a new portal link</h2>
          <p className="text-sm text-foreground/80">{INVALID_PORTAL_LINK_MESSAGE}</p>
        </div>

        <form className="mt-6 space-y-3" onSubmit={handleRequestLink}>
          <label htmlFor="portal-recovery-email" className="text-sm font-medium text-foreground">
            Email address
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="portal-recovery-email"
              type="email"
              autoComplete="email"
              value={recoveryEmail}
              onChange={(event) => {
                setRecoveryEmail(event.target.value);
                setRequestLinkError('');
                setRequestLinkMessage('');
              }}
              placeholder="name@example.com"
              className="min-w-0"
            />
            <Button
              type="submit"
              disabled={requestingLink || !recoveryEmail.trim()}
              className="shrink-0"
            >
              <Mail className="w-4 h-4 mr-2" aria-hidden="true" />
              {requestingLink ? 'Sending...' : 'Send new link'}
            </Button>
          </div>
          {requestLinkMessage && (
            <output className="text-sm text-spoke-strong block" aria-live="polite" aria-atomic="true">
              {requestLinkMessage}
            </output>
          )}
          {requestLinkError && (
            <p className="text-sm text-warn-strong" role="alert">
              {requestLinkError}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone = 'hub',
  detail,
}: Readonly<{
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'hub' | 'spoke' | 'warn';
  detail?: ReactNode;
}>) {
  const toneClasses = {
    hub: 'bg-hub-soft text-hub-strong',
    spoke: 'bg-spoke-soft text-spoke-strong',
    warn: 'bg-warn-soft text-warn-strong',
  };
  return (
    <Card className="p-4 flex items-center gap-3 border" data-testid={`portal-metric-${label.toLowerCase().split(' ').join('-')}`}>
      <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center shrink-0', toneClasses[tone])}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-foreground/80">{label}</p>
        {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      </div>
    </Card>
  );
}

function EmptyState({
  title,
  description,
  icon,
}: Readonly<{
  title: string;
  description: string;
  icon?: ReactNode;
}>) {
  return (
    <Card className="p-8 text-center" data-testid="portal-empty-state">
      <div className="mb-3 flex justify-center text-muted-foreground">
        {icon ?? <Inbox className="w-10 h-10" aria-hidden="true" />}
      </div>
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">{description}</p>
    </Card>
  );
}

function ProjectCard({
  project,
  onOpen,
}: Readonly<{
  project: ProjectSummary;
  onOpen: () => void;
}>) {
  const progress = projectProgress(project);
  const overdue = project.portal_task_counts?.overdue ?? project.partner_overdue ?? 0;
  return (
    <Card className="border hover:shadow-md transition-shadow" data-testid={`portal-project-card-${project.id}`}>
      <button
        type="button"
        onClick={onOpen}
        className="w-full p-4 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', PHASE_DOT_COLORS[project.phase])} aria-hidden="true" />
              <h3 className="font-semibold text-foreground line-clamp-2">{project.title}</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatCalendarDate(project.event_date)} - {project.venue_name}
            </p>
            <p className="text-xs text-muted-foreground">{project.community}</p>
          </div>
          {overdue > 0 && (
            <Badge className="bg-warn-soft text-warn-strong border-0 shrink-0">
              {overdue} overdue
            </Badge>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Badge className={neutralBadgeClass('text-[10px] px-1.5')}>
            {EVENT_FORMAT_LABELS[project.event_format] || project.event_format}
          </Badge>
          <Badge className={cn('text-[10px] px-1.5', phaseBadgeClass(project.phase))}>
            {PHASE_LABELS[project.phase]}
          </Badge>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
            <span>{progress.completed}/{progress.total} tasks</span>
            <span>{progress.percent}%</span>
          </div>
          <ProgressBar percent={progress.percent} label={`${project.title} progress`} />
        </div>
      </button>
    </Card>
  );
}

function ActivityList({
  events,
  emptyTitle = 'No recent activity',
}: Readonly<{
  events: readonly PortalActivityEvent[];
  emptyTitle?: string;
}>) {
  if (!events.length) {
    return (
      <EmptyState
        title={emptyTitle}
        description="Shared task, document, and message updates will appear here."
        icon={<Bell className="w-10 h-10" aria-hidden="true" />}
      />
    );
  }
  return (
    <Card className="divide-y divide-border" data-testid="portal-activity-list">
      {events.map((event) => (
        <div key={event.id} className="p-4 flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-hub-soft text-hub-strong flex items-center justify-center shrink-0">
            <Bell className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{event.title || activityLabel(event.action)}</p>
            {event.body && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{event.body}</p>}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {event.actor_name} - {formatCalendarDate(event.created_at)}
            </p>
          </div>
          <Badge className={neutralBadgeClass('text-[10px] shrink-0')}>
            {activityLabel(event.action)}
          </Badge>
        </div>
      ))}
    </Card>
  );
}

function TaskCard({
  task,
  project,
  pending,
  onToggle,
  onOpen,
}: Readonly<{
  task: Task;
  project?: Project | ProjectSummary;
  pending: boolean;
  onToggle: () => void;
  onOpen: () => void;
}>) {
  const overdue = !task.completed && isPastCalendarDate(task.due_date);
  const status = statusForTask(task);
  return (
    <Card className={cn('p-3 border', task.completed && 'opacity-65', overdue && 'border-warn/60')} data-testid={`portal-task-card-${task.id}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          disabled={pending || !hasPartnerWriteAccess(task)}
          aria-label={`${task.completed ? 'Mark incomplete' : 'Mark complete'}: ${task.title}`}
          className={cn(
            'mt-0.5 h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1',
            'disabled:cursor-not-allowed disabled:opacity-50',
            task.completed ? 'bg-spoke border-spoke text-white' : 'border-border hover:border-hub',
          )}
        >
          {task.completed && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              'w-full text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub rounded',
              task.completed && 'line-through text-muted-foreground',
            )}
          >
            {task.title}
          </button>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <span className={cn('text-[11px]', overdue ? 'text-warn-strong font-semibold' : 'text-muted-foreground')}>
              {formatCalendarDate(task.due_date)}
            </span>
            <Badge className={cn('text-[10px] px-1.5', OWNER_COLORS[task.owner])}>
              {OWNER_LABELS[task.owner]}
            </Badge>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-full', TASK_STATUS_COLORS[status])} aria-hidden="true" />
              {TASK_STATUS_LABELS[status]}
            </span>
            {project && <span className="text-[11px] text-muted-foreground truncate max-w-[16rem]">{project.title}</span>}
            {(task.attachment_count ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Paperclip className="h-3 w-3" aria-hidden="true" />
                {task.attachment_count}
              </span>
            )}
            {(task.comment_count ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <MessageSquare className="h-3 w-3" aria-hidden="true" />
                {task.comment_count}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function TaskList({
  tasks,
  projectsById,
  pendingTaskIds,
  onToggleTask,
  onOpenTask,
}: Readonly<{
  tasks: readonly Task[];
  projectsById: Record<string, Project | ProjectSummary>;
  pendingTaskIds: Record<string, boolean>;
  onToggleTask: (projectId: string, task: Task) => void;
  onOpenTask: (projectId: string, taskId: string) => void;
}>) {
  if (!tasks.length) {
    return (
      <EmptyState
        title="No tasks assigned to you"
        description="Partner-visible tasks will show here as each project moves forward."
        icon={<CheckSquare className="w-10 h-10" aria-hidden="true" />}
      />
    );
  }

  return (
    <div className="space-y-2" data-testid="portal-task-list">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          project={projectsById[task.project_id]}
          pending={!!pendingTaskIds[taskActionKey(task.project_id, task.id)]}
          onToggle={() => onToggleTask(task.project_id, task)}
          onOpen={() => onOpenTask(task.project_id, task.id)}
        />
      ))}
    </div>
  );
}

function TaskDetailLauncher({
  selectedTask,
  token,
  onClose,
  onRefresh,
}: Readonly<{
  selectedTask: { projectId: string; taskId: string } | null;
  token: string;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
}>) {
  if (!selectedTask) return null;
  return (
    <PortalTaskDetailModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      projectId={selectedTask.projectId}
      taskId={selectedTask.taskId}
      token={token}
      onRefresh={onRefresh}
    />
  );
}

function TaskControls({
  projectOptions,
  projectFilter,
  statusFilter,
  viewMode,
  onProjectFilter,
  onStatusFilter,
  onViewMode,
}: Readonly<{
  projectOptions: { value: string; label: string }[];
  projectFilter: string;
  statusFilter: string;
  viewMode: TaskViewMode;
  onProjectFilter: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onViewMode: (value: TaskViewMode) => void;
}>) {
  const statusOptions = [
    { value: ALL_STATUSES, label: 'All statuses' },
    { value: OVERDUE_ONLY, label: 'Overdue' },
    ...TASK_STATUSES.map(status => ({ value: status, label: TASK_STATUS_LABELS[status] })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="portal-task-controls">
      <div className="w-full sm:w-56">
        <SearchableSelect
          id="portal-task-project-filter"
          options={projectOptions}
          value={projectFilter}
          onValueChange={(value) => onProjectFilter(value || ALL_PROJECTS)}
          placeholder="Project"
          searchPlaceholder="Search projects..."
        />
      </div>
      <div className="w-full sm:w-44">
        <SearchableSelect
          id="portal-task-status-filter"
          options={statusOptions}
          value={statusFilter}
          onValueChange={(value) => onStatusFilter(value || ALL_STATUSES)}
          placeholder="Status"
          searchPlaceholder="Search statuses..."
        />
      </div>
      <div className="ml-auto inline-flex rounded-lg border border-border bg-card p-1">
        <Button
          type="button"
          variant={viewMode === 'list' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onViewMode('list')}
          aria-pressed={viewMode === 'list'}
        >
          <List className="h-4 w-4 mr-1" aria-hidden="true" />
          List
        </Button>
        <Button
          type="button"
          variant={viewMode === 'board' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onViewMode('board')}
          aria-pressed={viewMode === 'board'}
        >
          <Columns3 className="h-4 w-4 mr-1" aria-hidden="true" />
          Board
        </Button>
      </div>
    </div>
  );
}

function DocumentList({
  token,
  projects,
  documentsByProject,
  orgDocuments = [],
  onUploaded,
}: Readonly<{
  token: string;
  projects: readonly (Project | ProjectSummary)[];
  documentsByProject: Record<string, ProjectDocument[]>;
  orgDocuments?: readonly ProjectDocument[];
  onUploaded: () => Promise<void> | void;
}>) {
  const [documentActionIds, setDocumentActionIds] = useState<Record<string, boolean>>({});
  const [previewingDoc, setPreviewingDoc] = useState<PreviewState | null>(null);
  const [uploadingProjectId, setUploadingProjectId] = useState('');

  useEffect(() => {
    return () => {
      if (previewingDoc) URL.revokeObjectURL(previewingDoc.url);
    };
  }, [previewingDoc]);

  const openPreview = async (projectId: string, doc: ProjectDocument) => {
    const key = documentActionKey('preview', projectId, doc.id);
    if (documentActionIds[key]) return;
    setPendingKey(setDocumentActionIds, key, true);
    try {
      const res = await portalAPI.previewDocument(projectId, doc.id, token);
      const contentType = (res.headers?.['content-type'] as string | undefined) ?? '';
      const blob = new Blob([res.data], contentType ? { type: contentType } : undefined);
      setPreviewingDoc({ doc, url: URL.createObjectURL(blob) });
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't load that preview."));
    } finally {
      setPendingKey(setDocumentActionIds, key, false);
    }
  };

  const downloadDocument = async (projectId: string, doc: ProjectDocument) => {
    const key = documentActionKey('download', projectId, doc.id);
    if (documentActionIds[key]) return;
    setPendingKey(setDocumentActionIds, key, true);
    try {
      const res = await portalAPI.downloadDocument(projectId, doc.id, token);
      const url = URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(describeApiError(err, 'Download failed'));
    } finally {
      setPendingKey(setDocumentActionIds, key, false);
    }
  };

  const uploadDocument = async (projectId: string, file?: File) => {
    if (!file || uploadingProjectId) return;
    setUploadingProjectId(projectId);
    try {
      await portalAPI.uploadDocument(projectId, token, file);
      toast.success('Document uploaded');
      await onUploaded();
    } catch (err) {
      toast.error(describeApiError(err, 'Upload failed'));
    } finally {
      setUploadingProjectId('');
    }
  };

  const hasProjectDocs = projects.some(project => (documentsByProject[project.id] || []).length > 0);
  const hasDocs = orgDocuments.length > 0 || hasProjectDocs || projects.length > 0;

  return (
    <>
      <div className="space-y-4" data-testid="portal-document-list">
        {orgDocuments.length > 0 && (
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-hub" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Organization documents</h3>
            </div>
            <div className="divide-y divide-border">
              {orgDocuments.map((doc) => (
                <div key={doc.id} className="py-3 flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{doc.filename}</p>
                    <p className="text-xs text-muted-foreground">Shared with your organization</p>
                  </div>
                  <Badge className={neutralBadgeClass('text-[10px]')}>Org</Badge>
                </div>
              ))}
            </div>
          </Card>
        )}

        {projects.map((project) => {
          const docs = documentsByProject[project.id] || [];
          return (
            <Card key={project.id} className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold truncate">{project.title}</h3>
                  <p className="text-xs text-muted-foreground">{docs.length} shared document{docs.length === 1 ? '' : 's'}</p>
                </div>
                <label className={cn('inline-flex', uploadingProjectId === project.id && 'opacity-60')}>
                  <input
                    type="file"
                    className="hidden"
                    disabled={!!uploadingProjectId}
                    onChange={(event) => {
                      const input = event.currentTarget;
                      runPortalAsync(
                        uploadDocument(project.id, input.files?.[0]).finally(() => {
                          input.value = '';
                        }),
                        'upload portal document',
                      );
                    }}
                  />
                  <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm font-medium hover:bg-muted cursor-pointer">
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    {uploadingProjectId === project.id ? 'Uploading...' : 'Upload'}
                  </span>
                </label>
              </div>

              {docs.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No shared documents</p>
              ) : (
                <div className="divide-y divide-border">
                  {docs.map((doc) => {
                    const previewKey = documentActionKey('preview', project.id, doc.id);
                    const downloadKey = documentActionKey('download', project.id, doc.id);
                    return (
                      <div key={doc.id} className="py-3 flex items-center gap-3">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{doc.filename}</p>
                          <p className="text-xs text-muted-foreground">Version {doc.version} - {formatCalendarDate(doc.uploaded_at)}</p>
                        </div>
                        {canPreview(doc.file_type) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              runPortalAsync(openPreview(project.id, doc), 'preview portal document');
                            }}
                            disabled={!!documentActionIds[previewKey]}
                            aria-label={`Preview ${doc.filename}`}
                          >
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            runPortalAsync(downloadDocument(project.id, doc), 'download portal document');
                          }}
                          disabled={!!documentActionIds[downloadKey]}
                          aria-label={`Download ${doc.filename}`}
                        >
                          <Download className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}

        {!hasDocs && (
          <EmptyState
            title="No shared documents"
            description="Documents shared by the HubSpoke team or uploaded by your organization will appear here."
            icon={<FileText className="w-10 h-10" aria-hidden="true" />}
          />
        )}
      </div>

      <AttachmentPreviewDialog
        open={!!previewingDoc}
        onOpenChange={(open) => {
          if (!open && previewingDoc) URL.revokeObjectURL(previewingDoc.url);
          if (!open) setPreviewingDoc(null);
        }}
        url={previewingDoc?.url || ''}
        kind={previewingDoc ? previewKind(previewingDoc.doc.file_type) ?? 'pdf' : 'pdf'}
        filename={previewingDoc?.doc.filename || ''}
      />
    </>
  );
}

function MessageThread({
  token,
  project,
  messages,
  members,
  onRefresh,
}: Readonly<{
  token: string;
  project: Project | ProjectSummary;
  messages: readonly Message[];
  members: readonly ProjectMember[];
  onRefresh: () => Promise<void> | void;
}>) {
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [sending, setSending] = useState(false);
  const [lastDeliverySummary, setLastDeliverySummary] = useState<NotificationSummary | null>(null);

  const handleSendMessage = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const res = await portalAPI.sendMessage(project.id, token, {
        channel: project.title || 'general',
        body: trimmed,
        mentions,
      });
      const notificationSummary = res.data?.notification_summary as NotificationSummary | undefined;
      const fallbackSummary = buildDeliverySummaryFromMessageDoc(res.data, mentions.length);
      const resolvedSummary = notificationSummary || fallbackSummary;
      setLastDeliverySummary(resolvedSummary);
      toast.success(messageDeliveryText(resolvedSummary, mentions.length));
      setBody('');
      setMentions([]);
      await onRefresh();
    } catch (err) {
      setLastDeliverySummary(null);
      toast.error(describeApiError(err, 'Failed to send message'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="p-4 space-y-4" data-testid="portal-message-thread">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{project.title}</h3>
          <p className="text-xs text-muted-foreground">Project conversation</p>
        </div>
        <Badge className={neutralBadgeClass('text-[10px]')}>{messages.length} messages</Badge>
      </div>

      <div className="space-y-3 max-h-[24rem] overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No messages yet</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'rounded-lg border p-3',
                message.sender_type === 'partner' ? 'bg-spoke-soft/30 border-spoke/20' : 'bg-muted/40',
              )}
            >
              <div className="mb-1 flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground">{message.sender_name}</span>
                <Badge
                  className={cn(
                    'text-[10px]',
                    message.sender_type === 'partner'
                      ? 'bg-ownership-partner-soft text-ownership-partner-strong'
                      : 'bg-ownership-internal-soft text-ownership-internal-strong',
                  )}
                >
                  {message.sender_type === 'partner' ? 'Partner' : 'HubSpoke'}
                </Badge>
                <span className="text-[11px] text-muted-foreground">{formatCalendarDate(message.created_at)}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {renderMentionBody(message.body, message.mentions)}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="rounded-lg border border-input bg-background px-3 py-2">
        <label htmlFor={`portal-message-${project.id}`} className="sr-only">Message</label>
        <MentionTextarea
          id={`portal-message-${project.id}`}
          value={body}
          mentions={mentions}
          members={members}
          onChange={(nextBody, nextMentions) => {
            setBody(nextBody);
            setMentions(nextMentions);
          }}
          onSubmit={handleSendMessage}
          placeholder="Type a message. Use @ to mention someone."
          rows={2}
          disabled={sending}
          aria-label="Message"
          textareaClassName="min-h-[4rem]"
        />
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {lastDeliverySummary ? (
          <div className="text-xs text-muted-foreground" data-testid="portal-delivery-summary">
            <p className="font-medium text-foreground">Last delivery</p>
            <p>
              Mentions resolved/notified: {lastDeliverySummary.mentions_resolved ?? 0}
              {' / '}
              {lastDeliverySummary.mention_recipients_notified ?? 0}
            </p>
            <p>Message recipients notified: {lastDeliverySummary.message_recipients_notified ?? 0}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Messages notify eligible project members.</p>
        )}
        <Button
          type="button"
          onClick={() => {
            runPortalAsync(handleSendMessage(), 'send portal message');
          }}
          disabled={sending || !body.trim()}
          className="bg-hub hover:bg-hub-strong text-white"
          aria-label="Send message"
        >
          <Send className="h-4 w-4 mr-2" aria-hidden="true" />
          {sending ? 'Sending...' : 'Send message'}
        </Button>
      </div>
    </Card>
  );
}

function HomePage({
  workspace,
  token,
}: Readonly<{
  workspace: PortalWorkspace;
  token: string;
}>) {
  const navigate = useNavigate();
  const projectsById = useMemo(() => Object.fromEntries(workspace.projects.map(project => [project.id, project])), [workspace.projects]);
  return (
    <PageShell
      testId="portal-home-page"
      title="Partner Home"
      subtitle="Your project workspace, active classes, shared resources, and conversation in one place."
      actions={
        <Button
          type="button"
          className="bg-hub hover:bg-hub-strong text-white"
          onClick={() => navigate(portalPath(token, 'projects'))}
        >
          <Briefcase className="h-4 w-4 mr-2" aria-hidden="true" />
          Open Projects
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active Projects"
          value={workspace.summary.active_projects}
          icon={<Briefcase className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label="Open Tasks"
          value={workspace.summary.open_tasks}
          tone={workspace.summary.overdue_tasks > 0 ? 'warn' : 'spoke'}
          icon={<CheckSquare className="h-5 w-5" aria-hidden="true" />}
          detail={workspace.summary.overdue_tasks > 0 ? `${workspace.summary.overdue_tasks} overdue` : 'On track'}
        />
        <MetricCard
          label="Upcoming Classes"
          value={workspace.summary.upcoming_classes}
          icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label="Classes Hosted"
          value={workspace.summary.classes_hosted}
          tone="spoke"
          icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-3" aria-labelledby="portal-home-projects">
          <div className="flex items-center justify-between gap-3">
            <h2 id="portal-home-projects" className="text-lg font-semibold text-foreground">Active projects</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate(portalPath(token, 'projects'))}>
              View all
            </Button>
          </div>
          {workspace.projects.length === 0 ? (
            <EmptyState
              title="No active projects"
              description="When HubSpoke shares projects with your organization, they will appear here."
              icon={<Briefcase className="w-10 h-10" aria-hidden="true" />}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {workspace.projects.slice(0, 6).map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => navigate(portalPath(token, 'projects', project.id))}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section aria-labelledby="portal-home-attention">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="portal-home-attention" className="text-lg font-semibold text-foreground">Needs attention</h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate(portalPath(token, 'tasks'))}>
                Tasks
              </Button>
            </div>
            <TaskList
              tasks={workspace.needs_attention}
              projectsById={projectsById}
              pendingTaskIds={{}}
              onToggleTask={() => undefined}
              onOpenTask={(projectId, taskId) => navigate(`${portalPath(token, 'tasks')}?project=${projectId}&task=${taskId}`)}
            />
          </section>
        </aside>
      </div>

      <section className="space-y-3" aria-labelledby="portal-home-activity">
        <h2 id="portal-home-activity" className="text-lg font-semibold text-foreground">Recent portal activity</h2>
        <ActivityList events={workspace.recent_activity} />
      </section>
    </PageShell>
  );
}

function ProjectsPage({
  workspace,
  token,
}: Readonly<{
  workspace: PortalWorkspace;
  token: string;
}>) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspace.projects;
    return workspace.projects.filter(project => [
      project.title,
      project.community,
      project.venue_name,
      PHASE_LABELS[project.phase],
    ].some(value => (value || '').toLowerCase().includes(q)));
  }, [workspace.projects, query]);

  return (
    <PageShell
      testId="portal-projects-page"
      title="Projects"
      subtitle="Open a project hub to review tasks, documents, messages, and shared activity."
      actions={
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="portal-project-search" className="sr-only">Search projects</label>
          <Input
            id="portal-project-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects..."
            className="pl-8"
          />
        </div>
      }
    >
      {visibleProjects.length === 0 ? (
        <EmptyState
          title="No projects match"
          description="Try a different project, community, venue, or phase search."
          icon={<Briefcase className="w-10 h-10" aria-hidden="true" />}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="portal-project-grid">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => navigate(portalPath(token, 'projects', project.id))}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function TasksPage({
  workspace,
  token,
  refreshWorkspace,
}: Readonly<{
  workspace: PortalWorkspace;
  token: string;
  refreshWorkspace: () => Promise<void> | void;
}>) {
  const { allTasks, error, isLoading, mutateTasks } = usePortalTasks(token, workspace.projects);
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const [viewMode, setViewMode] = useState<TaskViewMode>('list');
  const [pendingTaskIds, setPendingTaskIds] = useState<Record<string, boolean>>({});
  const [selectedTask, setSelectedTask] = useState<{ projectId: string; taskId: string } | null>(null);

  const projectsById = useMemo(() => Object.fromEntries(workspace.projects.map(project => [project.id, project])), [workspace.projects]);
  const selectedProjects = useMemo(() => (
    projectFilter === ALL_PROJECTS
      ? workspace.projects
      : workspace.projects.filter(project => project.id === projectFilter)
  ), [projectFilter, workspace.projects]);
  const filteredTasks = useMemo(
    () => buildFilteredTasks(selectedProjects, allTasks, statusFilter),
    [allTasks, selectedProjects, statusFilter],
  );
  const filteredTaskMap = useMemo(
    () => buildFilteredTaskMap(selectedProjects, allTasks, statusFilter),
    [allTasks, selectedProjects, statusFilter],
  );

  const refreshTasks = async () => {
    await mutateTasks();
    await refreshWorkspace();
  };

  const handleToggleTask = async (projectId: string, task: Task) => {
    const key = taskActionKey(projectId, task.id);
    if (pendingTaskIds[key] || !hasPartnerWriteAccess(task)) return;
    setPendingKey(setPendingTaskIds, key, true);
    try {
      const completed = !task.completed;
      await portalAPI.updateTask(projectId, task.id, token, {
        completed,
        status: completed ? 'completed' : 'to_do',
      });
      await refreshTasks();
      toast.success('Task updated');
    } catch (err) {
      toast.error(describeApiError(err, 'Failed to update task'));
    } finally {
      setPendingKey(setPendingTaskIds, key, false);
    }
  };

  const handleMoveTask = async (projectId: string, task: Task, status: TaskStatus) => {
    const key = taskActionKey(projectId, task.id);
    if (pendingTaskIds[key]) return { ok: false, message: 'That task update is still saving.' };
    setPendingKey(setPendingTaskIds, key, true);
    try {
      await portalAPI.updateTask(projectId, task.id, token, {
        status,
        completed: status === 'completed',
      });
      await refreshTasks();
      return { ok: true };
    } catch (err) {
      const message = describeApiError(err, 'You do not have permission to move that task to this status.');
      toast.error(message);
      return { ok: false, message };
    } finally {
      setPendingKey(setPendingTaskIds, key, false);
    }
  };

  const projectOptions = [
    { value: ALL_PROJECTS, label: 'All projects' },
    ...workspace.projects.map(project => ({ value: project.id, label: project.title })),
  ];

  if (workspace.projects.length === 0) {
    return (
      <PageShell testId="portal-tasks-page" title="Tasks" subtitle="Tasks needing partner action across your shared projects.">
        <EmptyState
          title="No active projects"
          description="Tasks will appear when a project is shared with your organization."
          icon={<CheckSquare className="w-10 h-10" aria-hidden="true" />}
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      testId="portal-tasks-page"
      title="Tasks"
      subtitle="Your task inbox, with filters and a board view for project work."
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            runPortalAsync(refreshTasks(), 'refresh portal tasks');
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
          Refresh
        </Button>
      }
      status={isLoading ? { kind: 'loading', variant: 'rows' } : { kind: 'ready' }}
    >
      <TaskControls
        projectOptions={projectOptions}
        projectFilter={projectFilter}
        statusFilter={statusFilter}
        viewMode={viewMode}
        onProjectFilter={setProjectFilter}
        onStatusFilter={setStatusFilter}
        onViewMode={setViewMode}
      />

      {error ? (
        <Card className="p-5 border-danger/30 bg-danger-soft" role="alert">
          <p className="text-sm font-semibold text-foreground">Tasks could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">{describeApiError(error, "We couldn't load your tasks.")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              runPortalAsync(mutateTasks(), 'retry portal tasks');
            }}
          >
            Retry tasks
          </Button>
        </Card>
      ) : viewMode === 'board' ? (
        filteredTasks.length === 0 ? (
          <EmptyState title="No tasks assigned to you" description="Try changing the project or status filters." />
        ) : (
          <PortalTaskBoard
            projects={selectedProjects}
            allTasks={filteredTaskMap}
            onOpenTask={(projectId, taskId) => setSelectedTask({ projectId, taskId })}
            onMoveTask={handleMoveTask}
          />
        )
      ) : (
        <TaskList
          tasks={filteredTasks}
          projectsById={projectsById}
          pendingTaskIds={pendingTaskIds}
          onToggleTask={handleToggleTask}
          onOpenTask={(projectId, taskId) => setSelectedTask({ projectId, taskId })}
        />
      )}

      <TaskDetailLauncher
        selectedTask={selectedTask}
        token={token}
        onClose={() => setSelectedTask(null)}
        onRefresh={refreshTasks}
      />
    </PageShell>
  );
}

function DocumentsPage({
  workspace,
  token,
  refreshWorkspace,
}: Readonly<{
  workspace: PortalWorkspace;
  token: string;
  refreshWorkspace: () => Promise<void> | void;
}>) {
  const { documents, error, isLoading, mutateDocuments } = usePortalDocuments(token, workspace.projects);
  const refreshDocuments = async () => {
    await mutateDocuments();
    await refreshWorkspace();
  };

  return (
    <PageShell
      testId="portal-documents-page"
      title="Documents"
      subtitle="Shared organization files and project documents, grouped by project."
      status={isLoading ? { kind: 'loading', variant: 'rows' } : { kind: 'ready' }}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            runPortalAsync(refreshDocuments(), 'refresh portal documents');
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
          Refresh
        </Button>
      }
    >
      {error ? (
        <Card className="p-5 border-danger/30 bg-danger-soft" role="alert">
          <p className="text-sm font-semibold text-foreground">Documents could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">{describeApiError(error, "We couldn't load shared documents.")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              runPortalAsync(mutateDocuments(), 'retry portal documents');
            }}
          >
            Retry documents
          </Button>
        </Card>
      ) : (
        <DocumentList
          token={token}
          projects={workspace.projects}
          documentsByProject={documents}
          orgDocuments={workspace.org_documents}
          onUploaded={refreshDocuments}
        />
      )}
    </PageShell>
  );
}

function MessagesPage({
  workspace,
  token,
}: Readonly<{
  workspace: PortalWorkspace;
  token: string;
}>) {
  const [activeProjectId, setActiveProjectId] = useState(() => workspace.projects[0]?.id || '');
  useEffect(() => {
    if (!activeProjectId && workspace.projects[0]?.id) setActiveProjectId(workspace.projects[0].id);
  }, [activeProjectId, workspace.projects]);

  const { projectWorkspace, error, isLoading, mutateProjectWorkspace } = usePortalProjectWorkspace(token, activeProjectId);
  const activeProject = workspace.projects.find(project => project.id === activeProjectId);
  const projectOptions = workspace.projects.map(project => ({ value: project.id, label: project.title }));

  return (
    <PageShell
      testId="portal-messages-page"
      title="Messages"
      subtitle="Project-specific partner conversations with delivery confirmation."
      status={isLoading ? { kind: 'loading', variant: 'rows' } : { kind: 'ready' }}
      actions={workspace.projects.length > 0 ? (
        <div className="w-full sm:w-72">
          <SearchableSelect
            id="portal-message-project"
            options={projectOptions}
            value={activeProjectId}
            onValueChange={(value) => setActiveProjectId(value || workspace.projects[0]?.id || '')}
            placeholder="Choose a project"
            searchPlaceholder="Search projects..."
          />
        </div>
      ) : undefined}
    >
      {workspace.projects.length === 0 ? (
        <EmptyState
          title="No project threads"
          description="Messages become available when a project is shared with your organization."
          icon={<MessageSquare className="w-10 h-10" aria-hidden="true" />}
        />
      ) : error || !activeProject ? (
        <Card className="p-5 border-danger/30 bg-danger-soft" role="alert">
          <p className="text-sm font-semibold text-foreground">Messages could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">{describeApiError(error, "We couldn't load messages for this project.")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              runPortalAsync(mutateProjectWorkspace(), 'retry portal messages');
            }}
          >
            Retry messages
          </Button>
        </Card>
      ) : (
        <MessageThread
          token={token}
          project={activeProject}
          messages={projectWorkspace?.messages || []}
          members={projectWorkspace?.members || []}
          onRefresh={async () => { await mutateProjectWorkspace(); }}
        />
      )}
    </PageShell>
  );
}

function SettingsPage({ token }: Readonly<{ token: string }>) {
  return (
    <PageShell
      testId="portal-settings-page"
      title="Settings"
      subtitle="Manage portal notification preferences for your partner contact."
    >
      <Card className="p-4">
        <NotificationPreferences mode="portal" portalToken={token} />
      </Card>
    </PageShell>
  );
}

function ProjectHubPage({
  token,
  projectId,
  refreshWorkspace,
}: Readonly<{
  token: string;
  projectId: string;
  refreshWorkspace: () => Promise<void> | void;
}>) {
  const { projectWorkspace, error, isLoading, mutateProjectWorkspace } = usePortalProjectWorkspace(token, projectId);
  const [pendingTaskIds, setPendingTaskIds] = useState<Record<string, boolean>>({});
  const [selectedTask, setSelectedTask] = useState<{ projectId: string; taskId: string } | null>(null);

  const refreshProject = async () => {
    await mutateProjectWorkspace();
    await refreshWorkspace();
  };

  const handleToggleTask = async (projectTaskId: string, task: Task) => {
    const key = taskActionKey(projectTaskId, task.id);
    if (pendingTaskIds[key] || !hasPartnerWriteAccess(task)) return;
    setPendingKey(setPendingTaskIds, key, true);
    try {
      const completed = !task.completed;
      await portalAPI.updateTask(projectTaskId, task.id, token, {
        completed,
        status: completed ? 'completed' : 'to_do',
      });
      await refreshProject();
      toast.success('Task updated');
    } catch (err) {
      toast.error(describeApiError(err, 'Failed to update task'));
    } finally {
      setPendingKey(setPendingTaskIds, key, false);
    }
  };

  if (isLoading) {
    return (
      <PageShell
        testId="portal-project-hub-page"
        title="Project Hub"
        subtitle="Loading project workspace..."
        status={{ kind: 'loading', variant: 'cards' }}
      />
    );
  }

  if (error || !projectWorkspace) {
    return (
      <PageShell
        testId="portal-project-hub-page"
        title="Project Hub"
        subtitle="This project could not be loaded."
        status={{
          kind: 'error',
          error: { message: describeApiError(error, 'Project workspace could not be loaded.') },
          onRetry: () => {
            runPortalAsync(mutateProjectWorkspace(), 'retry portal project workspace');
          },
        }}
      />
    );
  }

  const { project, tasks, documents, messages, members, recent_activity: recentActivity } = projectWorkspace;
  const progress = projectProgress(project, tasks);
  const overdue = tasks.filter(task => !task.completed && isPastCalendarDate(task.due_date)).length;
  const projectsById = { [project.id]: project };

  return (
    <PageShell
      testId="portal-project-hub-page"
      breadcrumbs={[{ label: 'Portal' }, { label: 'Projects', path: portalPath(token, 'projects') }, { label: project.title }]}
      title={project.title}
      subtitle={`${formatCalendarDate(project.event_date)} - ${project.venue_name} - ${project.community}`}
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={phaseBadgeClass(project.phase)}>{PHASE_LABELS[project.phase]}</Badge>
          {overdue > 0 && <Badge className="bg-warn-soft text-warn-strong border-0">{overdue} overdue</Badge>}
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Progress"
          value={progress.percent}
          tone="spoke"
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          detail={`${progress.completed}/${progress.total} tasks complete`}
        />
        <MetricCard
          label="Open Tasks"
          value={tasks.filter(task => !task.completed).length}
          tone={overdue > 0 ? 'warn' : 'hub'}
          icon={<CheckSquare className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label="Documents"
          value={documents.length}
          icon={<FileText className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label="Messages"
          value={messages.length}
          icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />}
        />
      </div>

      <Card className="p-4">
        <div className="mb-2 flex justify-between text-xs text-muted-foreground">
          <span>Project progress</span>
          <span>{progress.percent}%</span>
        </div>
        <ProgressBar percent={progress.percent} label={`${project.title} project progress`} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-3" aria-labelledby="portal-project-tasks">
          <div className="flex items-center justify-between gap-3">
            <h2 id="portal-project-tasks" className="text-lg font-semibold text-foreground">Tasks</h2>
            <Badge className={neutralBadgeClass('text-[10px]')}>{tasks.length} total</Badge>
          </div>
          <TaskList
            tasks={tasks}
            projectsById={projectsById}
            pendingTaskIds={pendingTaskIds}
            onToggleTask={handleToggleTask}
            onOpenTask={(nextProjectId, taskId) => setSelectedTask({ projectId: nextProjectId, taskId })}
          />
        </section>
        <section className="space-y-3" aria-labelledby="portal-project-activity">
          <h2 id="portal-project-activity" className="text-lg font-semibold text-foreground">Activity</h2>
          <ActivityList events={recentActivity} emptyTitle="No project activity yet" />
        </section>
      </div>

      <section className="space-y-3" aria-labelledby="portal-project-documents">
        <h2 id="portal-project-documents" className="text-lg font-semibold text-foreground">Documents</h2>
        <DocumentList
          token={token}
          projects={[project]}
          documentsByProject={{ [project.id]: documents }}
          onUploaded={refreshProject}
        />
      </section>

      <section className="space-y-3" aria-labelledby="portal-project-messages">
        <h2 id="portal-project-messages" className="text-lg font-semibold text-foreground">Messages</h2>
        <MessageThread
          token={token}
          project={project}
          messages={messages}
          members={members}
          onRefresh={refreshProject}
        />
      </section>

      <TaskDetailLauncher
        selectedTask={selectedTask}
        token={token}
        onClose={() => setSelectedTask(null)}
        onRefresh={refreshProject}
      />
    </PageShell>
  );
}

export default function PortalDashboard() {
  const { token: urlToken, projectId } = useParams<{ token?: string; projectId?: string }>();
  const token = urlToken || '';
  const location = useLocation();
  const section = routeSection(location.pathname, projectId);
  const { session, error: sessionError, isLoading: sessionLoading } = usePortalSession(token);
  const { workspace, error: workspaceError, isLoading: workspaceLoading, mutateWorkspace } = usePortalWorkspace(token);

  useEffect(() => {
    if (!token || sessionError) {
      sessionStorage.removeItem(LEGACY_PORTAL_TOKEN_KEY);
    }
  }, [sessionError, token]);

  if (!token || sessionError) {
    return <PortalRecovery />;
  }

  if ((sessionLoading && !session) || (workspaceLoading && !workspace && !session)) {
    return <PortalLoading />;
  }

  const org = workspace?.org ?? session?.org;
  const contact = workspace?.contact ?? session?.contact;

  if (!org || !contact) {
    return <PortalLoading />;
  }

  const refreshWorkspace = async () => {
    await mutateWorkspace();
  };

  return (
    <PortalShell
      token={token}
      org={org}
      contact={contact}
      activeSection={section === 'project' ? 'projects' : section}
    >
      {workspaceError && !workspace ? (
        <PageShell
          testId="portal-workspace-error"
          title="Partner Home"
          subtitle="Your partner workspace could not be loaded."
          status={{
            kind: 'error',
            error: { message: describeApiError(workspaceError, "We couldn't load your portal workspace.") },
            onRetry: () => {
              runPortalAsync(mutateWorkspace(), 'retry portal workspace');
            },
          }}
        />
      ) : !workspace ? (
        <PageShell
          testId="portal-workspace-loading"
          title="Partner Home"
          subtitle="Loading your partner workspace..."
          status={{ kind: 'loading', variant: 'cards' }}
        />
      ) : (
        <>
          {section === 'home' && <HomePage workspace={workspace} token={token} />}
          {section === 'projects' && <ProjectsPage workspace={workspace} token={token} />}
          {section === 'project' && projectId && (
            <ProjectHubPage
              token={token}
              projectId={projectId}
              refreshWorkspace={refreshWorkspace}
            />
          )}
          {section === 'tasks' && (
            <TasksPage
              workspace={workspace}
              token={token}
              refreshWorkspace={refreshWorkspace}
            />
          )}
          {section === 'documents' && (
            <DocumentsPage
              workspace={workspace}
              token={token}
              refreshWorkspace={refreshWorkspace}
            />
          )}
          {section === 'messages' && <MessagesPage workspace={workspace} token={token} />}
          {section === 'settings' && <SettingsPage token={token} />}
        </>
      )}
    </PortalShell>
  );
}

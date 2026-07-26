/**
 * Presentational + small stateful components for the partner portal.
 *
 * Split out of PortalDashboard.tsx, which held these alongside seven page
 * components in a single 1,850-line module. They were already written as
 * separate named functions — this only moves them somewhere a reader can find
 * them, and makes it possible to memoise the ones rendered in a list.
 */
import AttachmentPreviewDialog from '../coordination/AttachmentPreviewDialog';
import PortalTaskDetailModal from './PortalTaskDetailModal';
import {
  memo,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CheckSquare,
  Columns3,
  Download,
  Eye,
  FileText,
  Inbox,
  List,
  Mail,
  MessageSquare,
  Paperclip,
  Search,
  Send,
  Upload,
} from 'lucide-react';
import {
  toast,
} from 'sonner';
import {
  Badge,
} from '../ui/badge';
import {
  Button,
} from '../ui/button';
import {
  Card,
} from '../ui/card';
import {
  Input,
} from '../ui/input';
import {
  SearchableSelect,
} from '../ui/searchable-select';
import MentionTextarea, {
  renderMentionBody,
  tokenizeBody,
} from '../coordination/MentionTextarea';
import {
  canPreview,
  previewKind,
} from '../../lib/attachment-preview';
import {
  portalAPI,
} from '../../lib/coordination-api';
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
  type Project,
  type ProjectDocument,
  type ProjectMember,
  type Task,
} from '../../lib/coordination-types';
import {
  formatCalendarDate,
  isPastCalendarDate,
} from '../../lib/date-format';
import {
  describeApiError,
} from '../../lib/error-messages';
import {
  cn,
} from '../../lib/utils';
import {
  runPortalAsync,
} from './async';
import {
  ALL_PROJECTS,
  ALL_STATUSES,
  INVALID_PORTAL_LINK_MESSAGE,
  OVERDUE_ONLY,
  REQUEST_LINK_SUCCESS_MESSAGE,
  activityLabel,
  buildDeliverySummaryFromMessageDoc,
  documentActionKey,
  hasPartnerWriteAccess,
  messageDeliveryText,
  neutralBadgeClass,
  phaseBadgeClass,
  projectProgress,
  setPendingKey,
  statusForTask,
  taskActionKey,
  type NotificationSummary,
  type PreviewState,
  type ProjectSummary,
  type TaskViewMode,
} from './shared';


// Memoised: rendered once per project card in a list, and its props are two
// primitives — so a parent re-render that changes nothing here costs nothing.
// This was not worth doing while everything lived in one module with no stable
// prop boundaries; the split is what makes it meaningful.
export const ProgressBar = memo(function ProgressBar(
  { percent, label = 'Progress' }: Readonly<{ percent: number; label?: string }>,
) {
  const value = Math.max(0, Math.min(percent, 100));
  return (
    <progress
      className="h-2 w-full overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-spoke [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-spoke"
      value={value}
      max={100}
      aria-label={label}
    />
  );
});


export function PortalLoading() {
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

export function PortalRecovery() {
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

export const MetricCard = memo(function MetricCard({
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
});

export const EmptyState = memo(function EmptyState({
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
});

export function ProjectCard({
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

export function ActivityList({
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

export function TaskCard({
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

export function TaskList({
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

export function TaskDetailLauncher({
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

export function TaskControls({
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

export function DocumentList({
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

export function MessageThread({
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
        body: tokenizeBody(trimmed, mentions),
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
          rows={4}
          disabled={sending}
          aria-label="Message"
          textareaClassName="min-h-[6rem]"
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

import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  CalendarDays, CheckSquare, GraduationCap, AlertTriangle,
  FileText, Send, Download, Eye, Mail, Columns3, List,
} from 'lucide-react';
import { portalAPI } from '../../lib/coordination-api';
import {
  PROJECT_PHASES, PHASE_LABELS, PHASE_COLORS, PHASE_DOT_COLORS, OWNER_COLORS, OWNER_LABELS,
  TASK_STATUSES, TASK_STATUS_LABELS, TASK_STATUS_COLORS,
} from '../../lib/coordination-types';
import type {
  PartnerOrg, PartnerContact, Project, Task, ProjectDocument, Message,
  Mention, ProjectMember, TaskStatus,
} from '../../lib/coordination-types';
import { canPreview, previewKind } from '../../lib/attachment-preview';
import { describeApiError } from '../../lib/error-messages';
import AttachmentPreviewDialog from '../coordination/AttachmentPreviewDialog';
import MentionTextarea, { renderMentionBody } from '../coordination/MentionTextarea';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import PortalLayout from './PortalLayout';
import NotificationPreferences from '../NotificationPreferences';

const PORTAL_TOKEN_KEY = 'portal_session_token';
const INVALID_PORTAL_LINK_MESSAGE = 'This portal link is invalid or expired.';
const REQUEST_LINK_SUCCESS_MESSAGE = 'If that email is registered, a new link has been sent.';
type TaskViewMode = 'list' | 'kanban';

interface NotificationSummary {
  mentions_requested?: number;
  mentions_resolved?: number;
  message_recipients_notified?: number;
  mention_recipients_notified?: number;
}


function taskStatus(task: Task): TaskStatus {
  return task.completed ? 'completed' : (task.status || 'to_do');
}

function pluralizeRecipients(count: number): string {
  return `${count} recipient${count === 1 ? '' : 's'}`;
}


function buildDeliverySummaryFromMessageDoc(messageDoc: unknown, mentionsSent: number): NotificationSummary {
  const doc = (messageDoc && typeof messageDoc == 'object') ? (messageDoc as { mentions?: unknown[] }) : null;
  const resolvedMentions = Array.isArray(doc?.mentions) ? doc.mentions.length : 0;
  return {
    mentions_requested: mentionsSent,
    mentions_resolved: resolvedMentions,
    mention_recipients_notified: resolvedMentions,
    // Backend currently returns message doc without delivery fanout counts.
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

export default function PortalDashboard() {
  const { token: urlToken } = useParams<{ token: string }>();
  // Prefer URL token, fall back to sessionStorage for in-session persistence
  const token = urlToken || sessionStorage.getItem(PORTAL_TOKEN_KEY) || '';
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [requestingLink, setRequestingLink] = useState(false);
  const [requestLinkMessage, setRequestLinkMessage] = useState('');
  const [requestLinkError, setRequestLinkError] = useState('');

  const [org, setOrg] = useState<PartnerOrg | null>(null);
  const [contact, setContact] = useState<PartnerContact | null>(null);
  const [dashboardData, setDashboardData] = useState<{
    upcoming_classes: number;
    open_tasks: number;
    overdue_tasks: number;
    classes_hosted: number;
    projects: Project[];
  } | null>(null);

  // Tab-specific state
  const [allTasks, setAllTasks] = useState<Record<string, Task[]>>({});
  const [documents, setDocuments] = useState<Record<string, ProjectDocument[]>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgBody, setMsgBody] = useState('');
  const [msgMentions, setMsgMentions] = useState<Mention[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [lastDeliverySummary, setLastDeliverySummary] = useState<NotificationSummary | null>(null);
  const [activeProject, setActiveProject] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<'all' | string>('all');
  const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>('list');
  const [selectedTask, setSelectedTask] = useState<{ projectId: string; taskId: string } | null>(null);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<Task | null>(null);
  const taskDetailRequestKeyRef = useRef<string | null>(null);
  const [previewingDoc, setPreviewingDoc] = useState<
    { doc: ProjectDocument; url: string } | null
  >(null);

  // Portal auth is bearer-token only, so an <iframe> can't load the server
  // URL directly — fetch the bytes as a blob and hand the dialog an object
  // URL instead. We revoke on close (or unmount) to free the blob.
  async function openDocPreview(projectId: string, doc: ProjectDocument) {
    try {
      const res = await portalAPI.previewDocument(projectId, doc.id, token);
      const contentType = (res.headers?.['content-type'] as string | undefined) ?? '';
      const blob = new Blob([res.data], contentType ? { type: contentType } : undefined);
      const url = URL.createObjectURL(blob);
      setPreviewingDoc({ doc, url });
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't load that preview."));
    }
  }

  function closeDocPreview() {
    if (previewingDoc) URL.revokeObjectURL(previewingDoc.url);
    setPreviewingDoc(null);
  }

  useEffect(() => {
    return () => {
      if (previewingDoc) URL.revokeObjectURL(previewingDoc.url);
    };
  }, [previewingDoc]);

  useEffect(() => {
    if (!token) { setError(INVALID_PORTAL_LINK_MESSAGE); setLoading(false); return; }
    (async () => {
      try {
        const verifyRes = await portalAPI.verify(token);
        setOrg(verifyRes.data.org);
        setContact(verifyRes.data.contact);
        // Persist token in session so portal survives tab navigation
        sessionStorage.setItem(PORTAL_TOKEN_KEY, token);

        const dashRes = await portalAPI.dashboard(token);
        setDashboardData(dashRes.data);
      } catch {
        sessionStorage.removeItem(PORTAL_TOKEN_KEY);
        setError(INVALID_PORTAL_LINK_MESSAGE);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const loadTasks = async () => {
    if (!token || !dashboardData?.projects) return;
    // Single bulk request instead of N parallel /tasks calls. Backend
    // groups tasks by project_id and authz-clamps to projects this token
    // actually owns.
    const projectIds = dashboardData.projects.map(p => p.id);
    try {
      const res = await portalAPI.bulkProjectTasks(projectIds, token);
      const items = (res.data?.items || {}) as Record<string, unknown[]>;
      // Make sure every project has an entry, even if it has no tasks.
      const filled: Record<string, unknown[]> = {};
      projectIds.forEach(id => { filled[id] = items[id] || []; });
      setAllTasks(filled);
    } catch {
      const empty: Record<string, unknown[]> = {};
      projectIds.forEach(id => { empty[id] = []; });
      setAllTasks(empty);
    }
  };

  const loadDocuments = async () => {
    if (!token || !dashboardData?.projects) return;
    const results = await Promise.all(
      dashboardData.projects.map(async (p) => {
        try {
          const res = await portalAPI.projectDocuments(p.id, token);
          return [p.id, res.data.items || []] as const;
        } catch {
          return [p.id, []] as const;
        }
      })
    );
    setDocuments(Object.fromEntries(results));
  };

  const loadMessages = async (projectId: string) => {
    if (!token) return;
    try {
      const res = await portalAPI.projectMessages(projectId, token);
      setMessages(res.data.items || []);
      setActiveProject(projectId);
      // Refresh the mentionable roster alongside messages so switching
      // project tabs always updates the @ popover to the correct set.
      try {
        const mem = await portalAPI.projectMembers(projectId, token);
        setMembers(mem.data?.items ?? []);
      } catch {
        setMembers([]);
      }
    } catch {
      toast.error('Failed to load messages');
    }
  };

  useEffect(() => {
    if (activeTab === 'tasks') loadTasks();
    if (activeTab === 'documents') loadDocuments();
    if (activeTab === 'messages' && dashboardData?.projects?.[0]) {
      loadMessages(dashboardData.projects[0].id);
    }
  }, [activeTab, dashboardData]);

  const handleToggleTask = async (projectId: string, taskId: string, completed: boolean) => {
    if (!token) return;
    try {
      await portalAPI.updateTask(projectId, taskId, token, { completed: !completed });
      await loadTasks();
      toast.success('Task updated', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await portalAPI.updateTask(projectId, taskId, token, { completed });
              await loadTasks();
              toast.success('Task reverted');
            } catch {
              toast.error('Failed to undo');
            }
          },
        },
        duration: 5000,
      });
    } catch {
      toast.error('Failed to update task');
    }
  };


  const visibleProjects = useMemo(() => {
    if (!dashboardData?.projects) return [];
    return selectedProjectId === 'all'
      ? dashboardData.projects
      : dashboardData.projects.filter((p) => p.id === selectedProjectId);
  }, [dashboardData, selectedProjectId]);

  const openTaskDetail = async (projectId: string, taskId: string) => {
    if (!token) return;
    const requestKey = `${projectId}:${taskId}:${Date.now()}`;
    taskDetailRequestKeyRef.current = requestKey;
    setSelectedTask({ projectId, taskId });
    setSelectedTaskDetail(null);
    try {
      const res = await portalAPI.taskDetail(projectId, taskId, token);
      if (taskDetailRequestKeyRef.current !== requestKey) return;
      setSelectedTaskDetail(res.data as Task);
    } catch {
      if (taskDetailRequestKeyRef.current !== requestKey) return;
      toast.error('Failed to load task details');
    }
  };

  const closeTaskDetail = () => {
    taskDetailRequestKeyRef.current = null;
    setSelectedTask(null);
    setSelectedTaskDetail(null);
  };

  const visibleTaskCount = visibleProjects.reduce((count, project) => count + (allTasks[project.id] || []).length, 0);

  const renderProjectFilter = (selectId: string) => (
    <div className="flex items-center gap-2">
      <label htmlFor={selectId} className="text-sm text-foreground/80">Project</label>
      <select
        id={selectId}
        value={selectedProjectId}
        onChange={(e) => setSelectedProjectId(e.target.value as 'all' | string)}
        className="border border-border rounded-md px-2 py-1 text-sm bg-background"
      >
        <option value="all">All projects</option>
        {dashboardData?.projects.map((project) => (
          <option key={project.id} value={project.id}>{project.title}</option>
        ))}
      </select>
    </div>
  );

  const renderTaskList = () => (
    <div className="space-y-4">
      {visibleProjects.map((project) => {
        const tasks = allTasks[project.id] || [];
        if (tasks.length === 0) return null;
        return (
          <section key={project.id}>
            <h3 className="font-semibold text-foreground mb-2">{project.title}</h3>
            <div className="space-y-2">
              {tasks.map((task) => {
                const isOverdue = !task.completed && task.due_date < new Date().toISOString();
                return (
                  <Card key={task.id} className={cn('p-3 border', task.completed && 'opacity-60')}>
                    <div className="flex items-start gap-2">
                      <button type="button" onClick={() => handleToggleTask(project.id, task.id, task.completed)} className={cn('mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors', task.completed ? 'bg-spoke border-spoke text-white' : 'border-border hover:border-hub')}>
                        {task.completed && <span className="text-xs" aria-hidden="true">&#10003;</span>}
                      </button>
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => openTaskDetail(project.id, task.id)} className={cn('text-sm font-medium text-left hover:underline w-full', task.completed && 'line-through text-muted-foreground')}>{task.title}</button>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          <span className={cn('text-[11px]', isOverdue ? 'text-danger-strong font-semibold' : 'text-muted-foreground')}>{new Date(task.due_date).toLocaleDateString()}</span>
                          <Badge className={cn('text-[10px] px-1.5', OWNER_COLORS[task.owner])}>{OWNER_LABELS[task.owner]}</Badge>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );

  const handleSendMessage = async () => {
    if (!token || !activeProject || !msgBody.trim()) return;
    try {
      const project = dashboardData?.projects.find(p => p.id === activeProject);
      const res = await portalAPI.sendMessage(activeProject, token, {
        channel: project?.title || 'general',
        body: msgBody.trim(),
        mentions: msgMentions,
      });
      const notificationSummary = res.data?.notification_summary as NotificationSummary | undefined;
      const fallbackSummary = buildDeliverySummaryFromMessageDoc(res.data, msgMentions.length);
      const resolvedSummary = notificationSummary || fallbackSummary;
      setLastDeliverySummary(resolvedSummary);
      toast.success(messageDeliveryText(resolvedSummary, msgMentions.length));
      setMsgBody('');
      setMsgMentions([]);
      loadMessages(activeProject);
    } catch {
      setLastDeliverySummary(null);
      toast.error('Failed to send message');
    }
  };

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/50 p-4">
        <output aria-label="Loading portal">
          <span className="block w-10 h-10 border-4 border-hub border-t-transparent rounded-full animate-spin" />
        </output>
      </div>
    );
  }

  if (error || !org || !contact) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/50 p-4">
        <Card className="p-6 sm:p-8 w-full max-w-md" role="alert">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-warn-soft flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-warn-strong" aria-hidden="true" />
            </div>
            <p className="text-xs uppercase text-foreground/60 font-semibold mb-1">
              HubSpoke Partner Portal
            </p>
            <h2 className="text-xl font-semibold mb-2">Request a new portal link</h2>
            <p className="text-sm text-foreground/80">{error || INVALID_PORTAL_LINK_MESSAGE}</p>
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
              <p className="text-sm text-spoke-strong" role="status">
                {requestLinkMessage}
              </p>
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

  return (
    <PortalLayout org={org} contact={contact} activeTab={activeTab} onTabChange={setActiveTab} token={token}>
      {/* Overview Tab */}
      {activeTab === 'overview' && dashboardData && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
            <Card className="p-4 flex items-center gap-3">
              <CalendarDays className="w-8 h-8 text-hub shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-2xl font-bold">{dashboardData.upcoming_classes}</p>
                <p className="text-xs text-foreground/80">Upcoming Classes</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <CheckSquare
                className={cn('w-8 h-8 shrink-0', dashboardData.overdue_tasks > 0 ? 'text-warn-strong' : 'text-spoke-strong')}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-2xl font-bold">
                  {dashboardData.open_tasks}
                  {dashboardData.overdue_tasks > 0 && (
                    <span className="text-xs text-warn-strong ml-1">({dashboardData.overdue_tasks} overdue)</span>
                  )}
                </p>
                <p className="text-xs text-foreground/80">Open Tasks</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3 sm:col-span-2 lg:col-span-1">
              <GraduationCap className="w-8 h-8 text-spoke-strong shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-2xl font-bold">{dashboardData.classes_hosted}</p>
                <p className="text-xs text-foreground/80">Classes Hosted</p>
              </div>
            </Card>
          </div>

          <h2 className="text-lg font-semibold mb-3">Upcoming Classes</h2>
          <div className="space-y-3">
            {dashboardData.projects.map(project => (
              <Card key={project.id} className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', PHASE_DOT_COLORS[project.phase])} aria-hidden="true" />
                      <h3 className="font-semibold text-foreground min-w-0">
                        {project.title}
                      </h3>
                    </div>
                  </div>
                  <Badge className={cn('text-[10px] shrink-0', PHASE_COLORS[project.phase], 'text-white')}>
                    {PHASE_LABELS[project.phase]}
                  </Badge>
                </div>
                <p className="text-sm text-foreground/80">
                  {new Date(project.event_date).toLocaleDateString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {project.venue_name || 'Venue TBD'}
                </p>
              </Card>
            ))}
            {dashboardData.projects.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No upcoming classes</p>
            )}
          </div>
          {lastDeliverySummary && (
            <Card className="mt-3 p-3 bg-muted/40">
              <p className="text-xs text-muted-foreground">Last delivery</p>
              <p className="text-sm text-foreground">
                Message notifications delivered: {lastDeliverySummary.message_recipients_notified ?? 0} recipient(s)
              </p>
              <p className="text-sm text-foreground">
                Mentions resolved/notified: {(lastDeliverySummary.mentions_resolved ?? 0)} / {(lastDeliverySummary.mentions_requested ?? 0)}
              </p>
            </Card>
          )}
        </div>
      )}

      {/* Tasks Tab */}
      {activeTab === 'tasks' && dashboardData && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {renderProjectFilter('portal-task-project-filter')}
            <div className="inline-flex rounded-md border border-border bg-background p-0.5" aria-label="Task view">
              <button type="button" onClick={() => setTaskViewMode('list')} aria-pressed={taskViewMode === 'list'} className={cn('inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors', taskViewMode === 'list' ? 'bg-hub-soft text-hub-strong' : 'text-foreground/80 hover:bg-muted')}><List className="w-4 h-4" aria-hidden="true" />List</button>
              <button type="button" onClick={() => setTaskViewMode('kanban')} aria-pressed={taskViewMode === 'kanban'} className={cn('inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors', taskViewMode === 'kanban' ? 'bg-hub-soft text-hub-strong' : 'text-foreground/80 hover:bg-muted')}><Columns3 className="w-4 h-4" aria-hidden="true" />Board</button>
            </div>
          </div>

          {taskViewMode === 'list' ? renderTaskList() : (
            <div className="space-y-4">
              {visibleProjects.map(project => {
                const tasks = allTasks[project.id] || [];
                if (tasks.length === 0) return null;
                return (
                  <section key={project.id} aria-labelledby={`portal-kanban-${project.id}`}>
                    <h3 id={`portal-kanban-${project.id}`} className="font-semibold text-foreground mb-2">
                      {project.title}
                    </h3>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {TASK_STATUSES.map((status) => {
                        const columnTasks = tasks.filter((task) => taskStatus(task) === status);
                        return (
                          <div key={status} className="rounded-lg bg-muted/50 dark:bg-card/50 p-3 min-h-[10rem]">
                            <div className="flex items-center gap-2 mb-3">
                              <span className={cn('w-2.5 h-2.5 rounded-full', TASK_STATUS_COLORS[status])} aria-hidden="true" />
                              <h4 className="text-sm font-semibold text-foreground">{TASK_STATUS_LABELS[status]}</h4>
                              <span className="text-xs text-muted-foreground ml-auto">{columnTasks.length}</span>
                            </div>
                            <div className="space-y-2">
                              {columnTasks.length > 0 ? columnTasks.map((task) => {
                                const isOverdue = !task.completed && task.due_date < new Date().toISOString();
                                return (
                                  <Card key={task.id} className={cn('p-2.5 border', task.completed && 'opacity-60')}>
                                    <div className="flex items-start gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleToggleTask(project.id, task.id)}
                                        aria-label={`Mark "${task.title}" ${task.completed ? 'incomplete' : 'complete'}`}
                                        aria-pressed={task.completed}
                                        className={cn('mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors', task.completed ? 'bg-spoke border-spoke text-white' : 'border-border hover:border-hub')}
                                      >
                                        {task.completed && <span className="text-xs" aria-hidden="true">&#10003;</span>}
                                      </button>
                                      <div className="min-w-0 flex-1">
                                        <button type="button" onClick={() => openTaskDetail(project.id, task.id)} className={cn('text-sm text-left hover:underline w-full', task.completed && 'line-through text-muted-foreground')}>
                                          {task.title}
                                        </button>
                                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                          <span className={cn('text-[11px]', isOverdue ? 'text-danger-strong font-semibold' : 'text-muted-foreground')}>
                                            {new Date(task.due_date).toLocaleDateString()}
                                          </span>
                                          <Badge className={cn('text-[10px] px-1.5', OWNER_COLORS[task.owner])}>{OWNER_LABELS[task.owner]}</Badge>
                                        </div>
                                      </div>
                                    </div>
                                  </Card>
                                );
                              }) : <p className="text-xs text-muted-foreground py-4 text-center">No tasks</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {visibleTaskCount === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No tasks assigned to you</p>
          )}
        </div>
      )}

      <Dialog open={!!selectedTask} onOpenChange={(open) => { if (!open) closeTaskDetail(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Task details</DialogTitle>
          </DialogHeader>
          {!selectedTaskDetail ? (
            <p className="text-sm text-muted-foreground">Loading details…</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-lg font-semibold text-foreground">{selectedTaskDetail.title}</h3>
                <div className="flex items-center gap-2">
                  <Badge className={cn('text-[10px] px-1.5', OWNER_COLORS[selectedTaskDetail.owner])}>
                    {OWNER_LABELS[selectedTaskDetail.owner]}
                  </Badge>
                  <Badge className={cn('text-[10px] shrink-0', PHASE_COLORS[selectedTaskDetail.phase], 'text-white')}>
                    {PHASE_LABELS[selectedTaskDetail.phase]}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="p-3">
                  <p className="text-xs text-muted-foreground">Due date</p>
                  <p className="text-sm font-medium">{new Date(selectedTaskDetail.due_date).toLocaleString()}</p>
                </Card>
                <Card className="p-3">
                  <p className="text-xs text-muted-foreground">Attachments</p>
                  <p className="text-sm font-medium">{selectedTaskDetail.attachment_count ?? 0}</p>
                </Card>
                <Card className="p-3">
                  <p className="text-xs text-muted-foreground">Comments</p>
                  <p className="text-sm font-medium">{selectedTaskDetail.comment_count ?? 0}</p>
                </Card>
              </div>

              <Card className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Details</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {selectedTaskDetail.details || selectedTaskDetail.description || 'No details provided.'}
                </p>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Documents Tab */}
      {activeTab === 'documents' && dashboardData && (
        <div className="space-y-6">
          {renderProjectFilter('portal-document-project-filter')}
          {visibleProjects.map(project => {
            const docs = documents[project.id] || [];
            if (docs.length === 0) return null;
            return (
              <div key={project.id}>
                <h3 className="font-semibold text-foreground mb-2">{project.title}</h3>
                <div className="space-y-2">
                  {docs.map(doc => (
                    <Card key={doc.id} className="p-3 flex items-center gap-3">
                      <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.file_type.toUpperCase()} &middot; {new Date(doc.uploaded_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{doc.file_type.toUpperCase()}</Badge>
                      {canPreview(doc.file_type) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openDocPreview(project.id, doc)}
                          className="shrink-0"
                          aria-label={`Preview ${doc.filename}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            const res = await portalAPI.downloadDocument(project.id, doc.id, token);
                            const blob = new Blob([res.data]);
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = doc.filename;
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch (err) {
                            toast.error(describeApiError(err, 'Download failed'));
                          }
                        }}
                        className="shrink-0"
                        aria-label={`Download ${doc.filename}`}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
          {visibleProjects.every((project) => (documents[project.id] || []).length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-8">No shared documents</p>
          )}
        </div>
      )}

      {/* Messages Tab */}
      {activeTab === 'messages' && dashboardData && (
        <div>
          {/* Channel switcher */}
          <div className="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Message channels">
            {dashboardData.projects.map(project => (
              <button
                key={project.id}
                type="button"
                role="tab"
                aria-selected={activeProject === project.id}
                onClick={() => loadMessages(project.id)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors shrink-0',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1',
                  activeProject === project.id
                    ? 'bg-hub-soft text-hub-strong'
                    : 'bg-muted text-foreground/80 hover:bg-muted',
                )}
              >
                {project.title}
              </button>
            ))}
          </div>

          {/* Messages */}
          <Card className="p-4 mb-3 max-h-96 overflow-y-auto">
            {messages.length > 0 ? (
              <div className="space-y-3">
                {messages.map(msg => (
                  <div key={msg.id} className="flex gap-3">
                    <div
                      className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0',
                        msg.sender_type === 'partner'
                          ? 'bg-ownership-partner-soft text-ownership-partner-strong'
                          : 'bg-ownership-internal-soft text-ownership-internal-strong',
                      )}
                      aria-hidden="true"
                    >
                      {msg.sender_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-medium">{msg.sender_name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(msg.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-foreground dark:text-muted-foreground mt-0.5 break-words">
                        {renderMentionBody(msg.body, msg.mentions)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No messages yet</p>
            )}
          </Card>

          {/* Input */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-white dark:bg-card px-3 py-1">
            <label htmlFor="portal-message-input" className="sr-only">Message</label>
            <MentionTextarea
              value={msgBody}
              mentions={msgMentions}
              members={members}
              onChange={(b, m) => { setMsgBody(b); setMsgMentions(m); }}
              onSubmit={handleSendMessage}
              placeholder="Type a message — @ to mention..."
            />
            <Button
              type="button"
              onClick={handleSendMessage}
              aria-label="Send message"
              className="bg-hub hover:bg-hub/90 text-white px-4 shrink-0"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
          {lastDeliverySummary && (
            <Card className="mt-3 p-3 bg-muted/40">
              <p className="text-xs text-muted-foreground">Last delivery</p>
              <p className="text-sm text-foreground">
                Message notifications delivered: {lastDeliverySummary.message_recipients_notified ?? 0} recipient(s)
              </p>
              <p className="text-sm text-foreground">
                Mentions resolved/notified: {(lastDeliverySummary.mentions_resolved ?? 0)} / {(lastDeliverySummary.mentions_requested ?? 0)}
              </p>
            </Card>
          )}
        </div>
      )}

      {/* Settings Tab — notification preferences. Partners don't get
          password/calendar settings (magic-link auth), so this tab is
          dedicated to communication controls. */}
      {activeTab === 'settings' && (
        <div className="max-w-2xl">
          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-1">Notifications</h2>
            <p className="text-sm text-foreground/80 mb-4">
              Choose which emails and in-portal alerts you receive.
            </p>
            <NotificationPreferences mode="portal" portalToken={token} />
          </Card>
        </div>
      )}
      {previewingDoc && previewKind(previewingDoc.doc.file_type) && (
        <AttachmentPreviewDialog
          open={true}
          onOpenChange={(open) => { if (!open) closeDocPreview(); }}
          filename={previewingDoc.doc.filename}
          kind={previewKind(previewingDoc.doc.file_type)!}
          url={previewingDoc.url}
        />
      )}
    </PortalLayout>
  );
}

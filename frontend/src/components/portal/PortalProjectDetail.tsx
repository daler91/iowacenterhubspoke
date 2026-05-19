import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { CalendarDays, Columns3, Download, Eye, FileText, List, Mail, MapPin, Send } from 'lucide-react';
import { toast } from 'sonner';
import PortalLayout from './PortalLayout';
import PortalTaskBoard from './PortalTaskBoard';
import PortalTaskDetailModal from './PortalTaskDetailModal';
import { portalAPI } from '../../lib/coordination-api';
import { cn } from '../../lib/utils';
import type { Message, Mention, PartnerContact, PartnerOrg, Project, ProjectDocument, ProjectMember, Task, TaskStatus } from '../../lib/coordination-types';
import { OWNER_COLORS, OWNER_LABELS, PHASE_COLORS, PHASE_DOT_COLORS, PHASE_LABELS } from '../../lib/coordination-types';
import MentionTextarea, { renderMentionBody } from '../coordination/MentionTextarea';
import { canPreview, previewKind } from '../../lib/attachment-preview';
import AttachmentPreviewDialog from '../coordination/AttachmentPreviewDialog';
import { describeApiError } from '../../lib/error-messages';
import { formatCalendarDate } from '../../lib/date-format';

type TaskViewMode = 'list' | 'kanban';
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

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

export default function PortalProjectDetail() {
  const { token: urlToken, projectId = '' } = useParams<{ token: string; projectId: string }>();
  const token = urlToken || '';
  const navigate = useNavigate();
  const [org, setOrg] = useState<PartnerOrg | null>(null);
  const [contact, setContact] = useState<PartnerContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksStatus, setTasksStatus] = useState<LoadStatus>('idle');
  const [tasksError, setTasksError] = useState('');
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [documentsStatus, setDocumentsStatus] = useState<LoadStatus>('idle');
  const [documentsError, setDocumentsError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesStatus, setMessagesStatus] = useState<LoadStatus>('idle');
  const [messagesError, setMessagesError] = useState('');
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [msgBody, setMsgBody] = useState('');
  const [msgMentions, setMsgMentions] = useState<Mention[]>([]);
  const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>('list');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [previewingDoc, setPreviewingDoc] = useState<{ doc: ProjectDocument; url: string } | null>(null);
  const [pendingTaskIds, setPendingTaskIds] = useState<Record<string, boolean>>({});
  const [documentActionIds, setDocumentActionIds] = useState<Record<string, boolean>>({});
  const [sendingMessage, setSendingMessage] = useState(false);

  const loadProject = async () => {
    const projectsRes = await portalAPI.projects(token);
    const found = (projectsRes.data?.items || []).find((p: Project) => p.id === projectId) || null;
    setProject(found);
  };

  const loadTasks = async () => {
    setTasksStatus('loading');
    setTasksError('');
    try {
      const res = await portalAPI.projectTasks(projectId, token);
      setTasks(res.data.items || []);
      setTasksStatus('ready');
    } catch (err) {
      setTasksError(describeApiError(err, "We couldn't load project tasks."));
      setTasksStatus('error');
    }
  };

  const loadDocuments = async () => {
    setDocumentsStatus('loading');
    setDocumentsError('');
    try {
      const res = await portalAPI.projectDocuments(projectId, token);
      setDocuments(res.data.items || []);
      setDocumentsStatus('ready');
    } catch (err) {
      setDocumentsError(describeApiError(err, "We couldn't load project documents."));
      setDocumentsStatus('error');
    }
  };

  const loadMessages = async () => {
    setMessagesStatus('loading');
    setMessagesError('');
    try {
      const res = await portalAPI.projectMessages(projectId, token);
      setMessages(res.data.items || []);
      setMessagesStatus('ready');
    } catch (err) {
      setMessagesError(describeApiError(err, "We couldn't load project messages."));
      setMessagesStatus('error');
    }
  };

  const loadMembers = async () => {
    try {
      const res = await portalAPI.projectMembers(projectId, token);
      setMembers(res.data.items || []);
    } catch {
      setMembers([]);
    }
  };

  const loadAll = async () => {
    await loadProject();
    await Promise.allSettled([loadTasks(), loadDocuments(), loadMessages(), loadMembers()]);
  };

  useEffect(() => {
    (async () => {
      try {
        const verifyRes = await portalAPI.verify(token);
        setOrg(verifyRes.data.org);
        setContact(verifyRes.data.contact);
        await loadAll();
      } catch {
        setError('Failed to load project portal details.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token, projectId]);

  const handleToggleTask = async (task: Task) => {
    const key = taskActionKey(projectId, task.id);
    if (pendingTaskIds[key]) return;
    setPendingKey(setPendingTaskIds, key, true);
    try {
      if (task.completed) {
        await portalAPI.updateTask(projectId, task.id, token, {
          completed: false,
          status: task.status === 'completed' ? 'to_do' : (task.status || 'to_do'),
        });
      } else {
        // Use idempotent completion writes so stale UI cannot accidentally
        // reopen a task via server-side toggle semantics.
        await portalAPI.updateTask(projectId, task.id, token, { completed: true });
      }
      await loadTasks();
      toast.success('Task updated');
    } catch (err) {
      toast.error(describeApiError(err, 'Failed to update task'));
    } finally {
      setPendingKey(setPendingTaskIds, key, false);
    }
  };

  const handleMoveTask = async (_projectId: string, task: Task, status: TaskStatus) => {
    const key = taskActionKey(projectId, task.id);
    if (pendingTaskIds[key]) return { ok: false, message: 'That task update is still saving.' };
    setPendingKey(setPendingTaskIds, key, true);
    try {
      const wasCompleted = !!task.completed;
      const willBeCompleted = status === 'completed';

      if (!wasCompleted && willBeCompleted) {
        await portalAPI.updateTask(projectId, task.id, token, { completed: true, status });
      } else if (wasCompleted && !willBeCompleted) {
        // Re-open task and set new status.
        await portalAPI.updateTask(projectId, task.id, token, { completed: false, status });
      } else {
        await portalAPI.updateTask(projectId, task.id, token, { status, completed: willBeCompleted });
      }
      await loadTasks();
      return { ok: true };
    } catch (err) {
      const message = describeApiError(err, 'You do not have permission to move that task to this status.');
      toast.error(message);
      return { ok: false, message };
    } finally {
      setPendingKey(setPendingTaskIds, key, false);
    }
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!msgBody.trim() || sendingMessage) return;
    setSendingMessage(true);
    try {
      await portalAPI.sendMessage(projectId, token, {
        channel: project?.title || 'general',
        body: msgBody.trim(),
        mentions: msgMentions,
      });
      setMsgBody('');
      setMsgMentions([]);
      await loadMessages();
      toast.success('Message sent');
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  };

  const openDocPreview = async (doc: ProjectDocument) => {
    const key = documentActionKey('preview', projectId, doc.id);
    if (documentActionIds[key]) return;
    setPendingKey(setDocumentActionIds, key, true);
    try {
      const res = await portalAPI.previewDocument(projectId, doc.id, token);
      const contentType = (res.headers?.['content-type'] as string | undefined) ?? '';
      const blob = new Blob([res.data], contentType ? { type: contentType } : undefined);
      const url = URL.createObjectURL(blob);
      setPreviewingDoc({ doc, url });
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't load that preview."));
    } finally {
      setPendingKey(setDocumentActionIds, key, false);
    }
  };

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => Number(!!a.completed) - Number(!!b.completed)), [tasks]);

  if (!loading && error && (!org || !contact)) {
    return (
      <div className="min-h-screen bg-muted/50 dark:bg-background p-6">
        <div className="max-w-5xl mx-auto">
          <Card className="p-4 border-danger/30 bg-danger-soft/20" role="alert">
            <p className="text-sm font-medium text-danger-strong">{error}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => navigate(token ? `/portal/${token}` : '/portal')}>
              Back to dashboard
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  if (loading || !org || !contact) {
    return <div className="min-h-screen bg-muted/50 dark:bg-background p-6"><div className="max-w-5xl mx-auto"><output className="text-sm text-muted-foreground" aria-live="polite">Loading...</output></div></div>;
  }

  if (error || !project) {
    return (
      <PortalLayout org={org} contact={contact} token={token} activeTab="overview" onTabChange={() => {}}>
        <Card className="p-4 border-danger/30 bg-danger-soft/20" role="alert">
          <p className="text-sm font-medium text-danger-strong">{error || 'Project not found.'}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => navigate(token ? `/portal/${token}` : '/portal')}>
            Back to dashboard
          </Button>
        </Card>
      </PortalLayout>
    );
  }

  const projectContextType = (project as Project & { context_type?: string }).context_type;
  let projectMessagesContent: ReactNode;
  if (messagesStatus === 'loading') {
    projectMessagesContent = (
      <output className="block text-sm text-muted-foreground text-center py-6" aria-live="polite">
        Loading project messages...
      </output>
    );
  } else if (messagesStatus === 'error') {
    projectMessagesContent = (
      <div role="alert" className="text-center py-6">
        <p className="text-sm font-medium text-danger-strong">Messages could not be loaded.</p>
        <p className="text-sm text-foreground/80 mt-1">{messagesError}</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={loadMessages}>
          Retry messages
        </Button>
      </div>
    );
  } else if (messages.length > 0) {
    projectMessagesContent = messages.map(msg => (
      <div key={msg.id} className="mb-3">
        <p className="text-xs text-muted-foreground">{msg.sender_name} • {new Date(msg.created_at).toLocaleString()}</p>
        <p className="text-sm">{renderMentionBody(msg.body, msg.mentions)}</p>
      </div>
    ));
  } else {
    projectMessagesContent = (
      <p className="text-sm text-muted-foreground text-center py-6">No messages yet for this project</p>
    );
  }

  return (
    <PortalLayout org={org} contact={contact} activeTab="overview" onTabChange={() => {}} token={token}>
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(token ? `/portal/${token}` : '/portal')}>Back to dashboard</Button>

        <Card className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <span className={cn('w-2.5 h-2.5 rounded-full', PHASE_DOT_COLORS[project.phase])} />
                <h1 className="text-xl font-semibold">{project.title}</h1>
              </div>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1"><CalendarDays className="w-4 h-4" />{formatCalendarDate(project.event_date)}</p>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1"><MapPin className="w-4 h-4" />{project.venue_name || 'Venue TBD'} • {projectContextType || 'Context TBD'}</p>
            </div>
            <Badge className={cn('text-[10px] shrink-0 text-white', PHASE_COLORS[project.phase])}>{PHASE_LABELS[project.phase]}</Badge>
          </div>
        </Card>

        <section>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <h2 className="font-semibold">Tasks</h2>
            <div className="inline-flex rounded-md border border-border bg-background p-0.5" aria-label="Task view">
              <button type="button" onClick={() => setTaskViewMode('list')} aria-pressed={taskViewMode === 'list'} className={cn('inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors', taskViewMode === 'list' ? 'bg-hub-soft text-hub-strong' : 'text-foreground/80 hover:bg-muted')}><List className="w-4 h-4" aria-hidden="true" />List</button>
              <button type="button" onClick={() => setTaskViewMode('kanban')} aria-pressed={taskViewMode === 'kanban'} className={cn('inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors', taskViewMode === 'kanban' ? 'bg-hub-soft text-hub-strong' : 'text-foreground/80 hover:bg-muted')}><Columns3 className="w-4 h-4" aria-hidden="true" />Board</button>
            </div>
          </div>
          {tasksStatus === 'loading' && (
            <output className="block text-sm text-muted-foreground text-center py-6" aria-live="polite">
              Loading tasks...
            </output>
          )}
          {tasksStatus === 'error' && (
            <Card className="p-4 border-danger/30 bg-danger-soft/20" role="alert">
              <p className="text-sm font-medium text-danger-strong">Tasks could not be loaded.</p>
              <p className="text-sm text-foreground/80 mt-1">{tasksError}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={loadTasks}>
                Retry tasks
              </Button>
            </Card>
          )}
          {tasksStatus === 'ready' && (taskViewMode === 'list' ? (
            <div className="space-y-2">
              {sortedTasks.map(task => (
                <Card key={task.id} className={cn('p-3 border', task.completed && 'opacity-60')}>
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleTask(task)}
                      disabled={!!pendingTaskIds[taskActionKey(projectId, task.id)]}
                      aria-label={`${task.completed ? 'Mark incomplete' : 'Mark complete'}: ${task.title}`}
                      className={cn('mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50', task.completed ? 'bg-spoke border-spoke text-white' : 'border-border hover:border-hub')}
                    >
                      {task.completed && <span className="text-xs" aria-hidden="true">&#10003;</span>}
                    </button>
                    <div className="min-w-0 flex-1">
                      <button type="button" className={cn('text-sm font-medium text-left hover:underline w-full', task.completed && 'line-through text-muted-foreground')} onClick={() => setSelectedTaskId(task.id)}>{task.title}</button>
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">{formatCalendarDate(task.due_date)}</span>
                        <Badge className={cn('text-[10px] px-1.5', OWNER_COLORS[task.owner])}>{OWNER_LABELS[task.owner]}</Badge>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <PortalTaskBoard
              projects={[project]}
              allTasks={{ [project.id]: tasks }}
              onOpenTask={(_pid, taskId) => setSelectedTaskId(taskId)}
              onMoveTask={handleMoveTask}
            />
          ))}
          {tasksStatus === 'ready' && sortedTasks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No tasks assigned to this project</p>
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-2">Project documents</h2>
          {documentsStatus === 'loading' && (
            <output className="block text-sm text-muted-foreground text-center py-6" aria-live="polite">
              Loading project documents...
            </output>
          )}
          {documentsStatus === 'error' && (
            <Card className="p-4 border-danger/30 bg-danger-soft/20" role="alert">
              <p className="text-sm font-medium text-danger-strong">Documents could not be loaded.</p>
              <p className="text-sm text-foreground/80 mt-1">{documentsError}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={loadDocuments}>
                Retry documents
              </Button>
            </Card>
          )}
          {documentsStatus === 'ready' && (
            <div className="space-y-2">
              {documents.map(doc => (
              <Card key={doc.id} className="p-3 flex items-center gap-2">
                <FileText className="w-4 h-4" aria-hidden="true" />
                <span className="text-sm flex-1 truncate">{doc.filename}</span>
                {canPreview(doc.file_type) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openDocPreview(doc)}
                    disabled={!!documentActionIds[documentActionKey('preview', projectId, doc.id)]}
                    aria-label={`Preview ${doc.filename}`}
                  >
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={async () => {
                  const key = documentActionKey('download', projectId, doc.id);
                  if (documentActionIds[key]) return;
                  setPendingKey(setDocumentActionIds, key, true);
                  try {
                    const res = await portalAPI.downloadDocument(projectId, doc.id, token);
                    const url = URL.createObjectURL(new Blob([res.data]));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = doc.filename;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    toast.error(describeApiError(err, 'Download failed'));
                  } finally {
                    setPendingKey(setDocumentActionIds, key, false);
                  }
                }} disabled={!!documentActionIds[documentActionKey('download', projectId, doc.id)]} aria-label={`Download ${doc.filename}`}><Download className="w-4 h-4" aria-hidden="true" /></Button>
              </Card>
              ))}
            </div>
          )}
          {documentsStatus === 'ready' && documents.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No shared documents for this project</p>
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-2">Project messages</h2>
          <Card className="p-4 mb-2 max-h-80 overflow-y-auto">
            {projectMessagesContent}
          </Card>
          <form onSubmit={handleSendMessage} className="flex items-center gap-2 border rounded-lg p-2">
            <Mail className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="portal-project-message-input" className="sr-only">Message this project</label>
            <MentionTextarea
              id="portal-project-message-input"
              value={msgBody}
              mentions={msgMentions}
              onChange={(body, mentions) => { setMsgBody(body); setMsgMentions(mentions); }}
              members={members}
              placeholder="Message this project"
              className="min-h-[44px]"
              disabled={sendingMessage || messagesStatus === 'loading'}
              aria-label="Message this project"
            />
            <Button type="submit" size="sm" disabled={sendingMessage || !msgBody.trim()} aria-label="Send project message">
              <Send className="w-4 h-4" aria-hidden="true" />
            </Button>
          </form>
        </section>
      </div>

      {selectedTaskId && (
        <PortalTaskDetailModal
          key={selectedTaskId}
          open={!!selectedTaskId}
          onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }}
          projectId={projectId}
          taskId={selectedTaskId}
          token={token}
          onRefresh={loadTasks}
        />
      )}

      {previewingDoc && (
        <AttachmentPreviewDialog
          open={!!previewingDoc}
          onOpenChange={(open) => {
            if (!open) {
              URL.revokeObjectURL(previewingDoc.url);
              setPreviewingDoc(null);
            }
          }}
          url={previewingDoc.url}
          filename={previewingDoc.doc.filename}
          kind={previewKind(previewingDoc.doc.file_type) ?? 'pdf'}
        />
      )}
    </PortalLayout>
  );
}

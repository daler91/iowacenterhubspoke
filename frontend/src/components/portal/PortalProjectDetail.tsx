import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
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

const PORTAL_TOKEN_KEY = 'portal_session_token';
type TaskViewMode = 'list' | 'kanban';

export default function PortalProjectDetail() {
  const { token: urlToken, projectId = '' } = useParams<{ token: string; projectId: string }>();
  const token = urlToken || sessionStorage.getItem(PORTAL_TOKEN_KEY) || '';
  const navigate = useNavigate();
  const [org, setOrg] = useState<PartnerOrg | null>(null);
  const [contact, setContact] = useState<PartnerContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [msgBody, setMsgBody] = useState('');
  const [msgMentions, setMsgMentions] = useState<Mention[]>([]);
  const [taskViewMode, setTaskViewMode] = useState<TaskViewMode>('list');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [previewingDoc, setPreviewingDoc] = useState<{ doc: ProjectDocument; url: string } | null>(null);

  const loadProject = async () => {
    const projectsRes = await portalAPI.projects(token);
    const found = (projectsRes.data?.items || []).find((p: Project) => p.id === projectId) || null;
    setProject(found);
  };

  const loadTasks = async () => {
    const res = await portalAPI.projectTasks(projectId, token);
    setTasks(res.data.items || []);
  };

  const loadDocuments = async () => {
    const res = await portalAPI.projectDocuments(projectId, token);
    setDocuments(res.data.items || []);
  };

  const loadMessages = async () => {
    const res = await portalAPI.projectMessages(projectId, token);
    setMessages(res.data.items || []);
  };

  const loadMembers = async () => {
    const res = await portalAPI.projectMembers(projectId, token);
    setMembers(res.data.items || []);
  };

  const loadAll = async () => {
    await Promise.all([loadProject(), loadTasks(), loadDocuments(), loadMessages(), loadMembers()]);
  };

  useEffect(() => {
    (async () => {
      try {
        const verifyRes = await portalAPI.verify(token);
        setOrg(verifyRes.data.org);
        setContact(verifyRes.data.contact);
        sessionStorage.setItem(PORTAL_TOKEN_KEY, token);
        await loadAll();
      } catch {
        setError('Failed to load project portal details.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token, projectId]);

  const handleToggleTask = async (task: Task) => {
    try {
      if (task.completed) {
        await portalAPI.updateTask(projectId, task.id, token, { completed: false });
      } else {
        // Use idempotent completion writes so stale UI cannot accidentally
        // reopen a task via server-side toggle semantics.
        await portalAPI.updateTask(projectId, task.id, token, { completed: true });
      }
      await loadTasks();
      toast.success('Task updated');
    } catch {
      toast.error('Failed to update task');
    }
  };

  const handleMoveTask = async (_projectId: string, task: Task, status: TaskStatus) => {
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
    }
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!msgBody.trim()) return;
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
    }
  };

  const openDocPreview = async (doc: ProjectDocument) => {
    try {
      const res = await portalAPI.previewDocument(projectId, doc.id, token);
      const contentType = (res.headers?.['content-type'] as string | undefined) ?? '';
      const blob = new Blob([res.data], contentType ? { type: contentType } : undefined);
      const url = URL.createObjectURL(blob);
      setPreviewingDoc({ doc, url });
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't load that preview."));
    }
  };

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => Number(!!a.completed) - Number(!!b.completed)), [tasks]);

  if (loading || !org || !contact) {
    return <div className="min-h-screen bg-muted/50 dark:bg-background p-6"><div className="max-w-5xl mx-auto"><p className="text-sm text-muted-foreground">Loading…</p></div></div>;
  }

  if (error || !project) {
    return <PortalLayout org={org} contact={contact} token={token} activeTab="overview" onTabChange={() => {}}><p className="text-sm text-danger-strong">{error || 'Project not found.'}</p></PortalLayout>;
  }

  return (
    <PortalLayout org={org} contact={contact} activeTab="overview" onTabChange={() => {}} token={token}>
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/portal/${token}`)}>Back to dashboard</Button>

        <Card className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <span className={cn('w-2.5 h-2.5 rounded-full', PHASE_DOT_COLORS[project.phase])} />
                <h1 className="text-xl font-semibold">{project.title}</h1>
              </div>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1"><CalendarDays className="w-4 h-4" />{new Date(project.event_date).toLocaleDateString()}</p>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1"><MapPin className="w-4 h-4" />{project.venue_name || 'Venue TBD'} • {project.context_type || 'Context TBD'}</p>
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
          {taskViewMode === 'list' ? (
            <div className="space-y-2">
              {sortedTasks.map(task => (
                <Card key={task.id} className={cn('p-3 border', task.completed && 'opacity-60')}>
                  <div className="flex items-start gap-2">
                    <button type="button" onClick={() => handleToggleTask(task)} className={cn('mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors', task.completed ? 'bg-spoke border-spoke text-white' : 'border-border hover:border-hub')}>
                      {task.completed && <span className="text-xs" aria-hidden="true">&#10003;</span>}
                    </button>
                    <div className="min-w-0 flex-1">
                      <button className={cn('text-sm font-medium text-left hover:underline w-full', task.completed && 'line-through text-muted-foreground')} onClick={() => setSelectedTaskId(task.id)}>{task.title}</button>
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">{new Date(task.due_date).toLocaleDateString()}</span>
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
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-2">Project documents</h2>
          <div className="space-y-2">
            {documents.map(doc => (
              <Card key={doc.id} className="p-3 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span className="text-sm flex-1 truncate">{doc.filename}</span>
                {canPreview(doc.file_type) && <Button size="sm" variant="ghost" onClick={() => openDocPreview(doc)}><Eye className="w-4 h-4" /></Button>}
                <Button size="sm" variant="ghost" onClick={async () => {
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
                  }
                }}><Download className="w-4 h-4" /></Button>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Project messages</h2>
          <Card className="p-4 mb-2 max-h-80 overflow-y-auto">{messages.map(msg => <div key={msg.id} className="mb-3"><p className="text-xs text-muted-foreground">{msg.sender_name} • {new Date(msg.created_at).toLocaleString()}</p><p className="text-sm">{renderMentionBody(msg.body, msg.mentions)}</p></div>)}</Card>
          <form onSubmit={handleSendMessage} className="flex items-center gap-2 border rounded-lg p-2"><Mail className="w-4 h-4 text-muted-foreground" /><MentionTextarea value={msgBody} onChange={setMsgBody} onMentionsChange={setMsgMentions} members={members} placeholder="Message this project" className="min-h-[44px]" /><Button type="submit" size="sm"><Send className="w-4 h-4" /></Button></form>
        </section>
      </div>

      {selectedTaskId && (
        <PortalTaskDetailModal
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
          src={previewingDoc.url}
          filename={previewingDoc.doc.filename}
          kind={previewKind(previewingDoc.doc.file_type)}
        />
      )}
    </PortalLayout>
  );
}

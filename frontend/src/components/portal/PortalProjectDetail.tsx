import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { CalendarDays, Columns3, Download, Eye, FileText, List, Mail, MapPin, Send } from 'lucide-react';
import PortalLayout from './PortalLayout';
import { portalAPI } from '../../lib/coordination-api';
import { cn } from '../../lib/utils';
import type { Message, Mention, PartnerContact, PartnerOrg, Project, ProjectDocument, ProjectMember, Task, TaskStatus } from '../../lib/coordination-types';
import { OWNER_COLORS, OWNER_LABELS, PHASE_COLORS, PHASE_DOT_COLORS, PHASE_LABELS, TASK_STATUSES, TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '../../lib/coordination-types';
import MentionTextarea, { renderMentionBody } from '../coordination/MentionTextarea';
import { canPreview, previewKind } from '../../lib/attachment-preview';
import AttachmentPreviewDialog from '../coordination/AttachmentPreviewDialog';

const PORTAL_TOKEN_KEY = 'portal_session_token';
type TaskViewMode = 'list' | 'kanban';

function taskStatus(task: Task): TaskStatus { return task.completed ? 'completed' : (task.status || 'to_do'); }

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
  const [selectedTask, setSelectedTask] = useState<{ taskId: string } | null>(null);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<Task | null>(null);
  const [previewingDoc, setPreviewingDoc] = useState<{ doc: ProjectDocument; url: string } | null>(null);
  const taskDetailRequestKeyRef = useRef<string | null>(null);

  const loadProject = async () => {
    const projectsRes = await portalAPI.projects(token);
    const found = (projectsRes.data?.items || []).find((p: Project) => p.id === projectId) || null;
    setProject(found);
  };
  const loadAll = async () => {
    await Promise.all([
      loadProject(),
      portalAPI.projectTasks(projectId, token).then(r => setTasks(r.data.items || [])),
      portalAPI.projectDocuments(projectId, token).then(r => setDocuments(r.data.items || [])),
      portalAPI.projectMessages(projectId, token).then(r => setMessages(r.data.items || [])),
      portalAPI.projectMembers(projectId, token).then(r => setMembers(r.data.items || [])),
    ]);
  };
  useEffect(() => { (async () => {
    try {
      const verifyRes = await portalAPI.verify(token);
      setOrg(verifyRes.data.org); setContact(verifyRes.data.contact);
      sessionStorage.setItem(PORTAL_TOKEN_KEY, token);
      await loadAll();
    } catch { setError('Failed to load project portal details.'); }
    finally { setLoading(false); }
  })(); }, [token, projectId]);

  const openTaskDetail = async (taskId: string) => {
    setSelectedTask({ taskId }); setSelectedTaskDetail(null);
    const key = `${projectId}:${taskId}`; taskDetailRequestKeyRef.current = key;
    try { const res = await portalAPI.taskDetail(projectId, taskId, token); if (taskDetailRequestKeyRef.current === key) setSelectedTaskDetail(res.data); } catch {}
  };

  if (loading) return <PortalLayout org={org} contact={contact} token={token} activeTab="overview" onTabChange={() => {}}><p>Loading…</p></PortalLayout>;
  if (error || !project) return <PortalLayout org={org} contact={contact} token={token} activeTab="overview" onTabChange={() => {}}><p className="text-sm text-danger-strong">{error || 'Project not found.'}</p></PortalLayout>;

  const handleSendMessage = async (e: FormEvent) => { e.preventDefault(); if (!msgBody.trim()) return; await portalAPI.sendMessage(projectId, token, { channel: 'general', body: msgBody.trim(), mentions: msgMentions }); setMsgBody(''); setMsgMentions([]); const res = await portalAPI.projectMessages(projectId, token); setMessages(res.data.items || []); };

  return <PortalLayout org={org} contact={contact} activeTab="overview" onTabChange={() => {}} token={token}>
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/portal/${token}`)}>Back to dashboard</Button>
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={cn('w-2.5 h-2.5 rounded-full', PHASE_DOT_COLORS[project.phase])} /><h1 className="text-xl font-semibold">{project.title}</h1></div>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1"><CalendarDays className="w-4 h-4" />{new Date(project.event_date).toLocaleDateString()}</p>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1"><MapPin className="w-4 h-4" />{project.venue_name || 'Venue TBD'} • {project.context_type || 'Context TBD'}</p>
        </div><Badge className={cn('text-[10px] shrink-0 text-white', PHASE_COLORS[project.phase])}>{PHASE_LABELS[project.phase]}</Badge></div>
      </Card>

      <section><div className="flex items-center justify-between mb-2"><h2 className="font-semibold">Tasks</h2><div className="inline-flex rounded-md border border-border bg-background p-0.5"><button onClick={() => setTaskViewMode('list')} className={cn('px-2 py-1 text-sm rounded', taskViewMode==='list' ? 'bg-hub-soft text-hub-strong':'' )}><List className="w-4 h-4" /></button><button onClick={() => setTaskViewMode('kanban')} className={cn('px-2 py-1 text-sm rounded', taskViewMode==='kanban' ? 'bg-hub-soft text-hub-strong':'' )}><Columns3 className="w-4 h-4" /></button></div></div>
      {taskViewMode === 'list' ? <div className="space-y-2">{tasks.map(task => <Card key={task.id} className="p-3"><button className="text-left" onClick={() => openTaskDetail(task.id)}>{task.title}</button></Card>)}</div> : <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">{TASK_STATUSES.map(status => <div key={status} className="rounded-lg bg-muted/50 p-3"><div className="flex items-center gap-1 mb-2"><span className={cn('w-2.5 h-2.5 rounded-full', TASK_STATUS_COLORS[status])} /><h3 className="text-sm font-semibold">{TASK_STATUS_LABELS[status]}</h3></div>{tasks.filter(t => taskStatus(t)===status).map(task => <Card key={task.id} className="p-2 mb-2"><button className="text-left text-sm" onClick={() => openTaskDetail(task.id)}>{task.title}</button></Card>)}</div>)}</div>}
      </section>

      <section><h2 className="font-semibold mb-2">Project documents</h2><div className="space-y-2">{documents.map(doc => <Card key={doc.id} className="p-3 flex items-center gap-2"><FileText className="w-4 h-4" /><span className="text-sm flex-1 truncate">{doc.filename}</span>{canPreview(doc.file_type) && <Button size="sm" variant="ghost" onClick={async ()=>{const res=await portalAPI.previewDocument(projectId, doc.id, token); const blob = new Blob([res.data], {type: (res.headers?.['content-type'] as string|undefined)||undefined}); const url = URL.createObjectURL(blob); setPreviewingDoc({doc,url});}}><Eye className="w-4 h-4"/></Button>}<Button size="sm" variant="ghost" onClick={async ()=>{const res=await portalAPI.downloadDocument(projectId, doc.id, token); const url = URL.createObjectURL(new Blob([res.data])); const a=document.createElement('a'); a.href=url; a.download=doc.filename; a.click(); URL.revokeObjectURL(url);}}><Download className="w-4 h-4"/></Button></Card>)}</div></section>

      <section><h2 className="font-semibold mb-2">Project messages</h2><Card className="p-4 mb-2 max-h-80 overflow-y-auto">{messages.map(msg => <div key={msg.id} className="mb-3"><p className="text-xs text-muted-foreground">{msg.sender_name} • {new Date(msg.created_at).toLocaleString()}</p><p className="text-sm">{renderMentionBody(msg.body, msg.mentions)}</p></div>)}</Card>
      <form onSubmit={handleSendMessage} className="flex items-center gap-2 border rounded-lg p-2"><Mail className="w-4 h-4 text-muted-foreground" /><MentionTextarea value={msgBody} onChange={setMsgBody} onMentionsChange={setMsgMentions} members={members} placeholder="Message this project" className="min-h-[44px]" /><Button type="submit" size="sm"><Send className="w-4 h-4" /></Button></form></section>
    </div>

    <Dialog open={!!selectedTask} onOpenChange={(open) => { if (!open) { setSelectedTask(null); setSelectedTaskDetail(null); } }}><DialogContent><DialogHeader><DialogTitle>Task details</DialogTitle></DialogHeader>{selectedTaskDetail && <div><h3 className="font-semibold">{selectedTaskDetail.title}</h3><Badge className={cn('text-[10px] px-1.5', OWNER_COLORS[selectedTaskDetail.owner])}>{OWNER_LABELS[selectedTaskDetail.owner]}</Badge><p className="text-sm mt-2">{selectedTaskDetail.details || selectedTaskDetail.description || 'No details provided.'}</p></div>}</DialogContent></Dialog>
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
  </PortalLayout>;
}

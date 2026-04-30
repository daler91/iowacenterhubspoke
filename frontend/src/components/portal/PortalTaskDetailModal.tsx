import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { CalendarDays, Download, Eye, FileText, MessageSquare, Paperclip, Reply, Send, X } from 'lucide-react';
import { SearchableSelect } from '../ui/searchable-select';
import { portalAPI } from '../../lib/coordination-api';
import { OWNER_COLORS, OWNER_LABELS, PHASE_COLORS, PHASE_LABELS, TASK_STATUSES, TASK_STATUS_COLORS, TASK_STATUS_LABELS, type Task, type TaskAttachment, type TaskComment, type Mention, type ProjectMember, type TaskStatus } from '../../lib/coordination-types';
import { canPreview, previewKind } from '../../lib/attachment-preview';
import AttachmentPreviewDialog from '../coordination/AttachmentPreviewDialog';
import MentionTextarea, { renderMentionBody } from '../coordination/MentionTextarea';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { describeApiError } from '../../lib/error-messages';

function formatCommentDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: '2-digit',
  });
}

function groupCommentsByDate(comments: TaskComment[]) {
  return comments.reduce<Array<{ date: string; items: TaskComment[] }>>((acc, item) => {
    const d = formatCommentDate(item.created_at);
    const last = acc.at(-1);
    if (!last || last.date !== d) acc.push({ date: d, items: [item] });
    else last.items.push(item);
    return acc;
  }, []);
}

function buildChildrenMap(comments: TaskComment[]) {
  const ids = new Set(comments.map(c => c.id));
  const map = new Map<string | null, TaskComment[]>();
  for (const c of comments) {
    const parent = c.parent_comment_id && ids.has(c.parent_comment_id)
      ? c.parent_comment_id
      : null;
    const bucket = map.get(parent) ?? [];
    bucket.push(c);
    map.set(parent, bucket);
  }
  for (const bucket of map.values()) bucket.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return map;
}

function collectDescendants(rootId: string, childrenMap: Map<string | null, TaskComment[]>) {
  const queue = [...(childrenMap.get(rootId) ?? [])];
  const flattened: TaskComment[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    flattened.push(current);
    queue.push(...(childrenMap.get(current.id) ?? []));
  }
  return flattened.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 45_000) return 'just now';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatCommentDate(iso);
}

function CommentNode({ comment, isRoot, onReply, parentDate }: Readonly<{ comment: TaskComment; isRoot: boolean; onReply?: (c: TaskComment) => void; parentDate: string }>) {
  const ownDate = formatCommentDate(comment.created_at);
  const time = new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const crossesDayBoundary = ownDate !== parentDate;
  return (
    <div id={`comment-${comment.id}`} className="flex gap-2 mb-3">
      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 mt-0.5', comment.sender_type === 'partner' ? 'bg-ownership-partner-soft text-ownership-partner-strong' : 'bg-ownership-internal-soft text-ownership-internal-strong')}>
        {(comment.sender_name || '?').charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs font-semibold text-foreground">{comment.sender_name}</span>
          <span className="text-[10px] text-muted-foreground">{crossesDayBoundary ? `${ownDate} · ${time}` : time}</span>
          {isRoot && onReply && (
            <button type="button" onClick={() => onReply(comment)} className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium text-hub hover:text-hub-strong dark:text-hub-soft dark:hover:text-hub-soft px-1.5 py-0.5 rounded hover:bg-hub-soft dark:hover:bg-hub-soft/30 transition-colors" aria-label={`Reply to ${comment.sender_name}`}>
              <Reply className="w-3 h-3" /> Reply
            </button>
          )}
        </div>
        <p className="text-xs text-foreground/80 dark:text-muted-foreground mt-0.5 leading-relaxed whitespace-pre-wrap">{renderMentionBody(comment.body, comment.mentions)}</p>
      </div>
    </div>
  );
}

function ThreadSummary({ descendants, onExpand }: Readonly<{ descendants: TaskComment[]; onExpand: () => void }>) {
  const seen = new Set<string>();
  const avatars: TaskComment[] = [];
  for (const d of descendants) {
    const key = d.sender_id || d.sender_name;
    if (seen.has(key)) continue;
    seen.add(key);
    avatars.push(d);
    if (avatars.length === 3) break;
  }
  const last = descendants.at(-1);
  const count = descendants.length;
  return (
    <button type="button" onClick={onExpand} className="group ml-9 mb-3 -mt-1 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[11px] text-hub-strong hover:bg-hub-soft dark:hover:bg-hub-soft/30 transition-colors">
      <div className="flex -space-x-1.5">{avatars.map(a => <span key={a.id} className={cn('w-5 h-5 rounded-md border border-white dark:border-card flex items-center justify-center text-[9px] font-semibold', a.sender_type === 'partner' ? 'bg-ownership-partner-soft text-ownership-partner-strong' : 'bg-ownership-internal-soft text-ownership-internal-strong')}>{(a.sender_name || '?').charAt(0).toUpperCase()}</span>)}</div>
      <span className="font-semibold group-hover:underline">{count} {count === 1 ? 'reply' : 'replies'}</span>
      {last && <span className="text-[10px] text-muted-foreground font-normal">Last reply {timeAgo(last.created_at)}</span>}
    </button>
  );
}

function ConversationsPanel({ comments, members, onPostComment }: Readonly<{ comments: TaskComment[]; members: readonly ProjectMember[]; onPostComment: (body: string, parentCommentId?: string | null, mentions?: Mention[]) => Promise<string | null | void> }>) {
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<TaskComment | null>(null);
  const [lastPostedId, setLastPostedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);
  const childrenMap = buildChildrenMap(comments);
  const roots = childrenMap.get(null) ?? [];
  const groups = groupCommentsByDate(roots);

  const openThread = (rootId: string) => setExpanded(prev => prev.has(rootId) ? prev : new Set([...prev, rootId]));
  const toggleThread = (rootId: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(rootId)) next.delete(rootId); else next.add(rootId);
    return next;
  });

  useEffect(() => {
    if (lastPostedId) {
      const el = document.getElementById(`comment-${lastPostedId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setLastPostedId(null);
        return;
      }
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length, lastPostedId]);

  const handleSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      const target = replyingTo;
      const newId = await onPostComment(body.trim(), target?.id ?? null, mentions);
      setBody('');
      setMentions([]);
      setReplyingTo(null);
      if (target) openThread(target.id);
      if (typeof newId === 'string') setLastPostedId(newId);
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="lg:w-[360px] lg:shrink-0 border-l-4 border-hub-soft dark:border-hub-soft/70 bg-gradient-to-b from-hub-soft/80 via-white to-muted/50 dark:from-hub-soft/30 dark:via-card/60 dark:to-card/80 shadow-[inset_6px_0_12px_-6px_rgba(99,102,241,0.25)] dark:shadow-[inset_6px_0_12px_-6px_rgba(99,102,241,0.35)] flex flex-col rounded-xl">
      <header className="px-4 py-3 border-b border-hub-soft/70 dark:border-hub-soft/50 bg-white/70 dark:bg-card/50 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-hub-soft/50 flex items-center justify-center"><MessageSquare className="w-3.5 h-3.5 text-hub-strong" /></div>
        <h2 className="text-base font-semibold text-foreground">Conversations</h2>
        {comments.length > 0 && <span className="text-[10px] font-bold text-hub-strong dark:text-hub-soft bg-hub-soft/50 px-1.5 py-0.5 rounded-full">{comments.length}</span>}
      </header>
      <section className="flex-1 overflow-y-auto px-3 py-3 max-h-[22rem] lg:max-h-[30rem]">
        {groups.length === 0 ? <div className="flex items-center justify-center h-full min-h-[200px]"><p className="text-xs text-muted-foreground">No messages yet</p></div> : groups.map(group => <div key={group.date}><div className="flex items-center gap-2 my-3"><div className="flex-1 h-px bg-muted" /><span className="text-[10px] text-muted-foreground font-medium">{group.date}</span><div className="flex-1 h-px bg-muted" /></div>{group.items.map(root => {
          const descendants = collectDescendants(root.id, childrenMap);
          const hasReplies = descendants.length > 0;
          const isExpanded = expanded.has(root.id);
          const rootDate = formatCommentDate(root.created_at);
          return <div key={root.id} className={cn('rounded-lg mb-2 transition-colors', hasReplies && 'bg-white/60 dark:bg-card/40 border border-border p-2')}><CommentNode comment={root} isRoot onReply={(c) => { setReplyingTo(c); openThread(c.id); }} parentDate={group.date} />
            {hasReplies && !isExpanded && <ThreadSummary descendants={descendants} onExpand={() => toggleThread(root.id)} />}
            {hasReplies && isExpanded && <div className="ml-4 border-l border-hub-soft dark:border-hub-soft/50 pl-3 mt-1">{descendants.map(d => <CommentNode key={d.id} comment={d} isRoot={false} parentDate={rootDate} />)}<button type="button" onClick={() => toggleThread(root.id)} className="text-[10px] font-medium text-hub hover:text-hub-strong dark:text-hub-soft dark:hover:text-hub-soft hover:underline mb-1">Hide replies</button></div>}
          </div>;
        })}</div>)}
        <div ref={endRef} />
      </section>
      <footer className="p-3 border-t border-border">
        {replyingTo && <div className="flex items-center gap-1.5 mb-2 px-2.5 py-1 rounded-full bg-hub-soft/30 border border-hub-soft dark:border-hub-soft/60 text-[11px] text-hub-strong dark:text-hub-soft w-fit max-w-full"><Reply className="w-3 h-3 shrink-0" /><span className="truncate">Replying to <span className="font-semibold">{replyingTo.sender_name}</span></span><button type="button" onClick={() => setReplyingTo(null)} className="ml-0.5 p-0.5 rounded hover:bg-hub-soft dark:hover:bg-hub-soft/60 transition-colors shrink-0" aria-label="Cancel reply"><X className="w-3 h-3" /></button></div>}
        <div className="flex items-center gap-2 rounded-full border-2 border-hub-soft dark:border-hub-soft/60 focus-within:border-hub-soft dark:focus-within:border-hub bg-white dark:bg-card pl-4 pr-1.5 py-1 transition-colors">
          <MentionTextarea value={body} mentions={mentions} members={members} onChange={(b, m) => { setBody(b); setMentions(m); }} onSubmit={handleSend} placeholder={replyingTo ? `Reply to ${replyingTo.sender_name}...` : 'Type a message — @ to mention...'} />
          <Button size="icon" onClick={handleSend} disabled={sending || !body.trim()} className="rounded-full bg-hub hover:bg-hub-strong text-white h-8 w-8 shrink-0" aria-label="Send message"><Send className="w-3.5 h-3.5" aria-hidden="true" /></Button>
        </div>
      </footer>
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  taskId: string;
  token: string;
  onRefresh: () => Promise<void> | void;
}

export default function PortalTaskDetailModal({ open, onOpenChange, projectId, taskId, token, onRefresh }: Readonly<Props>) {
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<Task | null>(null);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [previewing, setPreviewing] = useState<{ attachment: TaskAttachment; url: string } | null>(null);

  const canUpload = task?.owner === 'partner' || task?.owner === 'both';

  const loadData = async () => {
    if (!open || !token) return;
    setLoading(true);
    try {
      const [detailRes, attachmentRes, commentRes, memberRes] = await Promise.all([
        portalAPI.taskDetail(projectId, taskId, token),
        portalAPI.taskAttachments(projectId, taskId, token),
        portalAPI.taskComments(projectId, taskId, token),
        portalAPI.projectMembers(projectId, token),
      ]);
      setTask(detailRes.data as Task);
      setAttachments((attachmentRes.data?.items || []) as TaskAttachment[]);
      setComments((commentRes.data?.items || []) as TaskComment[]);
      setMembers((memberRes.data?.items || []) as ProjectMember[]);
    } catch {
      toast.error('Failed to load task details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, [open, projectId, taskId, token]);

  const sortedComments = useMemo(() => [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at)), [comments]);

  const taskStatus: TaskStatus = (task?.completed ? 'completed' : (task?.status || 'to_do')) as TaskStatus;
  const canEditStatus = task?.owner === 'partner' || task?.owner === 'both';

  const handleStatusChange = async (nextStatus: string) => {
    if (!task || !canEditStatus) return;
    const status = nextStatus as TaskStatus;
    const previous = taskStatus;
    if (status === previous) return;
    const completed = status === 'completed';
    setTask(prev => prev ? { ...prev, status, completed } : prev);
    try {
      await portalAPI.updateTask(projectId, taskId, token, { status, completed });
      await onRefresh();
    } catch (err) {
      setTask(prev => prev ? { ...prev, status: previous, completed: previous === 'completed' } : prev);
      toast.error(describeApiError(err, 'Failed to update task status'));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-5xl w-[95vw] max-h-[85vh] p-0 overflow-hidden gap-0 rounded-2xl">
          <DialogTitle className="sr-only">Task details</DialogTitle>
          {loading || !task ? <p className="p-6 text-sm text-muted-foreground">Loading details…</p> : (
            <div className="flex flex-col h-full max-h-[85vh]">
              <div className="p-5 border-b space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="text-lg font-semibold">{task.title}</h3>
                  <div className="flex items-center gap-2">
                    <Badge className={cn('text-[10px] px-1.5', OWNER_COLORS[task.owner])}>{OWNER_LABELS[task.owner]}</Badge>
                    <Badge className={cn('text-[10px] px-1.5 text-white', PHASE_COLORS[task.phase])}>{PHASE_LABELS[task.phase]}</Badge>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <Card className="p-3"><p className="text-xs text-muted-foreground mb-1">Status</p>{canEditStatus ? <SearchableSelect id="portal-task-status" value={taskStatus} onValueChange={handleStatusChange} options={TASK_STATUSES.map(s => ({ value: s, label: TASK_STATUS_LABELS[s] }))} placeholder="Select status" searchPlaceholder="Search status..." className="h-8" /> : <p className="text-sm font-medium flex items-center gap-1.5"><span className={cn('w-2 h-2 rounded-full', TASK_STATUS_COLORS[taskStatus])} />{TASK_STATUS_LABELS[taskStatus]}</p>}</Card>
                  <Card className="p-3"><p className="text-xs text-muted-foreground">Due date</p><p className="text-sm font-medium"><CalendarDays className="w-3.5 h-3.5 inline mr-1" />{new Date(task.due_date).toLocaleString()}</p></Card>
                  <Card className="p-3"><p className="text-xs text-muted-foreground">Attachments</p><p className="text-sm font-medium">{attachments.length}</p></Card>
                  <Card className="p-3"><p className="text-xs text-muted-foreground">Comments</p><p className="text-sm font-medium">{comments.length}</p></Card>
                </div>
              </div>

              <div className="p-5 overflow-y-auto">
                <div className="flex flex-col lg:flex-row gap-4">
                  <div className="flex-1 space-y-4 min-w-0">
                    <Card className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Description</p>
                      <p className="text-sm whitespace-pre-wrap">{task.description || 'No description provided.'}</p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Details</p>
                      <p className="text-sm whitespace-pre-wrap">{task.details || 'No details provided.'}</p>
                    </Card>
                    <Card className="p-4">
                      <div className="flex items-center justify-between mb-3"><p className="text-sm font-semibold">Attachments</p>
                        <label className={cn('text-xs', !canUpload && 'opacity-60')}>
                          <input type="file" className="hidden" disabled={!canUpload} onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file || !canUpload) return;
                            try {
                              await portalAPI.uploadTaskAttachment(projectId, taskId, token, file);
                              toast.success('Attachment uploaded');
                              await loadData();
                              await onRefresh();
                            } catch (err) { toast.error(describeApiError(err, 'Upload failed')); }
                          }} />
                          <span className="inline-flex items-center gap-1 cursor-pointer"><Paperclip className="w-3.5 h-3.5" />Upload</span>
                        </label>
                      </div>
                      <div className="space-y-2">{attachments.length === 0 ? <p className="text-xs text-muted-foreground">No attachments.</p> : attachments.map((a) => (
                        <div key={a.id} className="flex items-center gap-2 border rounded-md p-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <div className="flex-1 min-w-0"><p className="text-sm truncate">{a.filename}</p></div>
                          {canPreview(a.file_type) && <Button size="sm" variant="ghost" onClick={async () => {
                            try {
                              const res = await portalAPI.previewTaskAttachment(projectId, taskId, a.id, token);
                              const contentType = (res.headers?.['content-type'] as string | undefined) ?? '';
                              const blob = new Blob([res.data], contentType ? { type: contentType } : undefined);
                              setPreviewing({ attachment: a, url: URL.createObjectURL(blob) });
                            } catch (err) {
                              toast.error(describeApiError(err, "Couldn't load that preview."));
                            }
                          }}><Eye className="w-4 h-4" /></Button>}
                          <Button size="sm" variant="ghost" onClick={async () => {
                            try {
                              const d = await portalAPI.downloadTaskAttachment(projectId, taskId, a.id, token);
                              const blob = new Blob([d.data]);
                              const u = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = u; link.download = a.filename; link.click(); URL.revokeObjectURL(u);
                            } catch (err) {
                              toast.error(describeApiError(err, 'Download failed'));
                            }
                          }}><Download className="w-4 h-4" /></Button>
                        </div>
                      ))}</div>
                    </Card>
                  </div>
                  <ConversationsPanel
                    comments={sortedComments}
                    members={members}
                    onPostComment={async (body, parentCommentId, mentions) => {
                      const postRes = await portalAPI.postTaskComment(projectId, taskId, token, body, mentions ?? [], parentCommentId ?? undefined);
                      await loadData();
                      await onRefresh();
                      return (postRes.data as { id?: string } | undefined)?.id ?? null;
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AttachmentPreviewDialog
        open={!!previewing}
        onOpenChange={(v) => {
          if (!v && previewing) URL.revokeObjectURL(previewing.url);
          if (!v) setPreviewing(null);
        }}
        url={previewing?.url || ''}
        kind={previewing ? previewKind(previewing.attachment.file_type) : 'iframe'}
        filename={previewing?.attachment.filename || ''}
      />
    </>
  );
}

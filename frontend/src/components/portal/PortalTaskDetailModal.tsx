import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { CalendarDays, Download, Eye, FileText, MessageSquare, Paperclip, Send } from 'lucide-react';
import { portalAPI } from '../../lib/coordination-api';
import { OWNER_COLORS, OWNER_LABELS, PHASE_COLORS, PHASE_LABELS, TASK_STATUS_COLORS, TASK_STATUS_LABELS, type Task, type TaskAttachment, type TaskComment, type Mention, type ProjectMember } from '../../lib/coordination-types';
import { canPreview, previewKind } from '../../lib/attachment-preview';
import AttachmentPreviewDialog from '../coordination/AttachmentPreviewDialog';
import MentionTextarea, { renderMentionBody } from '../coordination/MentionTextarea';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { describeApiError } from '../../lib/error-messages';

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
  const [commentBody, setCommentBody] = useState('');
  const [commentMentions, setCommentMentions] = useState<Mention[]>([]);
  const [previewing, setPreviewing] = useState<{ attachment: TaskAttachment; url: string } | null>(null);

  const canUpload = task?.owner === 'partner';

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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[85vh] p-0 overflow-hidden gap-0 rounded-2xl">
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
                  <Card className="p-3"><p className="text-xs text-muted-foreground">Status</p><p className="text-sm font-medium flex items-center gap-1.5"><span className={cn('w-2 h-2 rounded-full', TASK_STATUS_COLORS[task.completed ? 'completed' : (task.status || 'to_do')])} />{TASK_STATUS_LABELS[task.completed ? 'completed' : (task.status || 'to_do')]}</p></Card>
                  <Card className="p-3"><p className="text-xs text-muted-foreground">Due date</p><p className="text-sm font-medium"><CalendarDays className="w-3.5 h-3.5 inline mr-1" />{new Date(task.due_date).toLocaleString()}</p></Card>
                  <Card className="p-3"><p className="text-xs text-muted-foreground">Attachments</p><p className="text-sm font-medium">{attachments.length}</p></Card>
                  <Card className="p-3"><p className="text-xs text-muted-foreground">Comments</p><p className="text-sm font-medium">{comments.length}</p></Card>
                </div>
              </div>

              <div className="p-5 overflow-y-auto space-y-4">
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
                        const res = await portalAPI.taskAttachments(projectId, taskId, token);
                        const found = ((res.data?.items || []) as TaskAttachment[]).find(i => i.id === a.id);
                        if (!found) return;
                        const d = await fetch(`/api/portal/projects/${projectId}/tasks/${taskId}/attachments/${a.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
                        const blob = await d.blob();
                        setPreviewing({ attachment: found, url: URL.createObjectURL(blob) });
                      }}><Eye className="w-4 h-4" /></Button>}
                      <Button size="sm" variant="ghost" onClick={async () => {
                        const d = await fetch(`/api/portal/projects/${projectId}/tasks/${taskId}/attachments/${a.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
                        const blob = await d.blob();
                        const u = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = u; link.download = a.filename; link.click(); URL.revokeObjectURL(u);
                      }}><Download className="w-4 h-4" /></Button>
                    </div>
                  ))}</div>
                </Card>
                <Card className="p-4">
                  <p className="text-sm font-semibold mb-2">Comments</p>
                  <div className="space-y-3 mb-3 max-h-72 overflow-y-auto pr-1">
                    {sortedComments.length === 0 ? <p className="text-xs text-muted-foreground">No comments yet.</p> : sortedComments.map((c) => (
                      <div key={c.id} className="flex gap-2"><MessageSquare className="w-4 h-4 mt-0.5 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">{c.sender_name} • {new Date(c.created_at).toLocaleString()}</p><p className="text-sm whitespace-pre-wrap">{renderMentionBody(c.body, c.mentions)}</p></div></div>
                    ))}
                  </div>
                  <MentionTextarea value={commentBody} onChange={setCommentBody} mentions={commentMentions} onMentionsChange={setCommentMentions} members={members} placeholder="Add a comment…" className="min-h-[84px]" />
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" disabled={!commentBody.trim()} onClick={async () => {
                      try {
                        await portalAPI.postTaskComment(projectId, taskId, token, commentBody.trim(), commentMentions);
                        setCommentBody(''); setCommentMentions([]);
                        await loadData();
                        await onRefresh();
                      } catch { toast.error('Failed to add comment'); }
                    }}><Send className="w-4 h-4 mr-1" />Comment</Button>
                  </div>
                </Card>
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

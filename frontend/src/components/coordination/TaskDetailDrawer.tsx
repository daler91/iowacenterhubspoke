import { useState, useEffect, useRef } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '../ui/sheet';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import {
  Check, Paperclip, MessageSquare, Trash2, Upload, Download,
  FileText, Send, X,
} from 'lucide-react';
import { projectTasksAPI } from '../../lib/coordination-api';
import {
  OWNER_COLORS, OWNER_LABELS, PHASE_LABELS, PHASE_DOT_COLORS,
  type Task, type TaskAttachment, type TaskComment, type TaskOwner,
} from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

interface Props {
  readonly projectId: string;
  readonly taskId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onUpdated: () => void;
}

export default function TaskDetailDrawer({
  projectId, taskId, open, onClose, onUpdated,
}: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [owner, setOwner] = useState<TaskOwner>('internal');
  const [assignedTo, setAssignedTo] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTask = async () => {
    try {
      const res = await projectTasksAPI.getOne(projectId, taskId);
      const t = res.data;
      setTask(t);
      setTitle(t.title);
      setDescription(t.description || '');
      setDueDate(t.due_date ? t.due_date.split('T')[0] : '');
      setOwner(t.owner);
      setAssignedTo(t.assigned_to || '');
    } catch {
      toast.error('Failed to load task');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && taskId) {
      setLoading(true);
      loadTask();
    }
  }, [open, taskId]);

  const handleSaveField = async (
    field: string, value: string,
  ) => {
    try {
      await projectTasksAPI.update(projectId, taskId, { [field]: value });
      onUpdated();
    } catch {
      toast.error('Failed to save');
    }
  };

  const handleToggleComplete = async () => {
    try {
      await projectTasksAPI.toggleComplete(projectId, taskId);
      await loadTask();
      onUpdated();
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleUploadAttachment = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await projectTasksAPI.uploadAttachment(projectId, taskId, file);
      await loadTask();
      toast.success('Attachment uploaded');
    } catch {
      toast.error('Failed to upload');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteAttachment = async (attId: string) => {
    try {
      await projectTasksAPI.deleteAttachment(projectId, taskId, attId);
      await loadTask();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handlePostComment = async () => {
    if (!commentBody.trim()) return;
    setSending(true);
    try {
      await projectTasksAPI.postComment(
        projectId, taskId, commentBody.trim(),
      );
      setCommentBody('');
      await loadTask();
    } catch {
      toast.error('Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    try {
      await projectTasksAPI.delete(projectId, taskId);
      toast.success('Task deleted');
      onClose();
      onUpdated();
    } catch {
      toast.error('Failed to delete');
    }
  };

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto"
      >
        {loading || !task ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            <SheetHeader className="space-y-3">
              {/* Completion toggle + title */}
              <div className="flex items-start gap-3">
                <button
                  onClick={handleToggleComplete}
                  className={cn(
                    'w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 mt-1 transition-colors',
                    task.completed
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'border-slate-300 hover:border-indigo-400',
                  )}
                >
                  {task.completed && <Check className="w-4 h-4" />}
                </button>
                <div className="flex-1">
                  <SheetTitle className="text-lg">
                    <Input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      onBlur={() => {
                        if (title !== task.title) {
                          handleSaveField('title', title);
                        }
                      }}
                      className={cn(
                        'text-lg font-semibold border-0 p-0 h-auto shadow-none focus-visible:ring-0',
                        task.completed && 'line-through opacity-50',
                      )}
                    />
                  </SheetTitle>
                </div>
              </div>

              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={cn('text-xs', PHASE_DOT_COLORS[task.phase])}>
                  {PHASE_LABELS[task.phase]}
                </Badge>
                <Badge className={cn('text-xs', OWNER_COLORS[task.owner])}>
                  {OWNER_LABELS[task.owner]}
                </Badge>
                {task.completed && (
                  <Badge variant="secondary" className="text-xs">
                    Completed {task.completed_by && `by ${task.completed_by}`}
                  </Badge>
                )}
              </div>
            </SheetHeader>

            {/* Editable fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-500">Due Date</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  onBlur={() => {
                    if (dueDate) {
                      handleSaveField(
                        'due_date',
                        new Date(dueDate).toISOString(),
                      );
                    }
                  }}
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-500">Owner</Label>
                <select
                  value={owner}
                  onChange={e => {
                    const v = e.target.value as TaskOwner;
                    setOwner(v);
                    handleSaveField('owner', v);
                  }}
                  className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700"
                >
                  <option value="internal">Internal</option>
                  <option value="partner">Partner</option>
                  <option value="both">Both</option>
                </select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-slate-500">Assigned To</Label>
                <Input
                  value={assignedTo}
                  onChange={e => setAssignedTo(e.target.value)}
                  onBlur={() => handleSaveField('assigned_to', assignedTo)}
                  placeholder="Name or contact"
                  className="text-sm"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Description</Label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                onBlur={() => {
                  if (description !== (task.description || '')) {
                    handleSaveField('description', description);
                  }
                }}
                rows={4}
                className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700 resize-y"
                placeholder="Add a detailed description..."
              />
            </div>

            {/* Attachments */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-slate-500 flex items-center gap-1">
                  <Paperclip className="w-3.5 h-3.5" />
                  Attachments ({task.attachments?.length ?? 0})
                </Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-7 text-xs"
                >
                  <Upload className="w-3 h-3 mr-1" /> Upload
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleUploadAttachment}
                />
              </div>
              <div className="space-y-1.5">
                {(task.attachments ?? []).map(att => (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm"
                  >
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="flex-1 truncate">{att.filename}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {att.file_type.toUpperCase()}
                    </Badge>
                    <a
                      href={projectTasksAPI.downloadAttachmentUrl(projectId, taskId, att.id)}
                      className="text-slate-400 hover:text-indigo-600"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => handleDeleteAttachment(att.id)}
                      className="text-slate-400 hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Comments */}
            <div>
              <Label className="text-xs text-slate-500 flex items-center gap-1 mb-2">
                <MessageSquare className="w-3.5 h-3.5" />
                Comments ({task.comments?.length ?? 0})
              </Label>
              <div className="space-y-3 max-h-64 overflow-y-auto mb-3">
                {(task.comments ?? []).map(cmt => (
                  <div key={cmt.id} className="flex gap-2">
                    <div className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0',
                      cmt.sender_type === 'partner'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-blue-100 text-blue-700',
                    )}>
                      {cmt.sender_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-medium">{cmt.sender_name}</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(cmt.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 dark:text-slate-300">{cmt.body}</p>
                    </div>
                  </div>
                ))}
                {(task.comments ?? []).length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-4">No comments yet</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={commentBody}
                  onChange={e => setCommentBody(e.target.value)}
                  placeholder="Write a comment..."
                  className="text-sm"
                  onKeyDown={e => e.key === 'Enter' && handlePostComment()}
                />
                <Button
                  size="sm"
                  onClick={handlePostComment}
                  disabled={sending || !commentBody.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white h-9 px-3"
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Delete */}
            <div className="pt-2 border-t">
              <Button
                variant="ghost"
                onClick={handleDelete}
                className="text-red-500 hover:text-red-700 hover:bg-red-50 text-sm"
              >
                <Trash2 className="w-4 h-4 mr-1" /> Delete Task
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

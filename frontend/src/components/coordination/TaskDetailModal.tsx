import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import {
  Paperclip, Upload, Download,
  FileText, Send, X, Trash2, CalendarDays, AlertTriangle, Lock, Star,
} from 'lucide-react';
import { projectTasksAPI } from '../../lib/coordination-api';
import DeleteTaskDialog from './DeleteTaskDialog';
import {
  PHASE_LABELS, PHASE_DOT_COLORS,
  TASK_STATUSES, TASK_STATUS_LABELS,
  type Task, type TaskOwner, type TaskComment,
} from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SearchableSelect } from '../ui/searchable-select';


function groupCommentsByDate(comments: TaskComment[]) {
  const groups: Array<{ date: string; items: TaskComment[] }> = [];
  let currentDate = '';
  for (const c of comments) {
    const d = new Date(c.created_at).toLocaleDateString('en-US', {
      day: 'numeric', month: 'short', year: '2-digit',
    });
    if (d !== currentDate) {
      currentDate = d;
      groups.push({ date: d, items: [] });
    }
    groups.at(-1)!.items.push(c);
  }
  return groups;
}

function TaskFlagControls({ task, onToggle }: Readonly<{
  task: Task;
  onToggle: (field: 'spotlight' | 'at_risk') => void;
}>) {
  return (
    <div className="space-y-2 mb-3">
      {/* Active flag banners */}
      {task.spotlight && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800">
          <Star className="w-4 h-4 text-amber-600 fill-amber-500 shrink-0" />
          <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Spotlight</span>
        </div>
      )}
      {task.at_risk && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wide">At Risk</span>
        </div>
      )}
      {/* Toggle buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onToggle('spotlight')}
          className={cn(
            'text-[10px] px-2.5 py-1 rounded-full border transition-colors',
            task.spotlight
              ? 'border-amber-400 text-amber-700 bg-amber-100 font-semibold'
              : 'border-slate-200 text-slate-400 hover:border-amber-300 hover:text-amber-600',
          )}
        >
          <Star className="w-3 h-3 inline mr-0.5" />
          {task.spotlight ? 'Remove Spotlight' : 'Spotlight'}
        </button>
        <button
          onClick={() => onToggle('at_risk')}
          className={cn(
            'text-[10px] px-2.5 py-1 rounded-full border transition-colors',
            task.at_risk
              ? 'border-red-400 text-red-700 bg-red-100 font-semibold'
              : 'border-slate-200 text-slate-400 hover:border-red-300 hover:text-red-600',
          )}
        >
          <AlertTriangle className="w-3 h-3 inline mr-0.5" />
          {task.at_risk ? 'Remove At Risk' : 'At Risk'}
        </button>
      </div>
    </div>
  );
}

function ConversationsPanel({ comments, onPostComment }: Readonly<{
  comments: TaskComment[];
  onPostComment: (body: string) => Promise<void>;
}>) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const groups = groupCommentsByDate(comments);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  const handleSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await onPostComment(body.trim());
      setBody('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="w-[340px] shrink-0 border-l bg-gray-50/50 dark:bg-gray-900/30 flex flex-col">
      <div className="px-4 py-3 border-b">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Conversations</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {groups.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-6">No messages yet</p>
        )}
        {groups.map(group => (
          <div key={group.date}>
            <div className="flex items-center gap-2 my-3">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
              <span className="text-[10px] text-slate-400 font-medium">{group.date}</span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            </div>
            {group.items.map((cmt) => (
              <div key={cmt.id} className="flex gap-2 mb-3">
                <div className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5',
                  cmt.sender_type === 'partner'
                    ? 'bg-ownership-partner-soft text-ownership-partner'
                    : 'bg-ownership-internal-soft text-ownership-internal',
                )}>
                  {(cmt.sender_name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-medium text-slate-800 dark:text-slate-100">{cmt.sender_name}</span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(cmt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{cmt.body}</p>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="border-t p-3">
        <div className="flex gap-1.5">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 text-xs border rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 resize-none"
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={sending || !body.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white h-auto self-end px-2.5 py-1.5"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}


interface Props {
  readonly projectId: string;
  readonly taskId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onUpdated: () => void;
  readonly projectTitle?: string;
  readonly employees?: Array<{ id: string; name: string; color?: string }>;
}

export default function TaskDetailModal({
  projectId, taskId, open, onClose, onUpdated, projectTitle, employees = [],
}: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [owner, setOwner] = useState<TaskOwner>('internal');
  const [assignedTo, setAssignedTo] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTask = useCallback(async () => {
    if (!projectId || !taskId) return;
    try {
      const res = await projectTasksAPI.getOne(projectId, taskId);
      const t = res.data;
      setTask(t);
      setTitle(t.title);
      setDescription(t.description || '');
      setDetails(t.details || '');
      setDueDate(t.due_date ? t.due_date.split('T')[0] : '');
      setOwner(t.owner);
      setAssignedTo(t.assigned_to || '');
    } catch {
      toast.error('Task not found');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId, onClose]);

  useEffect(() => {
    if (open && taskId) {
      setLoading(true);
      loadTask();
    }
  }, [open, taskId, loadTask]);

  const saveField = async (field: string, value: string) => {
    try {
      await projectTasksAPI.update(projectId, taskId, { [field]: value });
      onUpdated();
    } catch {
      toast.error('Failed to save');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await projectTasksAPI.update(projectId, taskId, { status: newStatus });
      await loadTask();
      onUpdated();
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleToggleFlag = async (field: 'spotlight' | 'at_risk') => {
    if (!task) return;
    try {
      await projectTasksAPI.update(projectId, taskId, { [field]: !task[field] });
      await loadTask();
      onUpdated();
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await projectTasksAPI.uploadAttachment(projectId, taskId, file);
      await loadTask();
      onUpdated();
      toast.success('Attachment uploaded');
    } catch {
      toast.error('Upload failed');
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl w-[95vw] h-[85vh] p-0 overflow-hidden gap-0">
        <DialogTitle className="sr-only">{title || 'Task Detail'}</DialogTitle>

        {loading || !task ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-7 h-7 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex h-full">
            {/* ── Left: Task Info ──────────────────────────────── */}
            <div className="flex-1 overflow-y-auto p-5 pb-6">
              {/* Project name */}
              {projectTitle && (
                <p className="text-xs text-indigo-600 font-medium mb-2">{projectTitle}</p>
              )}

              {/* Title */}
              <div className="flex items-start gap-2.5 mb-3">
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onBlur={() => {
                    if (title !== task.title) saveField('title', title);
                  }}
                  className={cn(
                    'text-xl font-bold font-display border-0 p-0 h-auto shadow-none focus-visible:ring-0',
                    task.completed && 'line-through opacity-50',
                  )}
                />
              </div>

              <TaskFlagControls task={task} onToggle={handleToggleFlag} />

              {/* Metadata row */}
              <div className="flex items-center gap-4 mb-5 flex-wrap text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 uppercase tracking-wide">Assign to</span>
                  <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[9px] font-semibold">
                    {(assignedTo || '?').charAt(0).toUpperCase()}
                  </div>
                  {employees.length > 0 ? (
                    <div className="w-36">
                      <SearchableSelect
                        options={[
                          ...employees.map(e => ({ value: e.name, label: e.name })),
                          { value: '__custom__', label: 'Custom name...' },
                        ]}
                        value={employees.some(e => e.name === assignedTo) ? assignedTo : ''}
                        onValueChange={(v) => {
                          if (v === '__custom__') {
                            const name = prompt('Enter assignee name:');
                            if (name) { setAssignedTo(name); saveField('assigned_to', name); }
                          } else {
                            setAssignedTo(v); saveField('assigned_to', v);
                          }
                        }}
                        placeholder="Unassigned"
                        searchPlaceholder="Search team..."
                        className="text-xs h-7 border-0 shadow-none"
                      />
                    </div>
                  ) : (
                    <Input
                      value={assignedTo}
                      onChange={e => setAssignedTo(e.target.value)}
                      onBlur={() => saveField('assigned_to', assignedTo)}
                      placeholder="Unassigned"
                      className="text-xs border-0 p-0 h-auto w-24 shadow-none focus-visible:ring-0"
                    />
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    onBlur={() => {
                      if (dueDate) saveField('due_date', new Date(dueDate).toISOString());
                    }}
                    className="text-xs border-0 p-0 h-auto shadow-none focus-visible:ring-0 w-28"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 uppercase tracking-wide">Status</span>
                  <select
                    value={task.status || (task.completed ? 'completed' : 'to_do')}
                    onChange={e => handleStatusChange(e.target.value)}
                    className="text-[10px] border rounded px-1.5 py-0.5 bg-white dark:bg-gray-900 dark:border-gray-700"
                  >
                    {TASK_STATUSES.map(s => (
                      <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>

                <Badge className={cn('text-[10px]', PHASE_DOT_COLORS[task.phase])}>
                  {PHASE_LABELS[task.phase]}
                </Badge>
                <select
                  value={owner}
                  onChange={e => {
                    const v = e.target.value as TaskOwner;
                    setOwner(v);
                    saveField('owner', v);
                  }}
                  className="text-[10px] border rounded px-1.5 py-0.5 bg-white dark:bg-gray-900 dark:border-gray-700"
                >
                  <option value="internal">Internal</option>
                  <option value="partner">Partner</option>
                  <option value="both">Both</option>
                </select>
              </div>

              <div className="space-y-5">
                {/* Description */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <FileText className="w-3.5 h-3.5 text-info" aria-hidden="true" />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Description</span>
                  </div>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    onBlur={() => {
                      if (description !== (task.description || '')) {
                        saveField('description', description);
                      }
                    }}
                    rows={4}
                    className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700 resize-y leading-relaxed"
                    placeholder="Add a detailed description..."
                  />
                </div>

                {/* Internal Notes */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Internal Notes</span>
                    <span className="text-[9px] text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">Private</span>
                  </div>
                  <textarea
                    value={details}
                    onChange={e => setDetails(e.target.value)}
                    onBlur={() => {
                      if (details !== (task.details || '')) {
                        saveField('details', details);
                      }
                    }}
                    rows={3}
                    className="w-full text-sm border rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800/30 border-amber-200 resize-y leading-relaxed"
                    placeholder="Private notes (not shared with partners)..."
                  />
                </div>

                {/* Attachments */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Paperclip className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      Attachments ({task.attachments?.length ?? 0})
                    </span>
                  </div>

                  <div className="space-y-1.5 mb-2">
                    {(task.attachments ?? []).map(att => (
                      <Card key={att.id} className="p-2 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{att.filename}</p>
                          <p className="text-[10px] text-slate-400">
                            {att.uploaded_by} &middot; {new Date(att.uploaded_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[9px] shrink-0">
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
                      </Card>
                    ))}
                  </div>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3" /> Add attachment
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleUpload}
                  />
                </div>

                {/* Timestamps */}
                <div className="text-[10px] text-slate-400 pt-2 border-t">
                  Created {new Date(task.created_at).toLocaleString()}
                  {task.completed_at && (
                    <> &middot; Completed {new Date(task.completed_at).toLocaleString()}
                      {task.completed_by && <> by {task.completed_by}</>}
                    </>
                  )}
                </div>
              </div>

              {/* Delete */}
              <div className="mt-6 pt-3 border-t">
                <Button
                  variant="ghost"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 text-xs h-7"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Task
                </Button>
              </div>

              <DeleteTaskDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                onConfirm={handleDelete}
                taskTitle={task.title}
                detailed
              />
            </div>

            {/* ── Right: Conversations ──────────────────────────── */}
            <ConversationsPanel
              comments={task.comments ?? []}
              onPostComment={async (body) => {
                await projectTasksAPI.postComment(projectId, taskId, body);
                await loadTask();
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

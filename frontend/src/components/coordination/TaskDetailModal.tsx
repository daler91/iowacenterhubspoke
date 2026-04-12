import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import {
  Paperclip, Download, FileText, Send, X, Trash2, CalendarDays,
  AlertTriangle, Lock, Star, User as UserIcon, MessageSquare,
} from 'lucide-react';
import { projectTasksAPI } from '../../lib/coordination-api';
import DeleteTaskDialog from './DeleteTaskDialog';
import { TaskDescriptionEditor } from './TaskDescriptionEditor';
import {
  PHASE_LABELS, PHASE_COLORS,
  TASK_STATUSES, TASK_STATUS_LABELS, TASK_STATUS_COLORS,
  TASK_OWNERS, OWNER_LABELS,
  type Task, type TaskOwner, type TaskStatus, type TaskComment,
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

// ── Field Card ───────────────────────────────────────────────────────
// A labeled container used for each metadata field in the header grid.
function FieldCard({
  label, icon, children,
}: Readonly<{ label: string; icon?: React.ReactNode; children: React.ReactNode }>) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-colors hover:border-slate-300 dark:hover:border-slate-600">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      {children}
    </div>
  );
}

// ── Flag Pill Switch ─────────────────────────────────────────────────
// Pill-shaped container holding a label + Radix Switch for Spotlight / At Risk.
function FlagPillSwitch({
  id, label, icon, checked, onCheckedChange, tint,
}: Readonly<{
  id: string;
  label: string;
  icon: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  tint: 'amber' | 'danger';
}>) {
  const activeClasses = tint === 'amber'
    ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800/50'
    : 'border-danger/40 bg-danger-soft';
  const switchCls = tint === 'amber'
    ? 'data-[state=checked]:bg-amber-500'
    : 'data-[state=checked]:bg-danger';
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors cursor-pointer select-none',
        checked
          ? activeClasses
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300',
      )}
    >
      {icon}
      <span className={cn(
        'text-xs font-semibold',
        checked && tint === 'amber' && 'text-amber-700 dark:text-amber-400',
        checked && tint === 'danger' && 'text-danger',
        !checked && 'text-slate-600 dark:text-slate-300',
      )}>
        {label}
      </span>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn('h-4 w-7', switchCls)}
      />
    </label>
  );
}

// ── Conversations Panel ──────────────────────────────────────────────
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
    <div className="w-[360px] shrink-0 border-l-4 border-indigo-300 dark:border-indigo-800/70 bg-gradient-to-b from-indigo-50/80 via-white to-slate-50 dark:from-indigo-950/30 dark:via-slate-900/60 dark:to-slate-900/80 shadow-[inset_6px_0_12px_-6px_rgba(99,102,241,0.25)] dark:shadow-[inset_6px_0_12px_-6px_rgba(99,102,241,0.35)] flex flex-col">
      <div className="px-5 py-4 border-b border-indigo-200/70 dark:border-indigo-900/50 bg-white/60 dark:bg-slate-900/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
            <MessageSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300" />
          </div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 font-display">Conversations</h2>
          {comments.length > 0 && (
            <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/50 px-1.5 py-0.5 rounded-full">
              {comments.length}
            </span>
          )}
        </div>
        {/* The Dialog's built-in close (top-right X) sits in this corner. */}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {groups.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[200px]">
            <p className="text-xs text-muted-foreground">No messages yet</p>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.date}>
              <div className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                <span className="text-[10px] text-muted-foreground font-medium">{group.date}</span>
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
              </div>
              {group.items.map((cmt) => (
                <div key={cmt.id} className="flex gap-2 mb-3">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 mt-0.5',
                    cmt.sender_type === 'partner'
                      ? 'bg-ownership-partner-soft text-ownership-partner'
                      : 'bg-ownership-internal-soft text-ownership-internal',
                  )}>
                    {(cmt.sender_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{cmt.sender_name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(cmt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed whitespace-pre-wrap">{cmt.body}</p>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="p-3 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 rounded-full border-2 border-indigo-200 dark:border-indigo-900/60 focus-within:border-indigo-400 dark:focus-within:border-indigo-600 bg-white dark:bg-slate-900 pl-4 pr-1.5 py-1 transition-colors">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 text-sm bg-transparent border-0 outline-none resize-none py-1.5 placeholder:text-slate-400"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={sending || !body.trim()}
            className="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white h-8 w-8 shrink-0"
            aria-label="Send message"
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

  // Keep a ref to the latest onClose so loadTask doesn't need it in its deps.
  // The parent passes a fresh arrow for onClose on every render, which previously
  // flipped loadTask's identity and made the open-effect flash the spinner on
  // every parent re-render (e.g. after mutateTasks).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

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
      onCloseRef.current();
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId]);

  // loadTask is intentionally omitted from deps: it is stable for the
  // (projectId, taskId) pair via useCallback, and including it would
  // re-trigger the spinner on unrelated parent re-renders.
  useEffect(() => {
    if (open && taskId) {
      setLoading(true);
      loadTask();
    }
  }, [open, taskId, projectId]);

  const saveField = async (field: string, value: string | boolean) => {
    try {
      await projectTasksAPI.update(projectId, taskId, { [field]: value });
      onUpdated();
    } catch {
      toast.error('Failed to save');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!newStatus || !task) return;
    const next = newStatus as TaskStatus;
    const prevStatus = task.status;
    const prevCompleted = task.completed;
    setTask(prev => prev ? { ...prev, status: next, completed: next === 'completed' } : prev);
    try {
      await projectTasksAPI.update(projectId, taskId, { status: newStatus });
      onUpdated();
      // Pull the server-computed completion metadata (completed_at /
      // completed_by) for the footer. We deliberately avoid loadTask()
      // here: loadTask resets ALL local fields (so it would clobber an
      // in-flight blur-save of title/description/details) and its catch
      // closes the modal on any transient fetch error. This narrow merge
      // only touches status/completion fields and silently tolerates a
      // transient failure.
      try {
        const res = await projectTasksAPI.getOne(projectId, taskId);
        const fresh = res.data;
        setTask(prev => {
          if (prev?.status !== next) return prev; // user moved on; don't stomp
          return {
            ...prev,
            status: fresh.status,
            completed: fresh.completed,
            completed_at: fresh.completed_at,
            completed_by: fresh.completed_by,
          };
        });
      } catch {
        // Non-fatal: the PATCH succeeded; the footer metadata will catch
        // up on the next full reload.
      }
    } catch {
      // Roll back optimistic update, but only if the value we optimistically
      // set is still the current one. If a newer status change has superseded
      // us (user changed status twice on a slow link), do not clobber it.
      setTask(prev => {
        if (prev?.status !== next) return prev;
        return { ...prev, status: prevStatus, completed: prevCompleted };
      });
      toast.error('Failed to update status');
    }
  };

  const handleOwnerChange = async (v: string) => {
    if (!v) return;
    const next = v as TaskOwner;
    setOwner(next);
    await saveField('owner', next);
  };

  const handleToggleFlag = async (field: 'spotlight' | 'at_risk', value: boolean) => {
    if (!task) return;
    const prevValue = task[field];
    setTask(prev => prev ? { ...prev, [field]: value } : prev);
    try {
      await projectTasksAPI.update(projectId, taskId, { [field]: value });
      onUpdated();
    } catch {
      // Roll back only if our optimistic value is still current. If the user
      // toggled again before this request failed, the newer value must win.
      setTask(prev => {
        if (prev?.[field] !== value) return prev;
        return { ...prev, [field]: prevValue };
      });
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

  const currentStatus: TaskStatus = (task?.status ?? (task?.completed ? 'completed' : 'to_do')) as TaskStatus;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[85vh] p-0 overflow-hidden gap-0 rounded-2xl shadow-2xl border-slate-200 dark:border-slate-800">
        <DialogTitle className="sr-only">{title || 'Task Detail'}</DialogTitle>

        {loading || !task ? (
          <output
            className="flex items-center justify-center h-full"
            aria-label="Loading task"
          >
            <span className="w-7 h-7 border-2 border-hub border-t-transparent rounded-full animate-spin" />
          </output>
        ) : (
          <div className="flex min-h-0">
            {/* ── Left: Task Info ──────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-7 pt-7 pb-3">
              {/* Project name */}
              {projectTitle && (
                <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold uppercase tracking-wide mb-2">{projectTitle}</p>
              )}

              {/* Title + Flag switches + Phase badge */}
              <div className="flex items-center gap-3 mb-5 flex-wrap">
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onBlur={() => {
                    if (title !== task.title) saveField('title', title);
                  }}
                  className={cn(
                    'text-2xl font-bold font-display border-0 p-0 h-auto shadow-none focus-visible:ring-0 flex-1 min-w-[12rem]',
                    task.completed && 'line-through opacity-50',
                  )}
                />

                <FlagPillSwitch
                  id="task-spotlight-toggle"
                  label="Spotlight"
                  icon={<Star className={cn('w-3.5 h-3.5', task.spotlight ? 'text-amber-500 fill-amber-400' : 'text-slate-400')} />}
                  checked={!!task.spotlight}
                  onCheckedChange={(v) => handleToggleFlag('spotlight', v)}
                  tint="amber"
                />
                <FlagPillSwitch
                  id="task-at-risk-toggle"
                  label="At Risk"
                  icon={<AlertTriangle className={cn('w-3.5 h-3.5', task.at_risk ? 'text-danger' : 'text-slate-400')} />}
                  checked={!!task.at_risk}
                  onCheckedChange={(v) => handleToggleFlag('at_risk', v)}
                  tint="danger"
                />

                <Badge className={cn('text-[11px] px-2.5 py-1 rounded-full text-white border-0', PHASE_COLORS[task.phase])}>
                  {PHASE_LABELS[task.phase]}
                </Badge>
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <FieldCard label="Assign To" icon={<UserIcon className="w-3 h-3 text-slate-400" />}>
                  {employees.length > 0 ? (
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
                      className="h-7 text-sm border-0 shadow-none px-0 bg-transparent dark:bg-transparent"
                    />
                  ) : (
                    <Input
                      value={assignedTo}
                      onChange={e => setAssignedTo(e.target.value)}
                      onBlur={() => saveField('assigned_to', assignedTo)}
                      placeholder="Unassigned"
                      className="text-sm border-0 p-0 h-7 shadow-none focus-visible:ring-0 bg-transparent"
                    />
                  )}
                </FieldCard>

                <FieldCard label="Due Date" icon={<CalendarDays className="w-3 h-3 text-slate-400" />}>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    onBlur={() => {
                      if (dueDate) saveField('due_date', new Date(dueDate).toISOString());
                    }}
                    className="text-sm border-0 p-0 h-7 shadow-none focus-visible:ring-0 bg-transparent"
                  />
                </FieldCard>

                <FieldCard label="Status" icon={<span className={cn('w-2 h-2 rounded-full', TASK_STATUS_COLORS[currentStatus])} />}>
                  <SearchableSelect
                    options={TASK_STATUSES.map(s => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
                    value={currentStatus}
                    onValueChange={handleStatusChange}
                    placeholder="Select status"
                    searchPlaceholder="Search status..."
                    className="h-7 text-sm border-0 shadow-none px-0 bg-transparent dark:bg-transparent"
                  />
                </FieldCard>

                <FieldCard label="Owner">
                  <SearchableSelect
                    options={TASK_OWNERS.map(o => ({ value: o, label: OWNER_LABELS[o] }))}
                    value={owner}
                    onValueChange={handleOwnerChange}
                    placeholder="Select owner"
                    searchPlaceholder="Search..."
                    className="h-7 text-sm border-0 shadow-none px-0 bg-transparent dark:bg-transparent"
                  />
                </FieldCard>
              </div>

              {/* Description (rich text) */}
              <div className="mb-5">
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText className="w-3.5 h-3.5 text-info" aria-hidden="true" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Description</span>
                </div>
                <TaskDescriptionEditor
                  value={description}
                  onBlurSave={(html) => {
                    setDescription(html);
                    if (html !== (task.description || '')) {
                      saveField('description', html);
                    }
                  }}
                  placeholder="Add a detailed description..."
                />
              </div>

              {/* Internal Notes */}
              <div className="mb-5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Lock className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Internal Notes</span>
                  <span className="text-[9px] font-semibold text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Private</span>
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
                  className="w-full text-sm rounded-xl px-3 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 focus-visible:outline-none focus-visible:border-amber-300 resize-y leading-relaxed text-slate-800 dark:text-amber-100 placeholder:text-amber-600/50"
                  placeholder="Private notes (not shared with partners)..."
                />
              </div>

              {/* Attachments */}
              <div className="mb-5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                    Attachments <span className="text-slate-400 normal-case">({task.attachments?.length ?? 0})</span>
                  </span>
                </div>

                {(task.attachments?.length ?? 0) > 0 && (
                  <div className="space-y-1.5 mb-2.5">
                    {(task.attachments ?? []).map(att => (
                      <div
                        key={att.id}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                      >
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">{att.filename}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {att.uploaded_by} &middot; {new Date(att.uploaded_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[9px] shrink-0">
                          {att.file_type.toUpperCase()}
                        </Badge>
                        <a
                          href={projectTasksAPI.downloadAttachmentUrl(projectId, taskId, att.id)}
                          className="text-slate-400 hover:text-indigo-600 p-1 rounded transition-colors"
                          aria-label={`Download ${att.filename}`}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={() => handleDeleteAttachment(att.id)}
                          className="text-slate-400 hover:text-danger p-1 rounded transition-colors"
                          aria-label={`Delete ${att.filename}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 text-xs font-medium border-slate-200 dark:border-slate-700"
                >
                  <Paperclip className="w-3.5 h-3.5 mr-1.5" /> Add File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleUpload}
                />
              </div>

              {/* Timestamps */}
              <div className="text-[10px] text-muted-foreground pt-3 border-t border-slate-200 dark:border-slate-800">
                Created {new Date(task.created_at).toLocaleString()}
                {task.completed_at && (
                  <> &middot; Completed {new Date(task.completed_at).toLocaleString()}
                    {task.completed_by && <> by {task.completed_by}</>}
                  </>
                )}
              </div>

              {/* Delete */}
              <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="border-danger/40 text-danger hover:bg-danger-soft hover:text-danger h-9"
                >
                  <Trash2 className="w-4 h-4 mr-2" /> Delete Task
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

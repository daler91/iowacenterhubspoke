import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import {
  Paperclip, Download, Eye, FileText, Send, X, Trash2, CalendarDays,
  AlertTriangle, Lock, Star, User as UserIcon, MessageSquare, Reply,
} from 'lucide-react';
import { projectTasksAPI } from '../../lib/coordination-api';
import { validateUpload } from '../../lib/upload-constraints';
import { describeUploadError } from '../../lib/error-messages';
import { canPreview, previewKind } from '../../lib/attachment-preview';
import DeleteTaskDialog from './DeleteTaskDialog';
import AttachmentPreviewDialog from './AttachmentPreviewDialog';
import { TaskDescriptionEditor } from './TaskDescriptionEditor';
import MentionTextarea, { renderMentionBody } from './MentionTextarea';
import {
  PHASE_LABELS, PHASE_COLORS,
  TASK_STATUSES, TASK_STATUS_LABELS, TASK_STATUS_COLORS,
  TASK_OWNERS, OWNER_LABELS,
  type Task, type TaskAttachment, type TaskOwner, type TaskStatus,
  type TaskComment, type Mention, type ProjectMember,
} from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SearchableSelect } from '../ui/searchable-select';


function formatCommentDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: '2-digit',
  });
}

function groupCommentsByDate(comments: TaskComment[]) {
  const groups: Array<{ date: string; items: TaskComment[] }> = [];
  let currentDate = '';
  for (const c of comments) {
    const d = formatCommentDate(c.created_at);
    if (d !== currentDate) {
      currentDate = d;
      groups.push({ date: d, items: [] });
    }
    groups.at(-1)!.items.push(c);
  }
  return groups;
}

// Build a map of parent_comment_id → ordered children. Comments whose parent
// is missing from the payload (orphans) are promoted to roots so they remain
// visible. Roots live under the `null` key.
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
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return map;
}

// Collect every descendant of a root and return them as a single flat list
// sorted chronologically. Matches Slack's thread view: one root at the top,
// then every reply (and reply-to-reply) at a shared indent level in the order
// they were posted. The data tree is preserved via `parent_comment_id` so we
// can flip back to a tree view later without a migration.
function collectDescendants(
  rootId: string,
  childrenMap: Map<string | null, TaskComment[]>,
): TaskComment[] {
  const out: TaskComment[] = [];
  const walk = (id: string) => {
    for (const child of childrenMap.get(id) ?? []) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(rootId);
  out.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return out;
}

// Compact relative timestamp for the thread summary bar. Falls back to a
// full date for anything older than ~6 days so "30d ago" doesn't stretch on.
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

// ── Comment Node ─────────────────────────────────────────────────────
// Renders a single comment (root or reply). Never recurses — the caller
// flattens each thread via `collectDescendants` and renders descendants
// inside one expandable container, so the "N replies" summary, the single
// left rail, and the root-only Reply button all live at the thread level.
function CommentNode({
  comment, isRoot, onReply, parentDate,
}: Readonly<{
  comment: TaskComment;
  isRoot: boolean;
  onReply?: (c: TaskComment) => void;
  parentDate: string;
}>) {
  const ownDate = formatCommentDate(comment.created_at);
  const time = new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Replies inherit their root's date header, so when a reply crosses a day
  // boundary relative to its root, surface the date inline so readers don't
  // misread the chronology.
  const crossesDayBoundary = ownDate !== parentDate;
  return (
    <div id={`comment-${comment.id}`} className="flex gap-2 mb-3">
      <div className={cn(
        'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 mt-0.5',
        comment.sender_type === 'partner'
          ? 'bg-ownership-partner-soft text-ownership-partner'
          : 'bg-ownership-internal-soft text-ownership-internal',
      )}>
        {(comment.sender_name || '?').charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{comment.sender_name}</span>
          <span className="text-[10px] text-muted-foreground">
            {crossesDayBoundary ? `${ownDate} · ${time}` : time}
          </span>
          {isRoot && onReply && (
            <button
              type="button"
              onClick={() => onReply(comment)}
              className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 px-1.5 py-0.5 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
              aria-label={`Reply to ${comment.sender_name}`}
            >
              <Reply className="w-3 h-3" /> Reply
            </button>
          )}
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed whitespace-pre-wrap">
          {renderMentionBody(comment.body, comment.mentions)}
        </p>
      </div>
    </div>
  );
}

// ── Thread Summary ───────────────────────────────────────────────────
// Collapsed-thread indicator shown under a root comment when its thread has
// replies but is not expanded. Click expands the replies inline.
function ThreadSummary({
  descendants, onExpand,
}: Readonly<{
  descendants: TaskComment[];
  onExpand: () => void;
}>) {
  // Unique senders in reply order, up to 3 avatars.
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
    <button
      type="button"
      onClick={onExpand}
      className="group ml-9 mb-3 -mt-1 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[11px] text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
    >
      <div className="flex -space-x-1.5">
        {avatars.map(a => (
          <span
            key={a.id}
            className={cn(
              'w-5 h-5 rounded-md border border-white dark:border-slate-900 flex items-center justify-center text-[9px] font-semibold',
              a.sender_type === 'partner'
                ? 'bg-ownership-partner-soft text-ownership-partner'
                : 'bg-ownership-internal-soft text-ownership-internal',
            )}
          >
            {(a.sender_name || '?').charAt(0).toUpperCase()}
          </span>
        ))}
      </div>
      <span className="font-semibold group-hover:underline">
        {count} {count === 1 ? 'reply' : 'replies'}
      </span>
      {last && (
        <span className="text-[10px] text-muted-foreground font-normal">
          Last reply {timeAgo(last.created_at)}
        </span>
      )}
    </button>
  );
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
function ConversationsPanel({ comments, members, onPostComment }: Readonly<{
  comments: TaskComment[];
  members: readonly ProjectMember[];
  onPostComment: (
    body: string,
    parentCommentId?: string | null,
    mentions?: Mention[],
  ) => Promise<string | null | void>;
}>) {
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<TaskComment | null>(null);
  const [lastPostedId, setLastPostedId] = useState<string | null>(null);
  // Root comment ids whose thread is currently expanded. Threads default to
  // collapsed (Slack-style summary) and open on demand — either by clicking
  // the summary bar, by clicking Reply on the root, or after posting a reply
  // (so the new message renders under the existing open thread).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);
  const childrenMap = buildChildrenMap(comments);
  const roots = childrenMap.get(null) ?? [];
  const groups = groupCommentsByDate(roots);

  const openThread = (rootId: string) =>
    setExpanded(prev => {
      if (prev.has(rootId)) return prev;
      const next = new Set(prev);
      next.add(rootId);
      return next;
    });
  const toggleThread = (rootId: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId); else next.add(rootId);
      return next;
    });

  // When a reply is posted to an older thread, the new node renders somewhere
  // mid-panel rather than at the end. Scroll to the specific new comment when
  // we know its id; otherwise fall back to the end-ref behavior so initial
  // load and brand-new root comments still pin to the bottom.
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
      // Capture before clearing so we can expand the target thread after the
      // post completes — otherwise the scroll-to-new-comment effect runs
      // against a collapsed thread and can't find the element.
      const target = replyingTo;
      const newId = await onPostComment(body.trim(), target?.id ?? null, mentions);
      setBody('');
      setMentions([]);
      setReplyingTo(null);
      if (target) openThread(target.id);
      if (typeof newId === 'string') setLastPostedId(newId);
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
              {group.items.map(root => {
                const descendants = collectDescendants(root.id, childrenMap);
                const hasReplies = descendants.length > 0;
                const isExpanded = expanded.has(root.id);
                const rootDate = formatCommentDate(root.created_at);
                return (
                  <div
                    key={root.id}
                    className={cn(
                      'rounded-lg mb-2 transition-colors',
                      hasReplies && 'bg-white/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 p-2',
                    )}
                  >
                    <CommentNode
                      comment={root}
                      isRoot
                      onReply={(c) => { setReplyingTo(c); openThread(c.id); }}
                      parentDate={group.date}
                    />
                    {hasReplies && !isExpanded && (
                      <ThreadSummary
                        descendants={descendants}
                        onExpand={() => toggleThread(root.id)}
                      />
                    )}
                    {hasReplies && isExpanded && (
                      <div className="ml-4 border-l border-indigo-100 dark:border-indigo-900/50 pl-3 mt-1">
                        {descendants.map(d => (
                          <CommentNode
                            key={d.id}
                            comment={d}
                            isRoot={false}
                            parentDate={rootDate}
                          />
                        ))}
                        <button
                          type="button"
                          onClick={() => toggleThread(root.id)}
                          className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 hover:underline mb-1"
                        >
                          Hide replies
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="p-3 border-t border-slate-200 dark:border-slate-800">
        {replyingTo && (
          <div className="flex items-center gap-1.5 mb-2 px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800/60 text-[11px] text-indigo-700 dark:text-indigo-300 w-fit max-w-full">
            <Reply className="w-3 h-3 shrink-0" />
            <span className="truncate">
              Replying to <span className="font-semibold">{replyingTo.sender_name}</span>
            </span>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="ml-0.5 p-0.5 rounded hover:bg-indigo-100 dark:hover:bg-indigo-800/60 transition-colors shrink-0"
              aria-label="Cancel reply"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-full border-2 border-indigo-200 dark:border-indigo-900/60 focus-within:border-indigo-400 dark:focus-within:border-indigo-600 bg-white dark:bg-slate-900 pl-4 pr-1.5 py-1 transition-colors">
          <MentionTextarea
            value={body}
            mentions={mentions}
            members={members}
            onChange={(b, m) => { setBody(b); setMentions(m); }}
            onSubmit={handleSend}
            placeholder={replyingTo ? `Reply to ${replyingTo.sender_name}...` : 'Type a message — @ to mention...'}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={sending || !body.trim()}
            className="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white h-8 w-8 shrink-0"
            aria-label="Send message"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
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
  const [members, setMembers] = useState<ProjectMember[]>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [owner, setOwner] = useState<TaskOwner>('internal');
  const [assignedTo, setAssignedTo] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [previewing, setPreviewing] = useState<TaskAttachment | null>(null);
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

  // Load the mentionable member list once per open(project). Failures are
  // silent: an empty list just hides the @ popover.
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    projectTasksAPI.getMembers(projectId).then(res => {
      if (!cancelled) setMembers(res.data?.items ?? []);
    }).catch(() => {
      if (!cancelled) setMembers([]);
    });
    return () => { cancelled = true; };
  }, [open, projectId]);

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
    const originalId = task.id;
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
          // Don't merge into a different task: the modal may have switched
          // to another task (close + reopen) while this refresh was in
          // flight. Also bail if the user moved status on again.
          if (prev?.id !== fresh.id || prev.status !== next) return prev;
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
      // Roll back optimistic update, but only if we're still on the same
      // task AND the value we optimistically set is still current. Skip if
      // the modal has switched tasks or the user has moved status on again.
      setTask(prev => {
        if (prev?.id !== originalId || prev.status !== next) return prev;
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
    const originalId = task.id;
    const prevValue = task[field];
    setTask(prev => prev ? { ...prev, [field]: value } : prev);
    try {
      await projectTasksAPI.update(projectId, taskId, { [field]: value });
      onUpdated();
    } catch {
      // Roll back only if we're still on the same task AND our optimistic
      // value is still current. Skip if the modal switched tasks or the
      // user toggled again before this request failed.
      setTask(prev => {
        if (prev?.id !== originalId || prev[field] !== value) return prev;
        return { ...prev, [field]: prevValue };
      });
      toast.error('Failed to update');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always reset the input so selecting the same file again re-fires change.
    const resetInput = () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    if (!file) {
      resetInput();
      return;
    }
    const reason = validateUpload(file);
    if (reason) {
      toast.error(reason);
      resetInput();
      return;
    }
    try {
      await projectTasksAPI.uploadAttachment(projectId, taskId, file);
      await loadTask();
      onUpdated();
      toast.success('Attachment uploaded');
    } catch (err) {
      toast.error(describeUploadError(err, 'Upload failed'));
    }
    resetInput();
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
                        {canPreview(att.file_type) && (
                          <button
                            type="button"
                            onClick={() => setPreviewing(att)}
                            className="text-slate-400 hover:text-indigo-600 p-1 rounded transition-colors"
                            aria-label={`Preview ${att.filename}`}
                          >
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                        <a
                          href={projectTasksAPI.downloadAttachmentUrl(projectId, taskId, att.id)}
                          className="text-slate-400 hover:text-indigo-600 p-1 rounded transition-colors"
                          aria-label={`Download ${att.filename}`}
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        </a>
                        <button
                          onClick={() => handleDeleteAttachment(att.id)}
                          className="text-slate-400 hover:text-danger p-1 rounded transition-colors"
                          aria-label={`Delete ${att.filename}`}
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
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

              {previewing && previewKind(previewing.file_type) && (
                <AttachmentPreviewDialog
                  open={true}
                  onOpenChange={(open) => { if (!open) setPreviewing(null); }}
                  filename={previewing.filename}
                  kind={previewKind(previewing.file_type)!}
                  url={projectTasksAPI.previewAttachmentUrl(projectId, taskId, previewing.id)}
                />
              )}
            </div>

            {/* ── Right: Conversations ──────────────────────────── */}
            <ConversationsPanel
              comments={task.comments ?? []}
              members={members}
              onPostComment={async (body, parentCommentId, mentions) => {
                const res = await projectTasksAPI.postComment(
                  projectId, taskId, body, parentCommentId, mentions,
                );
                await loadTask();
                return res.data?.id ?? null;
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

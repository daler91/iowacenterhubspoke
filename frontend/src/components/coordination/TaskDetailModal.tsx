import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import { Card } from '../ui/card';
import {
  Check, Paperclip, Upload, Download,
  FileText, Send, X, Trash2, CalendarDays,
} from 'lucide-react';
import { projectTasksAPI } from '../../lib/coordination-api';
import {
  PHASE_LABELS, PHASE_DOT_COLORS,
  type Task, type TaskOwner,
} from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';


function groupCommentsByDate(comments: Array<{ created_at: string; [k: string]: unknown }>) {
  const groups: Array<{ date: string; items: typeof comments }> = [];
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


interface Props {
  readonly projectId: string;
  readonly taskId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onUpdated: () => void;
  readonly projectTitle?: string;
}

export default function TaskDetailModal({
  projectId, taskId, open, onClose, onUpdated, projectTitle,
}: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'additional'>('info');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [owner, setOwner] = useState<TaskOwner>('internal');
  const [assignedTo, setAssignedTo] = useState('');

  const [commentBody, setCommentBody] = useState('');
  const [sending, setSending] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);
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
      setActiveTab('info');
      loadTask();
    }
  }, [open, taskId, loadTask]);

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [task?.comments?.length]);

  const saveField = async (field: string, value: string) => {
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

  const handlePostComment = async () => {
    if (!commentBody.trim()) return;
    setSending(true);
    try {
      await projectTasksAPI.postComment(projectId, taskId, commentBody.trim());
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

  const commentGroups = task ? groupCommentsByDate(task.comments ?? []) : [];

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
                <button
                  onClick={handleToggleComplete}
                  className={cn(
                    'w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors',
                    task.completed
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'border-slate-300 hover:border-indigo-400',
                  )}
                >
                  {task.completed && <Check className="w-3.5 h-3.5" />}
                </button>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onBlur={() => {
                    if (title !== task.title) saveField('title', title);
                  }}
                  className={cn(
                    'text-xl font-bold border-0 p-0 h-auto shadow-none focus-visible:ring-0',
                    task.completed && 'line-through opacity-50',
                  )}
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                />
              </div>

              {/* Metadata row */}
              <div className="flex items-center gap-4 mb-5 flex-wrap text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 uppercase tracking-wide">Assign to</span>
                  <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[9px] font-semibold">
                    {(assignedTo || '?').charAt(0).toUpperCase()}
                  </div>
                  <Input
                    value={assignedTo}
                    onChange={e => setAssignedTo(e.target.value)}
                    onBlur={() => saveField('assigned_to', assignedTo)}
                    placeholder="Unassigned"
                    className="text-xs border-0 p-0 h-auto w-24 shadow-none focus-visible:ring-0"
                  />
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

                {task.completed ? (
                  <Badge className="bg-green-100 text-green-700 text-[10px]">
                    <Check className="w-2.5 h-2.5 mr-0.5" /> Completed
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">In progress</Badge>
                )}

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

              {/* Tabs */}
              <div className="border-b mb-4">
                <div className="flex gap-5">
                  <button
                    onClick={() => setActiveTab('info')}
                    className={cn(
                      'pb-1.5 text-xs font-medium border-b-2 transition-colors',
                      activeTab === 'info'
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-slate-400 hover:text-slate-600',
                    )}
                  >
                    Task Info
                  </button>
                  <button
                    onClick={() => setActiveTab('additional')}
                    className={cn(
                      'pb-1.5 text-xs font-medium border-b-2 transition-colors',
                      activeTab === 'additional'
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-slate-400 hover:text-slate-600',
                    )}
                  >
                    Additional Info
                  </button>
                </div>
              </div>

              {activeTab === 'info' ? (
                <div className="space-y-5">
                  {/* Description */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
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
                      rows={5}
                      className="w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 dark:border-gray-700 resize-y leading-relaxed"
                      placeholder="Add a detailed description..."
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
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5 block">
                      Notes / Details
                    </Label>
                    <textarea
                      value={details}
                      onChange={e => setDetails(e.target.value)}
                      onBlur={() => {
                        if (details !== (task.details || '')) {
                          saveField('details', details);
                        }
                      }}
                      rows={4}
                      className="w-full text-sm border rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800/30 border-amber-200 resize-y leading-relaxed"
                      placeholder="Private notes..."
                    />
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Created {new Date(task.created_at).toLocaleString()}
                    {task.completed_at && (
                      <> &middot; Completed {new Date(task.completed_at).toLocaleString()}
                        {task.completed_by && <> by {task.completed_by}</>}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Delete */}
              <div className="mt-6 pt-3 border-t">
                <Button
                  variant="ghost"
                  onClick={handleDelete}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 text-xs h-7"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Task
                </Button>
              </div>
            </div>

            {/* ── Right: Conversations ──────────────────────────── */}
            <div className="w-[340px] shrink-0 border-l bg-gray-50/50 dark:bg-gray-900/30 flex flex-col">
              <div className="px-4 py-3 border-b">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Conversations
                </h2>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                {commentGroups.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-6">No messages yet</p>
                )}
                {commentGroups.map(group => (
                  <div key={group.date}>
                    <div className="flex items-center gap-2 my-3">
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                      <span className="text-[10px] text-slate-400 font-medium">{group.date}</span>
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                    </div>

                    {group.items.map((cmt: Record<string, unknown>) => (
                      <div key={cmt.id as string} className="flex gap-2 mb-3">
                        <div className={cn(
                          'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5',
                          cmt.sender_type === 'partner'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700',
                        )}>
                          {((cmt.sender_name as string) || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                              {cmt.sender_name as string}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {new Date(cmt.created_at as string).toLocaleTimeString([], {
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                            {cmt.body as string}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                <div ref={commentsEndRef} />
              </div>

              <div className="border-t p-3">
                <div className="flex gap-1.5">
                  <textarea
                    value={commentBody}
                    onChange={e => setCommentBody(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handlePostComment();
                      }
                    }}
                    placeholder="Type a message..."
                    rows={1}
                    className="flex-1 text-xs border rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 resize-none"
                  />
                  <Button
                    size="sm"
                    onClick={handlePostComment}
                    disabled={sending || !commentBody.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white h-auto self-end px-2.5 py-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

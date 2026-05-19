import { useEffect, useMemo, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { CalendarDays, Download, Eye, FileText, Paperclip } from 'lucide-react';
import { SearchableSelect } from '../ui/searchable-select';
import { portalAPI } from '../../lib/coordination-api';
import { OWNER_COLORS, OWNER_LABELS, PHASE_COLORS, PHASE_LABELS, TASK_STATUSES, TASK_STATUS_COLORS, TASK_STATUS_LABELS, type Mention, type Task, type TaskAttachment, type TaskComment, type ProjectMember, type TaskStatus } from '../../lib/coordination-types';
import { canPreview, previewKind } from '../../lib/attachment-preview';
import AttachmentPreviewDialog from '../coordination/AttachmentPreviewDialog';
import { cn } from '../../lib/utils';
import { formatCalendarDate } from '../../lib/date-format';
import { toast } from 'sonner';
import { ConversationsPanel } from '../coordination/TaskDetailModal';
import { describeApiError } from '../../lib/error-messages';
import { runPortalAsync } from './async';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  taskId: string;
  token: string;
  onRefresh: () => Promise<void> | void;
}

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

function attachmentActionKey(action: 'preview' | 'download', attachmentId: string) {
  return `${action}:${attachmentId}`;
}

function hasTaskWriteAccess(task: Task | null) {
  return task?.owner === 'partner' || task?.owner === 'both';
}

function TaskDetailsLoading() {
  return (
    <output className="block p-6 text-sm text-muted-foreground" aria-live="polite">
      Loading details...
    </output>
  );
}

function TaskDetailsError({
  message,
  onRetry,
}: Readonly<{
  message: string;
  onRetry: () => void;
}>) {
  return (
    <div className="p-6" role="alert">
      <p className="text-sm font-medium text-danger-strong">Task details could not be loaded.</p>
      <p className="text-sm text-foreground/80 mt-1">{message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Retry task details
      </Button>
    </div>
  );
}

function TaskStatusCard({
  taskStatus,
  canEditStatus,
  statusPending,
  onStatusChange,
}: Readonly<{
  taskStatus: TaskStatus;
  canEditStatus: boolean;
  statusPending: boolean;
  onStatusChange: (nextStatus: string) => void;
}>) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground mb-1">Status</p>
      {canEditStatus ? (
        <>
          <SearchableSelect
            id="portal-task-status"
            value={taskStatus}
            onValueChange={onStatusChange}
            options={TASK_STATUSES.map(s => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
            placeholder="Select status"
            searchPlaceholder="Search status..."
            className={cn('h-8', statusPending && 'pointer-events-none opacity-60')}
          />
          {statusPending && (
            <output className="mt-1 block text-xs text-muted-foreground" aria-live="polite">
              Saving status...
            </output>
          )}
        </>
      ) : (
        <p className="text-sm font-medium flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full', TASK_STATUS_COLORS[taskStatus])} />
          {TASK_STATUS_LABELS[taskStatus]}
        </p>
      )}
    </Card>
  );
}

function TaskHeader({
  task,
  taskStatus,
  canEditStatus,
  statusPending,
  onStatusChange,
}: Readonly<{
  task: Task;
  taskStatus: TaskStatus;
  canEditStatus: boolean;
  statusPending: boolean;
  onStatusChange: (nextStatus: string) => void;
}>) {
  return (
    <div className="p-5 pr-14 border-b space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-lg font-semibold">{task.title}</h3>
        <div className="flex items-center gap-2">
          <Badge className={cn('text-[10px] px-1.5', OWNER_COLORS[task.owner])}>{OWNER_LABELS[task.owner]}</Badge>
          <Badge className={cn('text-[10px] px-1.5 text-white', PHASE_COLORS[task.phase])}>{PHASE_LABELS[task.phase]}</Badge>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TaskStatusCard
          taskStatus={taskStatus}
          canEditStatus={canEditStatus}
          statusPending={statusPending}
          onStatusChange={onStatusChange}
        />
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Due date</p>
          <p className="text-sm font-medium">
            <CalendarDays className="w-3.5 h-3.5 inline mr-1" />
            {formatCalendarDate(task.due_date)}
          </p>
        </Card>
      </div>
    </div>
  );
}

function AttachmentUploadControl({
  canUpload,
  uploading,
  onUpload,
}: Readonly<{
  canUpload: boolean;
  uploading: boolean;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}>) {
  return (
    <label className={cn('text-xs', (!canUpload || uploading) && 'opacity-60')} aria-disabled={!canUpload || uploading}>
      <input type="file" className="hidden" disabled={!canUpload || uploading} onChange={onUpload} />
      <span className={cn('inline-flex items-center gap-1', canUpload && !uploading ? 'cursor-pointer' : 'cursor-not-allowed')}>
        <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
        {uploading ? 'Uploading...' : 'Upload'}
      </span>
    </label>
  );
}

function AttachmentRow({
  attachment,
  previewPending,
  downloadPending,
  onPreview,
  onDownload,
}: Readonly<{
  attachment: TaskAttachment;
  previewPending: boolean;
  downloadPending: boolean;
  onPreview: (attachment: TaskAttachment) => void;
  onDownload: (attachment: TaskAttachment) => void;
}>) {
  return (
    <div className="flex items-center gap-2 border rounded-md p-2">
      <FileText className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{attachment.filename}</p>
      </div>
      {canPreview(attachment.file_type) && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onPreview(attachment)}
          disabled={previewPending}
          aria-label={`Preview ${attachment.filename}`}
        >
          <Eye className="w-4 h-4" aria-hidden="true" />
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => onDownload(attachment)}
        disabled={downloadPending}
        aria-label={`Download ${attachment.filename}`}
      >
        <Download className="w-4 h-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

function AttachmentsCard({
  attachments,
  canUpload,
  uploading,
  attachmentActionIds,
  onUpload,
  onPreview,
  onDownload,
}: Readonly<{
  attachments: readonly TaskAttachment[];
  canUpload: boolean;
  uploading: boolean;
  attachmentActionIds: Record<string, boolean>;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onPreview: (attachment: TaskAttachment) => void;
  onDownload: (attachment: TaskAttachment) => void;
}>) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold">Attachments</p>
        <AttachmentUploadControl canUpload={canUpload} uploading={uploading} onUpload={onUpload} />
      </div>
      <div className="space-y-2">
        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No attachments.</p>
        ) : (
          attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              previewPending={!!attachmentActionIds[attachmentActionKey('preview', attachment.id)]}
              downloadPending={!!attachmentActionIds[attachmentActionKey('download', attachment.id)]}
              onPreview={onPreview}
              onDownload={onDownload}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function LoadedTaskDetails({
  task,
  taskStatus,
  canEditStatus,
  statusPending,
  canUpload,
  uploading,
  attachments,
  attachmentActionIds,
  sortedComments,
  members,
  onStatusChange,
  onUpload,
  onPreviewAttachment,
  onDownloadAttachment,
  onPostComment,
}: Readonly<{
  task: Task;
  taskStatus: TaskStatus;
  canEditStatus: boolean;
  statusPending: boolean;
  canUpload: boolean;
  uploading: boolean;
  attachments: readonly TaskAttachment[];
  attachmentActionIds: Record<string, boolean>;
  sortedComments: TaskComment[];
  members: readonly ProjectMember[];
  onStatusChange: (nextStatus: string) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onPreviewAttachment: (attachment: TaskAttachment) => void;
  onDownloadAttachment: (attachment: TaskAttachment) => void;
  onPostComment: (
    body: string,
    parentCommentId?: string | null,
    mentions?: Mention[],
  ) => Promise<string | null | void>;
}>) {
  return (
    <div className="flex flex-col h-full max-h-[85vh]">
      <TaskHeader
        task={task}
        taskStatus={taskStatus}
        canEditStatus={canEditStatus}
        statusPending={statusPending}
        onStatusChange={onStatusChange}
      />

      <div className="p-5 overflow-y-auto">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 space-y-4 min-w-0">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Description</p>
              <p className="text-sm whitespace-pre-wrap">{task.description || 'No description provided.'}</p>
            </Card>
            <AttachmentsCard
              attachments={attachments}
              canUpload={canUpload}
              uploading={uploading}
              attachmentActionIds={attachmentActionIds}
              onUpload={onUpload}
              onPreview={onPreviewAttachment}
              onDownload={onDownloadAttachment}
            />
          </div>
          <ConversationsPanel
            comments={sortedComments}
            members={members}
            onPostComment={onPostComment}
          />
        </div>
      </div>
    </div>
  );
}

function TaskDialogBody({
  loading,
  loadError,
  task,
  taskStatus,
  canEditStatus,
  statusPending,
  canUpload,
  uploading,
  attachments,
  attachmentActionIds,
  sortedComments,
  members,
  onRetry,
  onStatusChange,
  onUpload,
  onPreviewAttachment,
  onDownloadAttachment,
  onPostComment,
}: Readonly<{
  loading: boolean;
  loadError: string;
  task: Task | null;
  taskStatus: TaskStatus;
  canEditStatus: boolean;
  statusPending: boolean;
  canUpload: boolean;
  uploading: boolean;
  attachments: readonly TaskAttachment[];
  attachmentActionIds: Record<string, boolean>;
  sortedComments: TaskComment[];
  members: readonly ProjectMember[];
  onRetry: () => void;
  onStatusChange: (nextStatus: string) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onPreviewAttachment: (attachment: TaskAttachment) => void;
  onDownloadAttachment: (attachment: TaskAttachment) => void;
  onPostComment: (
    body: string,
    parentCommentId?: string | null,
    mentions?: Mention[],
  ) => Promise<string | null | void>;
}>) {
  if (loading) return <TaskDetailsLoading />;
  if (loadError || !task) {
    return <TaskDetailsError message={loadError || 'The task is unavailable.'} onRetry={onRetry} />;
  }
  return (
    <LoadedTaskDetails
      task={task}
      taskStatus={taskStatus}
      canEditStatus={canEditStatus}
      statusPending={statusPending}
      canUpload={canUpload}
      uploading={uploading}
      attachments={attachments}
      attachmentActionIds={attachmentActionIds}
      sortedComments={sortedComments}
      members={members}
      onStatusChange={onStatusChange}
      onUpload={onUpload}
      onPreviewAttachment={onPreviewAttachment}
      onDownloadAttachment={onDownloadAttachment}
      onPostComment={onPostComment}
    />
  );
}

export default function PortalTaskDetailModal({ open, onOpenChange, projectId, taskId, token, onRefresh }: Readonly<Props>) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [task, setTask] = useState<Task | null>(null);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [previewing, setPreviewing] = useState<{ attachment: TaskAttachment; url: string } | null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachmentActionIds, setAttachmentActionIds] = useState<Record<string, boolean>>({});

  const canUpload = hasTaskWriteAccess(task);

  const refreshComments = async () => {
    const commentRes = await portalAPI.taskComments(projectId, taskId, token);
    setComments((commentRes.data?.items || []) as TaskComment[]);
  };

  const loadData = async () => {
    if (!open || !token) return;
    setLoading(true);
    setLoadError('');
    try {
      const [detailRes, attachmentRes, memberRes] = await Promise.all([
        portalAPI.taskDetail(projectId, taskId, token),
        portalAPI.taskAttachments(projectId, taskId, token),
        portalAPI.projectMembers(projectId, token),
      ]);
      setTask(detailRes.data as Task);
      setAttachments((attachmentRes.data?.items || []) as TaskAttachment[]);
      await refreshComments();
      setMembers((memberRes.data?.items || []) as ProjectMember[]);
    } catch (err) {
      setLoadError(describeApiError(err, "We couldn't load task details."));
      setTask(null);
      toast.error('Failed to load task details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runPortalAsync(loadData(), 'load portal task details');
  }, [open, projectId, taskId, token]);

  const sortedComments = useMemo(() => [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at)), [comments]);

  const taskStatus: TaskStatus = (task?.completed ? 'completed' : (task?.status || 'to_do')) as TaskStatus;
  const canEditStatus = hasTaskWriteAccess(task);

  const handleStatusChange = async (nextStatus: string) => {
    if (!task || !canEditStatus || statusPending) return;
    const status = nextStatus as TaskStatus;
    const previous = taskStatus;
    if (status === previous) return;
    const completed = status === 'completed';
    setTask(prev => prev ? { ...prev, status, completed } : prev);
    setStatusPending(true);
    try {
      await portalAPI.updateTask(projectId, taskId, token, { status, completed });
      await onRefresh();
    } catch (err) {
      setTask(prev => prev ? { ...prev, status: previous, completed: previous === 'completed' } : prev);
      toast.error(describeApiError(err, 'Failed to update task status'));
    } finally {
      setStatusPending(false);
    }
  };

  const changeStatus = (nextStatus: string) => {
    runPortalAsync(handleStatusChange(nextStatus), 'update portal task status');
  };

  const uploadAttachment = async (file: File | undefined, input: HTMLInputElement) => {
    if (!file || !canUpload || uploading) return;
    setUploading(true);
    try {
      await portalAPI.uploadTaskAttachment(projectId, taskId, token, file);
      toast.success('Attachment uploaded');
      await loadData();
      await onRefresh();
    } catch (err) {
      toast.error(describeApiError(err, 'Upload failed'));
    } finally {
      setUploading(false);
      input.value = '';
    }
  };

  const handleAttachmentUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    runPortalAsync(uploadAttachment(input.files?.[0], input), 'upload portal task attachment');
  };

  const handlePreviewAttachment = async (attachment: TaskAttachment) => {
    const key = attachmentActionKey('preview', attachment.id);
    if (attachmentActionIds[key]) return;
    setPendingKey(setAttachmentActionIds, key, true);
    try {
      const res = await portalAPI.previewTaskAttachment(projectId, taskId, attachment.id, token);
      const contentType = (res.headers?.['content-type'] as string | undefined) ?? '';
      const blob = new Blob([res.data], contentType ? { type: contentType } : undefined);
      setPreviewing({ attachment, url: URL.createObjectURL(blob) });
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't load that preview."));
    } finally {
      setPendingKey(setAttachmentActionIds, key, false);
    }
  };

  const handleDownloadAttachment = async (attachment: TaskAttachment) => {
    const key = attachmentActionKey('download', attachment.id);
    if (attachmentActionIds[key]) return;
    setPendingKey(setAttachmentActionIds, key, true);
    try {
      const res = await portalAPI.downloadTaskAttachment(projectId, taskId, attachment.id, token);
      const url = URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(describeApiError(err, 'Download failed'));
    } finally {
      setPendingKey(setAttachmentActionIds, key, false);
    }
  };

  const handleRetry = () => {
    runPortalAsync(loadData(), 'retry portal task details');
  };

  const previewAttachment = (attachment: TaskAttachment) => {
    runPortalAsync(handlePreviewAttachment(attachment), 'preview portal task attachment');
  };

  const downloadAttachment = (attachment: TaskAttachment) => {
    runPortalAsync(handleDownloadAttachment(attachment), 'download portal task attachment');
  };

  const handlePostComment = async (
    body: string,
    parentCommentId?: string | null,
    mentions?: Mention[],
  ) => {
    const postRes = await portalAPI.postTaskComment(
      projectId,
      taskId,
      token,
      body,
      mentions ?? [],
      parentCommentId ?? undefined,
    );
    await refreshComments();
    return (postRes.data as { id?: string } | undefined)?.id ?? null;
  };

  const handlePreviewOpenChange = (nextOpen: boolean) => {
    if (nextOpen) return;
    if (previewing) URL.revokeObjectURL(previewing.url);
    setPreviewing(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-5xl w-[95vw] max-h-[85vh] p-0 overflow-hidden gap-0 rounded-2xl">
          <DialogTitle className="sr-only">Task details</DialogTitle>
          <DialogDescription className="sr-only">
            Review task status, attachments, and comments.
          </DialogDescription>
          <TaskDialogBody
            loading={loading}
            loadError={loadError}
            task={task}
            taskStatus={taskStatus}
            canEditStatus={canEditStatus}
            statusPending={statusPending}
            canUpload={canUpload}
            uploading={uploading}
            attachments={attachments}
            attachmentActionIds={attachmentActionIds}
            sortedComments={sortedComments}
            members={members}
            onRetry={handleRetry}
            onStatusChange={changeStatus}
            onUpload={handleAttachmentUpload}
            onPreviewAttachment={previewAttachment}
            onDownloadAttachment={downloadAttachment}
            onPostComment={handlePostComment}
          />
        </DialogContent>
      </Dialog>
      <AttachmentPreviewDialog
        open={!!previewing}
        onOpenChange={handlePreviewOpenChange}
        url={previewing?.url || ''}
        kind={previewing ? previewKind(previewing.attachment.file_type) ?? 'pdf' : 'pdf'}
        filename={previewing?.attachment.filename || ''}
      />
    </>
  );
}

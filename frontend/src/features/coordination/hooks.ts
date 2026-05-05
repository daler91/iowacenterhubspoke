import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { coordinationFeatureApi } from './api';
import type { TaskCommentDraft, TaskCommentPayload } from './types';
import { describeApiError } from '../../lib/error-messages';

function toPayload(draft: TaskCommentDraft): TaskCommentPayload {
  return {
    body: draft.body,
    mentions: draft.mentions,
    ...(draft.parentCommentId ? { parent_comment_id: draft.parentCommentId } : {}),
  };
}

export function useTaskCommentActions(projectId: string, taskId: string, onRefresh: () => Promise<unknown> | void) {
  const [submitting, setSubmitting] = useState(false);

  const submitComment = useCallback(async (draft: TaskCommentDraft) => {
    if (!draft.body.trim()) return null;
    setSubmitting(true);
    try {
      const res = await coordinationFeatureApi.postComment(projectId, taskId, toPayload(draft));
      await onRefresh();
      return res.data?.id ?? null;
    } catch (error) {
      toast.error(describeApiError(error, 'Could not add comment.'));
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [onRefresh, projectId, taskId]);

  return { submitting, submitComment };
}

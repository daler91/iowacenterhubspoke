import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { projectTasksAPI } from '../lib/coordination-api';
import type { Mention } from '../lib/coordination-types';
import { describeApiError } from '../lib/error-messages';

export type TaskCommentDraft = {
  body: string;
  mentions: Mention[];
  parentCommentId?: string | null;
};

/**
 * Posts a task comment (optionally as a reply) and refreshes the thread.
 * Rethrows after toasting so the caller can keep the draft on screen instead
 * of clearing an unsent comment.
 */
export function useTaskCommentActions(projectId: string, taskId: string, onRefresh: () => Promise<unknown> | void) {
  const [submitting, setSubmitting] = useState(false);

  const submitComment = useCallback(async (draft: TaskCommentDraft) => {
    if (!draft.body.trim()) return null;
    setSubmitting(true);
    try {
      const res = await projectTasksAPI.postComment(
        projectId,
        taskId,
        draft.body,
        draft.parentCommentId ?? undefined,
        draft.mentions,
      );
      await onRefresh();
      return res.data?.id ?? null;
    } catch (error) {
      toast.error(describeApiError(error, 'Could not add comment.'));
      throw error;
    } finally {
      setSubmitting(false);
    }
  }, [onRefresh, projectId, taskId]);

  return { submitting, submitComment };
}

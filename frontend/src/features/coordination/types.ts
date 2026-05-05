import type { Mention, TaskComment } from '../../lib/coordination-types';

export type TaskCommentDraft = {
  body: string;
  mentions: Mention[];
  parentCommentId?: string | null;
};

export type TaskCommentPayload = {
  body: string;
  mentions: Mention[];
  parent_comment_id?: string;
};

export type TaskCommentCollection = TaskComment[];

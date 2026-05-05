import { projectTasksAPI } from '../../lib/coordination-api';
import type { TaskCommentPayload } from './types';

export const coordinationFeatureApi = {
  postComment: (projectId: string, taskId: string, payload: TaskCommentPayload) =>
    projectTasksAPI.postComment(projectId, taskId, payload.body, payload.parent_comment_id, payload.mentions),
  listComments: (taskId: string) => projectTasksAPI.comments(taskId),
};

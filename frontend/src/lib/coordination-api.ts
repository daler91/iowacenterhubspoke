import api from './api';

// ── Projects ─────────────────────────────────────────────────────────

export const projectsAPI = {
  getAll: (params?: Record<string, unknown>) => api.get('/projects', { params }),
  getOne: (id: string) => api.get(`/projects/${id}`),
  create: (data: Record<string, unknown>) => api.post('/projects', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/projects/${id}`, data),
  delete: (id: string) => api.delete(`/projects/${id}`),
  advancePhase: (id: string, force?: boolean) =>
    api.post(`/projects/${id}/advance-phase`, { force: force ?? false }),
  getBoard: (params?: Record<string, unknown>) => api.get('/projects/board', { params }),
  getDashboard: () => api.get('/projects/dashboard'),
};

// ── Project Templates ────────────────────────────────────────────────

export const templatesAPI = {
  getAll: () => api.get('/project-templates'),
};

// ── Project Tasks ────────────────────────────────────────────────────

export const projectTasksAPI = {
  getAll: (projectId: string, params?: Record<string, unknown>) =>
    api.get(`/projects/${projectId}/tasks`, { params }),
  getOne: (projectId: string, taskId: string) =>
    api.get(`/projects/${projectId}/tasks/${taskId}`),
  create: (projectId: string, data: Record<string, unknown>) =>
    api.post(`/projects/${projectId}/tasks`, data),
  update: (projectId: string, taskId: string, data: Record<string, unknown>) =>
    api.put(`/projects/${projectId}/tasks/${taskId}`, data),
  toggleComplete: (projectId: string, taskId: string) =>
    api.patch(`/projects/${projectId}/tasks/${taskId}/complete`),
  reorder: (projectId: string, taskIds: string[]) =>
    api.patch(`/projects/${projectId}/tasks/reorder`, { task_ids: taskIds }),
  delete: (projectId: string, taskId: string) =>
    api.delete(`/projects/${projectId}/tasks/${taskId}`),
  // Attachments
  listAttachments: (projectId: string, taskId: string) =>
    api.get(`/projects/${projectId}/tasks/${taskId}/attachments`),
  uploadAttachment: (projectId: string, taskId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/projects/${projectId}/tasks/${taskId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteAttachment: (projectId: string, taskId: string, attId: string) =>
    api.delete(`/projects/${projectId}/tasks/${taskId}/attachments/${attId}`),
  downloadAttachmentUrl: (projectId: string, taskId: string, attId: string) =>
    `/api/v1/projects/${projectId}/tasks/${taskId}/attachments/${attId}/download`,
  // Comments
  listComments: (projectId: string, taskId: string, params?: Record<string, unknown>) =>
    api.get(`/projects/${projectId}/tasks/${taskId}/comments`, { params }),
  postComment: (projectId: string, taskId: string, body: string, parentCommentId?: string | null) =>
    api.post(`/projects/${projectId}/tasks/${taskId}/comments`, {
      body,
      parent_comment_id: parentCommentId ?? null,
    }),
};

// ── Partner Organizations ────────────────────────────────────────────

export const partnerOrgsAPI = {
  getAll: (params?: Record<string, unknown>) => api.get('/partner-orgs', { params }),
  getOne: (id: string) => api.get(`/partner-orgs/${id}`),
  create: (data: Record<string, unknown>) => api.post('/partner-orgs', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/partner-orgs/${id}`, data),
  delete: (id: string) => api.delete(`/partner-orgs/${id}`),
  getContacts: (id: string) => api.get(`/partner-orgs/${id}/contacts`),
  createContact: (id: string, data: Record<string, unknown>) => api.post(`/partner-orgs/${id}/contacts`, data),
  updateContact: (orgId: string, contactId: string, data: Record<string, unknown>) =>
    api.put(`/partner-orgs/${orgId}/contacts/${contactId}`, data),
  getHealth: (id: string) => api.get(`/partner-orgs/${id}/health`),
  sendInvite: (orgId: string, contactId: string) =>
    api.post(`/partner-orgs/${orgId}/contacts/${contactId}/invite`),
};

// ── Project Documents ────────────────────────────────────────────────

export const projectDocsAPI = {
  getAll: (projectId: string, params?: Record<string, unknown>) =>
    api.get(`/projects/${projectId}/documents`, { params }),
  upload: (projectId: string, file: File, visibility: string = 'shared') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('visibility', visibility);
    return api.post(`/projects/${projectId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  updateVisibility: (projectId: string, docId: string, visibility: string) =>
    api.patch(`/projects/${projectId}/documents/${docId}/visibility`, { visibility }),
  delete: (projectId: string, docId: string) =>
    api.delete(`/projects/${projectId}/documents/${docId}`),
  downloadUrl: (projectId: string, docId: string) =>
    `/api/v1/projects/${projectId}/documents/${docId}/download`,
};

// ── Project Messages ─────────────────────────────────────────────────

export const projectMessagesAPI = {
  getAll: (projectId: string, params?: Record<string, unknown>) =>
    api.get(`/projects/${projectId}/messages`, { params }),
  send: (projectId: string, data: { channel: string; body: string; visibility?: string }) =>
    api.post(`/projects/${projectId}/messages`, data),
  getChannels: (projectId: string) =>
    api.get(`/projects/${projectId}/messages/channels`),
};

// ── Coordination Reports ─────────────────────────────────────────────

export const coordinationReportsAPI = {
  summary: () => api.get('/coordination/summary'),
  byCommunity: () => api.get('/coordination/by-community'),
  partnerHealth: () => api.get('/coordination/partner-health'),
};

// ── Partner Portal (Bearer token auth) ──────────────────────────────

function portalHeaders(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

export const portalAPI = {
  requestLink: (email: string) => api.post('/portal/auth/request-link', { email }),
  verify: (token: string) => api.get(`/portal/auth/verify/${token}`),
  dashboard: (token: string) => api.get('/portal/dashboard', portalHeaders(token)),
  projects: (token: string) => api.get('/portal/projects', portalHeaders(token)),
  projectTasks: (projectId: string, token: string) =>
    api.get(`/portal/projects/${projectId}/tasks`, portalHeaders(token)),
  bulkProjectTasks: (projectIds: string[], token: string) =>
    api.post('/portal/projects/tasks/bulk', { project_ids: projectIds }, portalHeaders(token)),
  completeTask: (projectId: string, taskId: string, token: string) =>
    api.patch(`/portal/projects/${projectId}/tasks/${taskId}/complete`, null, portalHeaders(token)),
  taskDetail: (projectId: string, taskId: string, token: string) =>
    api.get(`/portal/projects/${projectId}/tasks/${taskId}`, portalHeaders(token)),
  taskAttachments: (projectId: string, taskId: string, token: string) =>
    api.get(`/portal/projects/${projectId}/tasks/${taskId}/attachments`, portalHeaders(token)),
  uploadTaskAttachment: (projectId: string, taskId: string, token: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/portal/projects/${projectId}/tasks/${taskId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token}` },
    });
  },
  taskComments: (projectId: string, taskId: string, token: string) =>
    api.get(`/portal/projects/${projectId}/tasks/${taskId}/comments`, portalHeaders(token)),
  postTaskComment: (projectId: string, taskId: string, token: string, body: string) =>
    api.post(`/portal/projects/${projectId}/tasks/${taskId}/comments`, { body }, portalHeaders(token)),
  projectDocuments: (projectId: string, token: string) =>
    api.get(`/portal/projects/${projectId}/documents`, portalHeaders(token)),
  downloadDocument: (projectId: string, docId: string, token: string) =>
    api.get(`/portal/projects/${projectId}/documents/${docId}/download`, {
      ...portalHeaders(token),
      responseType: 'blob',
    }),
  uploadDocument: (projectId: string, token: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/portal/projects/${projectId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token}` },
    });
  },
  projectMessages: (projectId: string, token: string, params?: Record<string, unknown>) =>
    api.get(`/portal/projects/${projectId}/messages`, { ...portalHeaders(token), params }),
  sendMessage: (projectId: string, token: string, data: { channel: string; body: string }) =>
    api.post(`/portal/projects/${projectId}/messages`, data, portalHeaders(token)),
  orgDocuments: (token: string) => api.get('/portal/org-documents', portalHeaders(token)),

  // Notification preferences — same response shape as the internal endpoint,
  // so reuse the types exported from lib/api.ts.
  getNotificationPrefs: (token: string) =>
    api.get('/portal/me/notification-preferences', portalHeaders(token)),
  updateNotificationPrefs: (token: string, body: Record<string, unknown>) =>
    api.put('/portal/me/notification-preferences', body, portalHeaders(token)),
  inbox: (token: string) => api.get('/portal/notifications/inbox', portalHeaders(token)),
  markInboxRead: (token: string, id: string) =>
    api.post(`/portal/notifications/inbox/${id}/read`, null, portalHeaders(token)),
  dismissInbox: (token: string, id: string) =>
    api.post(`/portal/notifications/inbox/${id}/dismiss`, null, portalHeaders(token)),
};

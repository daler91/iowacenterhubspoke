import api from './api';

// ── Projects ─────────────────────────────────────────────────────────

export const projectsAPI = {
  getAll: (params?: Record<string, unknown>) => api.get('/projects', { params }),
  getOne: (id: string) => api.get(`/projects/${id}`),
  create: (data: Record<string, unknown>) => api.post('/projects', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/projects/${id}`, data),
  delete: (id: string) => api.delete(`/projects/${id}`),
  advancePhase: (id: string) => api.post(`/projects/${id}/advance-phase`),
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
  send: (projectId: string, data: { channel: string; body: string }) =>
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

// ── Partner Portal (token-based, no JWT) ─────────────────────────────

export const portalAPI = {
  requestLink: (email: string) => api.post('/portal/auth/request-link', { email }),
  verify: (token: string) => api.get(`/portal/auth/verify/${token}`),
  dashboard: (token: string) => api.get('/portal/dashboard', { params: { token } }),
  projects: (token: string) => api.get('/portal/projects', { params: { token } }),
  projectTasks: (projectId: string, token: string) =>
    api.get(`/portal/projects/${projectId}/tasks`, { params: { token } }),
  completeTask: (projectId: string, taskId: string, token: string) =>
    api.patch(`/portal/projects/${projectId}/tasks/${taskId}/complete`, null, { params: { token } }),
  projectDocuments: (projectId: string, token: string) =>
    api.get(`/portal/projects/${projectId}/documents`, { params: { token } }),
  uploadDocument: (projectId: string, token: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/portal/projects/${projectId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: { token },
    });
  },
  projectMessages: (projectId: string, token: string, params?: Record<string, unknown>) =>
    api.get(`/portal/projects/${projectId}/messages`, { params: { token, ...params } }),
  sendMessage: (projectId: string, token: string, data: { channel: string; body: string }) =>
    api.post(`/portal/projects/${projectId}/messages`, data, { params: { token } }),
  orgDocuments: (token: string) => api.get('/portal/org-documents', { params: { token } }),
};

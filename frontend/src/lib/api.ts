import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.REACT_APP_BACKEND_URL || '';
const API_BASE = `${BACKEND_URL}/api/v1`;

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

function getCsrfToken(): string | null {
  const match = /(?:^|; )csrf_token=([^;]*)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

api.interceptors.request.use((config) => {
  const method = (config.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const token = getCsrfToken();
    if (token) {
      config.headers['X-CSRF-Token'] = token;
    }
  }
  return config;
});

let isRedirectingTo401 = false;
api.interceptors.response.use(
  (response) => {
    // Reset the redirect guard on any successful response (user is authenticated)
    isRedirectingTo401 = false;
    return response;
  },
  (error) => {
    if (error.response?.status === 401 && !isRedirectingTo401) {
      if (globalThis.location.pathname === '/login') {
        return Promise.reject(error);
      }
      isRedirectingTo401 = true;
      globalThis.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authAPI = {
  register: (data: { name: string; email: string; password: string; invite_token?: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  validateInvite: (token: string) => api.get(`/auth/invite/${token}`),
  myEmployee: () => api.get('/auth/my-employee'),
  changePassword: (data: { current_password: string; new_password: string }) =>
    api.post('/auth/change-password', data),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
  validateResetToken: (token: string) =>
    api.get(`/auth/reset-password/${token}`),
  resetPassword: (token: string, new_password: string) =>
    api.post('/auth/reset-password', { token, new_password }),
};

// Locations
export const locationsAPI = {
  getAll: (params?: Record<string, unknown>) => api.get('/locations', { params }),
  create: (data: Record<string, unknown>) => api.post('/locations', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/locations/${id}`, data),
  delete: (id: string) => api.delete(`/locations/${id}`),
  getDriveTime: (fromId: string, toId: string) =>
    api.get('/locations/drive-time', { params: { from_id: fromId, to_id: toId } }),
  getDriveTimeFromHub: (lat: number, lng: number) =>
    api.get('/locations/drive-time-from-hub', { params: { lat, lng } }),
};

// Employees
export const employeesAPI = {
  getAll: (params?: Record<string, unknown>) => api.get('/employees', { params }),
  create: (data: Record<string, unknown>) => api.post('/employees', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/employees/${id}`, data),
  delete: (id: string) => api.delete(`/employees/${id}`),
  googleAuthorize: (id: string) => api.get(`/google/authorize/${id}`),
  googleDisconnect: (id: string) => api.delete(`/google/${id}/disconnect`),
  outlookAuthorize: (id: string) => api.get(`/outlook/authorize/${id}`),
  outlookDisconnect: (id: string) => api.delete(`/outlook/${id}/disconnect`),
};

// Classes
export const classesAPI = {
  getAll: (params?: Record<string, unknown>) => api.get('/classes', { params }),
  create: (data: Record<string, unknown>) => api.post('/classes', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/classes/${id}`, data),
  delete: (id: string) => api.delete(`/classes/${id}`),
};

// Schedules
export const schedulesAPI = {
  exportCsv: (params?: Record<string, unknown>) =>
    api.get('/schedules/export', { params, responseType: 'blob' }),
  importPreview: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/schedules/import/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importCommit: (data: unknown) => api.post('/schedules/import', data),

  getAll: (params?: Record<string, unknown>) => api.get('/schedules/', { params }),
  create: (data: Record<string, unknown>) => api.post('/schedules/', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/schedules/${id}`, data),
  delete: (id: string) => api.delete(`/schedules/${id}`),
  updateStatus: (id: string, status: string) => api.put(`/schedules/${id}/status`, { status }),
  relocate: (id: string, data: Record<string, unknown>) => api.put(`/schedules/${id}/relocate`, data),
  checkConflicts: (data: Record<string, unknown>) => api.post('/schedules/check-conflicts', data),
  bulkDelete: (ids: string[]) => api.post('/schedules/bulk-delete', { ids }),
  bulkUpdateStatus: (ids: string[], status: string) => api.put('/schedules/bulk-status', { ids, status }),
  bulkReassign: (ids: string[], employee_ids: string[], force?: boolean) =>
    api.put('/schedules/bulk-reassign', { ids, employee_ids, force: force ?? false }),
  bulkUpdateLocation: (ids: string[], location_id: string, force?: boolean) =>
    api.put('/schedules/bulk-location', { ids, location_id, force: force ?? false }),
  bulkUpdateClass: (ids: string[], class_id: string) => api.put('/schedules/bulk-class', { ids, class_id }),
  deleteSeries: (seriesId: string) => api.delete(`/schedules/series/${seriesId}`),
  updateSeries: (seriesId: string, data: Record<string, unknown>) =>
    api.put(`/schedules/series/${seriesId}`, data),
};

// System Config
export const systemAPI = {
  getConfig: () => api.get('/system/config'),
};

// Dashboard
export const dashboardAPI = {
  getStats: () => api.get('/dashboard/stats'),
};

// Activity Logs
export const activityAPI = {
  getAll: (limit = 30) => api.get('/activity-logs', { params: { limit } }),
};

// Notifications
export const notificationsAPI = {
  getAll: () => api.get('/notifications'),
};

// Workload
export const workloadAPI = {
  getAll: () => api.get('/workload'),
};

// Reports
export const reportsAPI = {
  weeklySummary: (params?: Record<string, unknown>) => api.get('/reports/weekly-summary', { params }),
};

// Analytics
export const analyticsAPI = {
  trends: (params?: Record<string, unknown>) => api.get('/analytics/trends', { params }),
  forecast: (params?: Record<string, unknown>) => api.get('/analytics/forecast', { params }),
  driveOptimization: (params?: Record<string, unknown>) => api.get('/analytics/drive-optimization', { params }),
};

// Users (admin)
export const usersAPI = {
  getAll: () => api.get('/users'),
  approve: (userId: string) => api.put(`/users/${userId}/approve`),
  reject: (userId: string) => api.put(`/users/${userId}/reject`),
  updateRole: (userId: string, role: string) => api.put(`/users/${userId}/role`, { role }),
  delete: (userId: string) => api.delete(`/users/${userId}`),
  invite: (data: Record<string, unknown>) => api.post('/users/invite', data),
  getInvitations: () => api.get('/users/invitations'),
  revokeInvitation: (id: string) => api.delete(`/users/invitations/${id}`),
};

export default api;

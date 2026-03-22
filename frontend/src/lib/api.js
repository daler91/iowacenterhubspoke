import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.REACT_APP_BACKEND_URL || '';
const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  return config;
});

let isRedirectingTo401 = false;
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isRedirectingTo401) {
      isRedirectingTo401 = true;
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      globalThis.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
};

// Locations
export const locationsAPI = {
  getAll: (params) => api.get('/locations', { params }),
  create: (data) => api.post('/locations', data),
  update: (id, data) => api.put(`/locations/${id}`, data),
  delete: (id) => api.delete(`/locations/${id}`),
};

// Employees
export const employeesAPI = {
  getAll: (params) => api.get('/employees', { params }),
  create: (data) => api.post('/employees', data),
  update: (id, data) => api.put(`/employees/${id}`, data),
  delete: (id) => api.delete(`/employees/${id}`),
};

// Classes
export const classesAPI = {
  getAll: (params) => api.get('/classes', { params }),
  create: (data) => api.post('/classes', data),
  update: (id, data) => api.put(`/classes/${id}`, data),
  delete: (id) => api.delete(`/classes/${id}`),
};

// Schedules
export const schedulesAPI = {
  getAll: (params) => api.get('/schedules', { params }),
  create: (data) => api.post('/schedules', data),
  update: (id, data) => api.put(`/schedules/${id}`, data),
  delete: (id) => api.delete(`/schedules/${id}`),
  updateStatus: (id, status) => api.put(`/schedules/${id}/status`, { status }),
  relocate: (id, data) => api.put(`/schedules/${id}/relocate`, data),
  checkConflicts: (data) => api.post('/schedules/check-conflicts', data),
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
  weeklySummary: (params) => api.get('/reports/weekly-summary', { params }),
};

export default api;

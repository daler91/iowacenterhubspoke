import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
};

// Locations
export const locationsAPI = {
  getAll: () => api.get('/locations'),
  create: (data) => api.post('/locations', data),
  update: (id, data) => api.put(`/locations/${id}`, data),
  delete: (id) => api.delete(`/locations/${id}`),
};

// Employees
export const employeesAPI = {
  getAll: () => api.get('/employees'),
  create: (data) => api.post('/employees', data),
  update: (id, data) => api.put(`/employees/${id}`, data),
  delete: (id) => api.delete(`/employees/${id}`),
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

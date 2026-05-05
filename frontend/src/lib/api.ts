import axios, { type AxiosRequestConfig } from 'axios';
import { toast } from 'sonner';
import type {
  ApiListParams,
  ClassCreate,
  ClassUpdate,
  EmployeeCreate,
  EmployeeUpdate,
  LocationCreate,
  LocationUpdate,
  UserInvitePayload,
} from './types';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.REACT_APP_BACKEND_URL || '';
const API_BASE = `${BACKEND_URL}/api/v1`;


export interface ApiErrorConflictItem {
  location?: string;
  time?: string;
  [key: string]: unknown;
}

export interface ApiErrorDetailPayload {
  message?: string;
  conflicts?: ApiErrorConflictItem[];
  outlook_conflicts?: Record<string, unknown>[];
  google_conflicts?: Record<string, unknown>[];
  blockers?: string[];
  [key: string]: unknown;
}

export interface NormalizedApiError {
  status: number | null;
  detail: unknown;
  detailPayload: ApiErrorDetailPayload | null;
  conflicts: ApiErrorConflictItem[];
  message: string;
}

const FALLBACK_API_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export function isApiErrorDetailPayload(value: unknown): value is ApiErrorDetailPayload {
  return typeof value === 'object' && value !== null;
}

export function normalizeApiError(err: unknown, fallbackMessage: string = FALLBACK_API_ERROR_MESSAGE): NormalizedApiError {
  const maybe = err as { response?: { status?: number; data?: { detail?: unknown } }; message?: string };
  const status = maybe?.response?.status ?? null;
  const detail = maybe?.response?.data?.detail;
  const detailPayload = isApiErrorDetailPayload(detail) ? detail : null;
  const conflicts = Array.isArray(detailPayload?.conflicts) ? detailPayload.conflicts : [];

  let message = fallbackMessage;
  if (typeof detail === 'string' && detail.trim()) message = detail;
  else if (typeof detailPayload?.message === 'string' && detailPayload.message.trim()) message = detailPayload.message;
  else if (typeof maybe?.message === 'string' && maybe.message.trim()) message = maybe.message;

  return { status, detail, detailPayload, conflicts, message };
}

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Cache the parsed CSRF token against the cookie string identity. The
// raw cookie is short and string-comparable, so we only re-run the regex
// when document.cookie actually changes (which happens on every CSRF
// rotation). Saves a regex execution on every mutating request.
let _csrfCookieSnapshot: string | null = null;
let _csrfTokenCache: string | null = null;

function getCsrfToken(): string | null {
  const cookie = document.cookie;
  if (cookie === _csrfCookieSnapshot) return _csrfTokenCache;
  _csrfCookieSnapshot = cookie;
  const match = /(?:^|; )csrf_token=([^;]*)/.exec(cookie);
  _csrfTokenCache = match ? decodeURIComponent(match[1]) : null;
  return _csrfTokenCache;
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

// Public auth routes that should NOT trigger a 401 → /login redirect.
// A user who lands on one of these pages is already signed out by design
// (e.g. following a password-reset link from an email).
export const PUBLIC_AUTH_PATHS = ['/login', '/forgot-password', '/reset-password', '/portal'];

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

function pathnameFromRequestUrl(url: string): string {
  try {
    return new URL(url, globalThis.location?.origin || 'http://localhost').pathname;
  } catch {
    return url;
  }
}

export function isPortalApiPath(url: string): boolean {
  const pathname = pathnameFromRequestUrl(url);
  return pathname === '/portal'
    || pathname.startsWith('/portal/')
    || pathname === '/api/v1/portal'
    || pathname.startsWith('/api/v1/portal/');
}

export function shouldAttemptRefreshOn401(url: string): boolean {
  if (isPortalApiPath(url)) return false;
  return !(
    url.includes('/auth/login')
    || url.includes('/auth/register')
    || url.includes('/auth/refresh')
    || url.includes('/auth/me')
  );
}

// Debounce the login redirect so concurrent 401s don't thrash the history,
// but auto-expire the guard after ~3s. An earlier boolean flag was only
// cleared on a *successful* response — if the next request after a 401 was
// a 500 or network error, every subsequent 401 got silently swallowed.
export const REDIRECT_DEBOUNCE_MS = 3000;

/**
 * Pure decision helper for the 401 interceptor: returns true when we
 * should navigate to /login given the current path and the last redirect
 * timestamp. Exported for unit tests — the interceptor below wires it up
 * to real globals.
 */
export function shouldRedirectOn401(
  pathname: string,
  now: number,
  lastRedirectAt: number,
  debounceMs: number = REDIRECT_DEBOUNCE_MS,
): boolean {
  if (isPublicAuthPath(pathname)) return false;
  return now - lastRedirectAt >= debounceMs;
}

let lastRedirectAt = 0;

// Concurrent 401s should share a single in-flight refresh call so we don't
// spam the /auth/refresh endpoint (and risk tripping the replay detector
// on our own rotation). The Promise is resolved with true iff the refresh
// succeeded, false otherwise.
let refreshInFlight: Promise<boolean> | null = null;

// Sentinel set when the server detected refresh-token replay. Login
// page reads this on mount to show a one-time warning.
export const REPLAY_LOGOUT_FLAG = 'hubspoke_replay_logout';

async function attemptRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      await axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true });
      return true;
    } catch (err: unknown) {
      // When the backend detects a reused refresh token it revokes every
      // active session for that user and returns 401 with a specific
      // message. Bubble that up to the UI as a warning toast + a session
      // flag so the subsequent /login redirect can explain what happened.
      const normalized = normalizeApiError(err);
      const detail = normalized.detail;
      if (
        normalized.status === 401
        && typeof detail === 'string'
        && detail.toLowerCase().includes('reused')
      ) {
        try {
          sessionStorage.setItem(REPLAY_LOGOUT_FLAG, '1');
        } catch {
          // Private-mode storage quota exceeded — fall through to toast.
        }
        toast.warning(
          'For your safety, all devices were signed out. Please sign in again.',
          { duration: 8000 },
        );
      }
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const config = error.config as (AxiosRequestConfig & { _retriedAfterRefresh?: boolean }) | undefined;
    const url: string = typeof config?.url === 'string' ? config.url : '';

    if (status === 401 && config && !config._retriedAfterRefresh) {
      // Portal auth is bearer-token based, so let portal pages render their
      // own invalid/expired-link recovery instead of entering the app login flow.
      if (isPortalApiPath(url)) {
        throw error;
      }

      if (shouldAttemptRefreshOn401(url)) {
        const refreshed = await attemptRefresh();
        if (refreshed) {
          config._retriedAfterRefresh = true;
          return api.request(config);
        }
      }
      const now = Date.now();
      if (shouldRedirectOn401(globalThis.location.pathname, now, lastRedirectAt)) {
        lastRedirectAt = now;
        globalThis.location.href = '/login';
      }
    }
    throw error;
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
  myEmployee: (config?: AxiosRequestConfig) => api.get('/auth/my-employee', config),
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
  getAll: (params?: ApiListParams) => api.get('/locations', { params }),
  create: (data: LocationCreate) => api.post('/locations', data),
  update: (id: string, data: LocationUpdate) => api.put(`/locations/${id}`, data),
  delete: (id: string) => api.delete(`/locations/${id}`),
  getDriveTime: (fromId: string, toId: string) =>
    api.get('/locations/drive-time', { params: { from_id: fromId, to_id: toId } }),
  getDriveTimeFromHub: (lat: number, lng: number) =>
    api.get('/locations/drive-time-from-hub', { params: { lat, lng } }),
};

// Employees
export const employeesAPI = {
  getAll: (params?: ApiListParams) => api.get('/employees', { params }),
  create: (data: EmployeeCreate) => api.post('/employees', data),
  update: (id: string, data: EmployeeUpdate) => api.put(`/employees/${id}`, data),
  delete: (id: string) => api.delete(`/employees/${id}`),
  googleAuthorize: (id: string) => api.get(`/google/authorize/${id}`),
  googleDisconnect: (id: string) => api.delete(`/google/${id}/disconnect`),
  outlookAuthorize: (id: string) => api.get(`/outlook/authorize/${id}`),
  outlookDisconnect: (id: string) => api.delete(`/outlook/${id}/disconnect`),
};

// Classes
export const classesAPI = {
  getAll: (params?: ApiListParams) => api.get('/classes', { params }),
  create: (data: ClassCreate) => api.post('/classes', data),
  update: (id: string, data: ClassUpdate) => api.put(`/classes/${id}`, data),
  delete: (id: string) => api.delete(`/classes/${id}`),
};

// Schedules
//
// Schedule payloads are dynamic (the form merges ``buildPayload`` output
// with recurrence / override / force flags), so the public ``create`` /
// ``update`` / ``relocate`` / ``checkConflicts`` / ``updateSeries`` take a
// loose ``ScheduleRequestPayload`` object. The canonical shape lives in
// ``ScheduleInput`` in ``types.ts`` — see that type for the field list.
export type ScheduleRelocatePayload = {
  date: string;
  start_time: string;
  end_time: string;
  force?: boolean;
  override_reason?: string;
};

export type ScheduleConflictCheckPayload = {
  employee_ids: string[];
  location_id: string;
  date: string;
  start_time: string;
  end_time: string;
  drive_to_override_minutes: number | null;
  drive_from_override_minutes: number | null;
  schedule_id: string | null;
};

export type ScheduleSinglePayload = {
  employee_ids: string[];
  class_id: string | null;
  location_id: string;
  date: string;
  start_time: string;
  end_time: string;
  notes: string;
  drive_to_override_minutes: number | null;
  drive_from_override_minutes: number | null;
  recurrence: null;
  recurrence_end_mode: null;
  recurrence_end_date: null;
  recurrence_occurrences: null;
  custom_recurrence: null;
};

export type ScheduleRecurringPayload = {
  employee_ids: string[];
  class_id: string | null;
  location_id: string;
  date: string;
  start_time: string;
  end_time: string;
  notes: string;
  drive_to_override_minutes: number | null;
  drive_from_override_minutes: number | null;
  recurrence: string;
  recurrence_end_mode: string;
  recurrence_end_date: string;
  recurrence_occurrences: number | null;
  custom_recurrence: {
    interval: number;
    frequency: string;
    weekdays: number[];
    end_mode: string;
    end_date: string | null;
    occurrences: number | null;
  } | null;
};

export type ScheduleRequestPayload = ScheduleSinglePayload | ScheduleRecurringPayload;
export type ScheduleMutationPayload = ScheduleRequestPayload & {
  force_outlook?: boolean;
  force_google?: boolean;
};
export type SchedulePatchPayload = Partial<ScheduleMutationPayload> & Record<string, unknown>;
export const schedulesAPI = {
  exportCsv: (params?: ApiListParams) =>
    api.get('/schedules/export', { params, responseType: 'blob' }),
  importPreview: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    // ``postForm`` sets Content-Type: multipart/form-data so axios'
    // transformRequest passes the FormData through unchanged. ``post``
    // would inherit the axios-instance default (application/json) and
    // silently JSON-stringify the FormData, losing the file (FastAPI then
    // 422s on the missing ``file`` field). The browser's XHR layer adds
    // the boundary parameter when the body is FormData.
    return api.postForm('/schedules/import/preview', formData);
  },
  importCommit: (data: unknown) => api.post('/schedules/import', data),

  getAll: (params?: ApiListParams) => api.get('/schedules/', { params }),
  getOne: (id: string) => api.get(`/schedules/${id}`),
  create: (data: ScheduleMutationPayload) => api.post('/schedules/', data),
  update: (id: string, data: SchedulePatchPayload) => api.put(`/schedules/${id}`, data),
  delete: (id: string) => api.delete(`/schedules/${id}`),
  updateStatus: (id: string, status: string) => api.put(`/schedules/${id}/status`, { status }),
  relocate: (id: string, data: ScheduleRelocatePayload) => api.put(`/schedules/${id}/relocate`, data),
  checkConflicts: (data: ScheduleConflictCheckPayload) => api.post('/schedules/check-conflicts', data),
  bulkDelete: (ids: string[]) => api.post('/schedules/bulk-delete', { ids }),
  bulkUpdateStatus: (ids: string[], status: string) => api.put('/schedules/bulk-status', { ids, status }),
  bulkReassign: (ids: string[], employee_ids: string[], force?: boolean) =>
    api.put('/schedules/bulk-reassign', { ids, employee_ids, force: force ?? false }),
  bulkUpdateLocation: (ids: string[], location_id: string, force?: boolean) =>
    api.put('/schedules/bulk-location', { ids, location_id, force: force ?? false }),
  bulkUpdateClass: (ids: string[], class_id: string) => api.put('/schedules/bulk-class', { ids, class_id }),
  deleteSeries: (seriesId: string) => api.delete(`/schedules/series/${seriesId}`),
  updateSeries: (seriesId: string, data: SchedulePatchPayload) =>
    api.put(`/schedules/series/${seriesId}`, data),
};

// System Config
export const systemAPI = {
  getConfig: (config?: AxiosRequestConfig) => api.get('/system/config', config),
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
  getAll: (config?: AxiosRequestConfig) => api.get('/notifications', config),
  getInbox: (config?: AxiosRequestConfig) => api.get('/notifications/inbox', config),
  markRead: (id: string) => api.post(`/notifications/inbox/${id}/read`),
  dismiss: (id: string) => api.post(`/notifications/inbox/${id}/dismiss`),
  markAllRead: () => api.post('/notifications/inbox/mark-all-read'),
  dismissAll: () => api.post('/notifications/inbox/dismiss-all'),
};

// Notification preferences — shape mirrors the backend registry/effective view.
export type NotificationChannel = 'in_app' | 'email';
export type NotificationFrequency = 'instant' | 'daily' | 'weekly' | 'off';

export interface NotificationTypeDescriptor {
  key: string;
  category: string;
  label: string;
  description: string;
  default_channels: Partial<Record<NotificationChannel, NotificationFrequency>>;
  allowed_channels: NotificationChannel[];
  implemented: boolean;
}

export interface NotificationRegistryCategory {
  key: string;
  label: string;
  types: NotificationTypeDescriptor[];
}

export interface NotificationPreferences {
  version: number;
  digest: { daily_hour: number; weekly_day: string };
  types: Record<string, Partial<Record<NotificationChannel, NotificationFrequency>>>;
}

export interface NotificationPrefsResponse {
  registry: { categories: NotificationRegistryCategory[] };
  preferences: NotificationPreferences;
}

export const notificationPreferencesAPI = {
  get: (config?: AxiosRequestConfig) =>
    api.get<NotificationPrefsResponse>('/me/notification-preferences', config),
  update: (body: Partial<NotificationPreferences>) =>
    api.put<NotificationPrefsResponse>('/me/notification-preferences', body),
};

// Workload
export const workloadAPI = {
  getAll: () => api.get('/workload'),
};

// Reports
export interface WeeklySummaryParams extends ApiListParams {
  week_start?: string;
  week_end?: string;
}
export const reportsAPI = {
  weeklySummary: (params?: WeeklySummaryParams) => api.get('/reports/weekly-summary', { params }),
};

// Analytics
export interface AnalyticsParams extends ApiListParams {
  period?: string;
  start_date?: string;
  end_date?: string;
}
export const analyticsAPI = {
  trends: (params?: AnalyticsParams) => api.get('/analytics/trends', { params }),
  forecast: (params?: AnalyticsParams) => api.get('/analytics/forecast', { params }),
  driveOptimization: (params?: AnalyticsParams) => api.get('/analytics/drive-optimization', { params }),
};

// Users (admin)
export const usersAPI = {
  getAll: () => api.get('/users'),
  approve: (userId: string) => api.put(`/users/${userId}/approve`),
  reject: (userId: string) => api.put(`/users/${userId}/reject`),
  updateRole: (userId: string, role: string) => api.put(`/users/${userId}/role`, { role }),
  delete: (userId: string) => api.delete(`/users/${userId}`),
  invite: (data: UserInvitePayload) => api.post('/users/invite', data),
  getInvitations: () => api.get('/users/invitations'),
  revokeInvitation: (id: string) => api.delete(`/users/invitations/${id}`),
  // Refresh-token session management
  listSessions: (userId: string) => api.get(`/users/${userId}/sessions`),
  revokeAllSessions: (userId: string) => api.post(`/users/${userId}/sessions/revoke-all`),
  // Per-email brute-force lockout state
  listLockouts: () => api.get('/users/security/lockouts'),
  clearLockout: (email: string) => api.delete(`/users/security/lockouts/${encodeURIComponent(email)}`),
};

// Webhooks (admin)
export const webhooksAPI = {
  rotateSecret: (webhookId: string) => api.post(`/webhooks/${webhookId}/rotate-secret`),
};

export default api;

import type { Role, ScheduleStatus } from './constants';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Employee {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  color?: string;
  created_at: string;
  deleted_at?: string | null;
}

export interface Location {
  id: string;
  city_name: string;
  drive_time_minutes: number;
  latitude?: number;
  longitude?: number;
  created_at: string;
  deleted_at?: string | null;
}

export interface ClassType {
  id: string;
  name: string;
  description?: string;
  color?: string;
  created_at: string;
  deleted_at?: string | null;
}

export interface Schedule {
  id: string;
  employee_ids: string[];
  employees: Array<{ id: string; name: string; color?: string }>;
  location_id: string;
  location_name: string;
  class_id?: string | null;
  class_name?: string;
  class_color?: string;
  class_description?: string;
  date: string;
  start_time: string;
  end_time: string;
  status: ScheduleStatus;
  notes?: string;
  drive_time_minutes: number;
  drive_to_override_minutes?: number | null;
  drive_from_override_minutes?: number | null;
  town_to_town?: boolean;
  town_to_town_warning?: string | null;
  town_to_town_drive_minutes?: number | null;
  recurrence?: string;
  recurrence_rule?: Record<string, unknown> | null;
  series_id?: string | null;
  calendar_events?: Record<string, Record<string, unknown>> | null;
  created_at: string;
  deleted_at?: string | null;
}

export interface DashboardStats {
  total_employees: number;
  total_locations: number;
  total_schedules: number;
  total_classes: number;
  today_schedules: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

export interface ActivityLog {
  id: string;
  action: string;
  description: string;
  entity_type: string;
  entity_id: string;
  user_name: string;
  timestamp: string;
}

export interface CalendarOutletContext {
  locations: Location[];
  classes: ClassType[];
  employees: Employee[];
  schedules: Schedule[];
  stats: DashboardStats | null;
  fetchSchedules: (optimisticData?: unknown, options?: { revalidate?: boolean }) => void;
  fetchActivities: () => void;
  onEditSchedule: (schedule: Schedule) => void;
  onStatClick?: (stat: string) => void;
  fetchErrors?: { schedules?: string };
}

export interface AnalyticsOutletContext {
  employees: Employee[];
  locations: Location[];
  classes: ClassType[];
}

export interface LinkedEmployee extends Employee {
  google_calendar_connected?: boolean;
  google_calendar_email?: string;
  outlook_calendar_connected?: boolean;
  outlook_calendar_email?: string;
}

export interface ForecastDataPoint {
  period: string;
  classes: number;
  class_hours: number;
  drive_hours: number;
  is_forecast?: boolean;
}

export interface TrendDataPoint {
  period: string;
  classes: number;
  class_hours: number;
  drive_hours: number;
}

export interface SummaryCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string | number;
}

export interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Extract an error message from an Axios error response.
 * Centralizes the `err.response?.data?.detail || fallback` pattern.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (
    typeof err === 'object' && err !== null &&
    'response' in err
  ) {
    const response = (err as { response?: { data?: { detail?: string } } }).response;
    if (typeof response?.data?.detail === 'string') {
      return response.data.detail;
    }
  }
  return fallback;
}

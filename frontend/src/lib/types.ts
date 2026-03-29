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
  employee_id: string;
  employee_name: string;
  employee_color?: string;
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
  travel_override_minutes?: number | null;
  town_to_town?: boolean;
  town_to_town_warning?: string | null;
  town_to_town_drive_minutes?: number | null;
  recurrence?: string;
  recurrence_rule?: Record<string, unknown> | null;
  outlook_event_id?: string | null;
  google_calendar_event_id?: string | null;
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

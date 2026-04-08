// ── Phase & Status Constants ─────────────────────────────────────────

export const PROJECT_PHASES = ['planning', 'promotion', 'delivery', 'follow_up'] as const;
export const ALL_PHASES = [...PROJECT_PHASES, 'complete'] as const;
export type ProjectPhase = typeof ALL_PHASES[number];
export type TaskPhase = typeof PROJECT_PHASES[number];

export const EVENT_FORMATS = ['workshop', 'series', 'office_hours', 'onboarding'] as const;
export type EventFormat = typeof EVENT_FORMATS[number];

export const TASK_OWNERS = ['internal', 'partner', 'both'] as const;
export type TaskOwner = typeof TASK_OWNERS[number];

export const PARTNER_STATUSES = ['prospect', 'onboarding', 'active', 'inactive'] as const;
export type PartnerStatus = typeof PARTNER_STATUSES[number];

// ── Display helpers ──────────────────────────────────────────────────

export const PHASE_LABELS: Record<string, string> = {
  planning: 'Planning',
  promotion: 'Promotion',
  delivery: 'Delivery',
  follow_up: 'Follow-Up',
  complete: 'Complete',
};

export const PHASE_COLORS: Record<string, string> = {
  planning: 'bg-blue-500',
  promotion: 'bg-amber-500',
  delivery: 'bg-green-500',
  follow_up: 'bg-purple-500',
  complete: 'bg-slate-400',
};

export const PHASE_DOT_COLORS: Record<string, string> = {
  planning: 'bg-blue-400',
  promotion: 'bg-amber-400',
  delivery: 'bg-green-400',
  follow_up: 'bg-purple-400',
  complete: 'bg-slate-300',
};

export const EVENT_FORMAT_LABELS: Record<string, string> = {
  workshop: 'Workshop',
  series: 'Series',
  office_hours: 'Office Hours',
  onboarding: 'Onboarding',
};

export const OWNER_COLORS: Record<string, string> = {
  internal: 'bg-blue-100 text-blue-700',
  partner: 'bg-purple-100 text-purple-700',
  both: 'bg-orange-100 text-orange-700',
};

export const OWNER_LABELS: Record<string, string> = {
  internal: 'You',
  partner: 'Partner',
  both: 'Both',
};

export const STATUS_BADGE_COLORS: Record<string, string> = {
  prospect: 'bg-slate-100 text-slate-600',
  onboarding: 'bg-amber-100 text-amber-700',
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-red-100 text-red-600',
};

// ── Data Types ───────────────────────────────────────────────────────

export interface Project {
  id: string;
  title: string;
  event_format: EventFormat;
  partner_org_id: string;
  partner_org_name?: string;
  template_id?: string;
  schedule_id?: string;
  event_date: string;
  phase: ProjectPhase;
  community: string;
  venue_name: string;
  registration_count: number;
  attendance_count?: number;
  warm_leads?: number;
  notes: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  // Enriched by board endpoint
  task_total?: number;
  task_completed?: number;
  partner_overdue?: number;
  task_counts?: Record<string, { total: number; completed: number }>;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  phase: TaskPhase;
  owner: TaskOwner;
  assigned_to?: string;
  due_date: string;
  completed: boolean;
  completed_at?: string;
  completed_by?: string;
  sort_order: number;
  details: string;
  description?: string;
  created_at: string;
  attachment_count?: number;
  comment_count?: number;
  attachments?: TaskAttachment[];
  comments?: TaskComment[];
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  project_id: string;
  filename: string;
  file_type: string;
  file_path: string;
  uploaded_by: string;
  uploaded_at: string;
  version: number;
}

export interface TaskComment {
  id: string;
  task_id: string;
  project_id: string;
  sender_type: 'internal' | 'partner';
  sender_name: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export interface VenueDetails {
  capacity?: number;
  av_setup?: string;
  wifi?: boolean;
  parking?: string;
  accessibility?: string;
  signage?: string;
}

export interface PartnerOrg {
  id: string;
  name: string;
  community: string;
  location_id?: string;
  venue_details: VenueDetails;
  co_branding: string;
  status: PartnerStatus;
  notes: string;
  created_at: string;
  updated_at: string;
  contacts?: PartnerContact[];
  projects?: Project[];
}

export interface PartnerContact {
  id: string;
  partner_org_id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  is_primary: boolean;
  created_at: string;
}

export interface ProjectDocument {
  id: string;
  project_id: string;
  partner_org_id?: string;
  filename: string;
  file_type: string;
  file_path: string;
  visibility: 'internal' | 'shared';
  uploaded_by: string;
  uploaded_at: string;
  version: number;
}

export interface Message {
  id: string;
  project_id: string;
  channel: string;
  sender_type: 'internal' | 'partner';
  sender_name: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_by: string[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  event_format: EventFormat;
  default_tasks: {
    title: string;
    phase: TaskPhase;
    owner: TaskOwner;
    offset_days: number;
    details: string;
  }[];
}

export interface PartnerHealth {
  partner_org_id: string;
  name: string;
  total_projects: number;
  classes_hosted: number;
  total_tasks: number;
  completed_tasks: number;
  completion_rate: number;
  last_active?: string;
}

export interface CommunityStats {
  community: string;
  delivered: number;
  upcoming: number;
  attendance: number;
  warm_leads: number;
  phases?: Record<string, number>;
}

export interface TrendData {
  months: string[];
  by_month: Record<string, Record<string, { delivered: number; attendance: number }>>;
}

export interface DashboardMetrics {
  classes_delivered: number;
  total_attendance: number;
  warm_leads: number;
  active_partners: number;
  upcoming_classes: number;
  overdue_alert_count: number;
  communities: CommunityStats[];
  upcoming_projects: Project[];
  trends?: TrendData;
}

export interface BoardData {
  columns: Record<string, Project[]>;
}

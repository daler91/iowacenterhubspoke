// ── Phase & Status Constants ─────────────────────────────────────────

export const PROJECT_PHASES = ['planning', 'promotion', 'delivery', 'follow_up'] as const;
export const ALL_PHASES = [...PROJECT_PHASES, 'complete'] as const;
export type ProjectPhase = typeof ALL_PHASES[number];
export type TaskPhase = typeof PROJECT_PHASES[number];

export const EVENT_FORMATS = ['workshop', 'series', 'office_hours', 'onboarding'] as const;
export type EventFormat = typeof EVENT_FORMATS[number];

export const TASK_OWNERS = ['internal', 'partner', 'both'] as const;
export type TaskOwner = typeof TASK_OWNERS[number];

export const TASK_STATUSES = ['to_do', 'in_progress', 'completed', 'on_hold'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

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

// Phase colors use semantic brand tokens (see frontend/src/index.css). Each
// phase still gets a distinct hue for quick recognition, but they all flow
// from the Hub Indigo / Spoke Teal / Warn Amber palette instead of raw
// Tailwind colors.
export const PHASE_COLORS: Record<string, string> = {
  planning: 'bg-info',
  promotion: 'bg-warn',
  delivery: 'bg-spoke',
  follow_up: 'bg-ownership-partner',
  complete: 'bg-slate-400',
};

export const PHASE_DOT_COLORS: Record<string, string> = {
  planning: 'bg-info',
  promotion: 'bg-warn',
  delivery: 'bg-spoke',
  follow_up: 'bg-ownership-partner',
  complete: 'bg-slate-300',
};

export const EVENT_FORMAT_LABELS: Record<string, string> = {
  workshop: 'Workshop',
  series: 'Series',
  office_hours: 'Office Hours',
  onboarding: 'Onboarding',
};

export const OWNER_COLORS: Record<string, string> = {
  internal: 'bg-ownership-internal-soft text-ownership-internal',
  partner: 'bg-ownership-partner-soft text-ownership-partner',
  both: 'bg-warn-soft text-warn',
};

export const OWNER_LABELS: Record<string, string> = {
  internal: 'You',
  partner: 'Partner',
  both: 'Both',
};

export const STATUS_BADGE_COLORS: Record<string, string> = {
  prospect: 'bg-slate-100 text-slate-600',
  onboarding: 'bg-warn-soft text-warn',
  active: 'bg-spoke-soft text-spoke',
  inactive: 'bg-danger-soft text-danger',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  to_do: 'To Do',
  in_progress: 'In Progress',
  completed: 'Completed',
  on_hold: 'On Hold',
};

export const TASK_STATUS_COLORS: Record<string, string> = {
  to_do: 'bg-slate-400',
  in_progress: 'bg-info',
  completed: 'bg-spoke',
  on_hold: 'bg-warn',
};

export const TASK_STATUS_RING_COLORS: Record<string, string> = {
  to_do: 'ring-slate-400',
  in_progress: 'ring-info',
  completed: 'ring-spoke',
  on_hold: 'ring-warn',
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
  class_id?: string;
  event_date: string;
  phase: ProjectPhase;
  community: string;
  venue_name: string;
  registration_count: number;
  attendance_count?: number;
  warm_leads?: number;
  notes: string;
  venue_details?: VenueDetails;
  location_id?: string;
  location_name?: string;
  partner_org_status?: string;
  partner_org_venue_details?: VenueDetails;
  schedule_warning?: string;
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
  status?: TaskStatus;
  completed: boolean;
  completed_at?: string;
  completed_by?: string;
  sort_order: number;
  details: string;
  description?: string;
  spotlight?: boolean;
  at_risk?: boolean;
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
  parent_comment_id?: string | null;
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
  visibility?: 'internal' | 'shared';
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

export interface ClassBreakdown {
  class_id: string | null;
  class_name?: string;
  class_color?: string;
  delivered: number;
  attendance: number;
  warm_leads: number;
}

export interface DashboardMetrics {
  classes_delivered: number;
  total_attendance: number;
  warm_leads: number;
  active_partners: number;
  upcoming_classes: number;
  overdue_alert_count: number;
  orphan_completed_schedules: number;
  class_breakdown: ClassBreakdown[];
  communities: CommunityStats[];
  upcoming_projects: Project[];
  trends?: TrendData;
}

export interface BoardData {
  columns: Record<string, Project[]>;
  /**
   * Per-phase flag indicating whether the backend truncated that
   * column's result set at `phase_limit`. When true, the UI renders a
   * "showing N" hint so users know to narrow the filter toolbar.
   * Older backends (pre-pagination) omit this field.
   */
  phase_truncated?: Record<string, boolean>;
  /** The effective per-column cap applied by the backend. */
  phase_limit?: number;
  /**
   * Distinct filter values across the full active-project set, not
   * just the paged columns. Used to build the filter dropdowns so
   * they stay complete when a phase is truncated; otherwise a
   * community that only lives in the clipped tail would be
   * unreachable. Older backends omit this field and the UI falls
   * back to deriving communities from the visible columns.
   */
  facets?: {
    communities?: string[];
  };
}

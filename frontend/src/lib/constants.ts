export const ROLES = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  SCHEDULER: 'scheduler',
  VIEWER: 'viewer',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

export const SCHEDULE_STATUS = {
  UPCOMING: 'upcoming',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
} as const;

export type ScheduleStatus = typeof SCHEDULE_STATUS[keyof typeof SCHEDULE_STATUS];

export const COLORS = {
  DEFAULT_EMPLOYEE: '#4F46E5',
  DEFAULT_CLASS: '#0F766E',
  // Kanban column status colors map to the semantic design tokens:
  //   upcoming     → hub (indigo)
  //   in_progress  → warn (amber)
  //   completed    → spoke (teal)
  // All three come from frontend/tailwind.config.js + index.css HSL vars.
  STATUS: {
    UPCOMING: 'bg-hub',
    IN_PROGRESS: 'bg-warn',
    COMPLETED: 'bg-spoke',
  },
  STATUS_LIGHT: {
    UPCOMING: 'bg-hub-soft',
    IN_PROGRESS: 'bg-warn-soft',
    COMPLETED: 'bg-spoke-soft',
  },
  STATUS_TEXT: {
    UPCOMING: 'text-hub',
    IN_PROGRESS: 'text-warn',
    COMPLETED: 'text-spoke',
  }
} as const;

export const END_MODES = {
  NEVER: 'never',
  ON_DATE: 'on_date',
  AFTER_OCCURRENCES: 'after_occurrences',
} as const;

export const CALENDAR = {
  START_HOUR: 6,
  DISPLAY_HOURS: 14,
  SNAP_MINUTES: 30,
  PX_PER_HOUR_WEEK: 60,
  PX_PER_HOUR_DAY: 80,
} as const;

export const PASSWORD_MIN_LENGTH = 8;

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
  STATUS: {
    UPCOMING: 'bg-indigo-500',
    IN_PROGRESS: 'bg-amber-500',
    COMPLETED: 'bg-green-500',
  },
  STATUS_LIGHT: {
    UPCOMING: 'bg-indigo-50',
    IN_PROGRESS: 'bg-amber-50',
    COMPLETED: 'bg-green-50',
  },
  STATUS_TEXT: {
    UPCOMING: 'text-indigo-700',
    IN_PROGRESS: 'text-amber-700',
    COMPLETED: 'text-green-700',
  }
} as const;

export const FREQUENCIES = {
  WEEK: 'week',
  MONTH: 'month',
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

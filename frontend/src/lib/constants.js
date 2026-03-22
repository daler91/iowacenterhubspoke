export const ROLES = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  SCHEDULER: 'scheduler',
  VIEWER: 'viewer',
};

export const SCHEDULE_STATUS = {
  UPCOMING: 'upcoming',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
};

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
};

export const FREQUENCIES = {
  WEEK: 'week',
  MONTH: 'month',
};

export const END_MODES = {
  NEVER: 'never',
  ON_DATE: 'on_date',
  AFTER_OCCURRENCES: 'after_occurrences',
};

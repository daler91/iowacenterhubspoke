# Role identifiers
ROLE_ADMIN = "admin"
ROLE_EDITOR = "editor"
ROLE_SCHEDULER = "scheduler"
ROLE_VIEWER = "viewer"

# User status
USER_STATUS_PENDING = "pending"
USER_STATUS_APPROVED = "approved"
USER_STATUS_REJECTED = "rejected"

# Schedule status strings
STATUS_UPCOMING = "upcoming"
STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETED = "completed"

# Default visual styles
DEFAULT_EMPLOYEE_COLOR = "#4F46E5"
DEFAULT_CLASS_COLOR = "#0F766E"

# Recurrence frequency
FREQ_WEEK = "week"
FREQ_MONTH = "month"

# Infrastructure defaults
DEFAULT_REDIS_URL = "redis://localhost:6379"

# Query limits
MAX_QUERY_LIMIT = 10000

# File import limits
MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024  # 5MB

# Recurrence end modes
END_MODE_NEVER = "never"
END_MODE_ON_DATE = "on_date"
END_MODE_AFTER_OCCURRENCES = "after_occurrences"

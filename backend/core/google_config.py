import os

# --- Service Account credentials (for Google Workspace domain-wide delegation) ---
GOOGLE_SERVICE_ACCOUNT_FILE = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "")
GOOGLE_SA_CLIENT_EMAIL = os.environ.get("GOOGLE_SA_CLIENT_EMAIL", "")
GOOGLE_SA_PRIVATE_KEY = os.environ.get("GOOGLE_SA_PRIVATE_KEY", "").replace("\\n", "\n")
GOOGLE_SA_PROJECT_ID = os.environ.get("GOOGLE_SA_PROJECT_ID", "")

_has_file = bool(GOOGLE_SERVICE_ACCOUNT_FILE and os.path.isfile(GOOGLE_SERVICE_ACCOUNT_FILE))
_has_vars = bool(GOOGLE_SA_CLIENT_EMAIL and GOOGLE_SA_PRIVATE_KEY and GOOGLE_SA_PROJECT_ID)

GOOGLE_SERVICE_ACCOUNT_ENABLED = _has_file or _has_vars

# --- OAuth 2.0 credentials (for individual Gmail / Google accounts) ---
GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
GOOGLE_OAUTH_REDIRECT_URI = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", "")

GOOGLE_OAUTH_ENABLED = bool(GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET)

# Overall: Google Calendar features available if either auth method is configured
GOOGLE_CALENDAR_ENABLED = GOOGLE_SERVICE_ACCOUNT_ENABLED or GOOGLE_OAUTH_ENABLED

GOOGLE_CALENDAR_TIMEZONE = "America/Chicago"
GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
GOOGLE_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar"]
GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"

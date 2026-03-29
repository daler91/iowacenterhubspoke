import os

GOOGLE_SERVICE_ACCOUNT_FILE = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "")
GOOGLE_SA_CLIENT_EMAIL = os.environ.get("GOOGLE_SA_CLIENT_EMAIL", "")
GOOGLE_SA_PRIVATE_KEY = os.environ.get("GOOGLE_SA_PRIVATE_KEY", "").replace("\\n", "\n")
GOOGLE_SA_PROJECT_ID = os.environ.get("GOOGLE_SA_PROJECT_ID", "")

_has_file = bool(GOOGLE_SERVICE_ACCOUNT_FILE and os.path.isfile(GOOGLE_SERVICE_ACCOUNT_FILE))
_has_vars = bool(GOOGLE_SA_CLIENT_EMAIL and GOOGLE_SA_PRIVATE_KEY and GOOGLE_SA_PROJECT_ID)

GOOGLE_CALENDAR_ENABLED = _has_file or _has_vars

GOOGLE_CALENDAR_TIMEZONE = "America/Chicago"
GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
GOOGLE_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar"]

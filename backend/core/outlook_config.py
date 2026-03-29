import os

# --- Client Credentials (org-wide, application permissions) ---
AZURE_TENANT_ID = os.environ.get("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "")
AZURE_CLIENT_SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")

OUTLOOK_ENABLED = bool(AZURE_TENANT_ID and AZURE_CLIENT_ID and AZURE_CLIENT_SECRET)

# --- OAuth 2.0 (individual Microsoft accounts, delegated permissions) ---
OUTLOOK_OAUTH_CLIENT_ID = os.environ.get("OUTLOOK_OAUTH_CLIENT_ID", "")
OUTLOOK_OAUTH_CLIENT_SECRET = os.environ.get("OUTLOOK_OAUTH_CLIENT_SECRET", "")
OUTLOOK_OAUTH_REDIRECT_URI = os.environ.get("OUTLOOK_OAUTH_REDIRECT_URI", "")

OUTLOOK_OAUTH_ENABLED = bool(OUTLOOK_OAUTH_CLIENT_ID and OUTLOOK_OAUTH_CLIENT_SECRET)

OUTLOOK_CALENDAR_ENABLED = OUTLOOK_ENABLED or OUTLOOK_OAUTH_ENABLED

OUTLOOK_TIMEZONE = "America/Chicago"
GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
TOKEN_URL = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/token"

# OAuth flow URLs (use "common" to support both work/school and personal accounts)
OUTLOOK_OAUTH_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
OUTLOOK_OAUTH_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
OUTLOOK_OAUTH_SCOPES = ["offline_access", "Calendars.ReadWrite", "User.Read"]

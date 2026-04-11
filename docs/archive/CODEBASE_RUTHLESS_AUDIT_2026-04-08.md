# Codebase Ruthless Audit (April 8, 2026)

## Method
I reviewed this repository in multiple passes:
1. **Architecture pass**: service boundaries, router composition, authorization flow.
2. **Security pass**: auth/session/token handling, file upload surfaces, webhook/OAuth external ingress/egress.
3. **Performance pass**: query shape, pagination behavior, per-request writes, I/O memory footprint.
4. **Maintainability/scalability pass**: coupling, cross-cutting concerns, change friction.
5. **External integration pass**: timeout/retry/SSRF posture for Google/Outlook/webhooks.

---

## 1) Architecture & Design Patterns

### [Severity: High]
**File/Location:** `backend/routers/partner_portal.py` (`get_portal_context` usage pattern across almost every endpoint)

**The Issue:**
Portal authentication is implemented as a raw token argument (`token: str`) passed through query params and route path usage patterns, rather than a session/cookie/bearer layer. This makes the portal transport model tightly coupled to every handler signature and encourages token leakage vectors (URL logs, browser history, referral propagation). It also creates repetitive auth checks in each endpoint and makes feature extension brittle.

**The Fix:**
Move token handling into a dedicated auth dependency that reads `Authorization: Bearer <token>` or a secure cookie; keep handlers business-focused.

```python
# core/portal_auth.py
from fastapi import Depends, Header, HTTPException
from database import db
from datetime import datetime, timezone

async def get_portal_context_from_bearer(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()

    token_doc = await db.portal_tokens.find_one({"token": token}, {"_id": 0})
    if not token_doc or token_doc.get("expires_at", "") < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=401, detail="Invalid or expired portal link")

    # optional: sliding session table/cookie here
    return token_doc

PortalContext = Depends(get_portal_context_from_bearer)
```

---

## 2) Security & Vulnerabilities

### [Severity: Critical]
**File/Location:** `backend/routers/partner_portal.py` lines 72–95

**The Issue:**
`POST /portal/auth/request-link` returns the raw magic-link token in the API response. This fully bypasses email possession proof and turns the magic link into immediate bearer credentials for any caller who knows a partner email.

**The Fix:**
Never return the token to the requester. Send it via email only, and always return a uniform message.

```python
@router.post("/auth/request-link")
@limiter.limit("3/minute")
async def request_magic_link(data: PortalAuthRequest):
    contact = await db.partner_contacts.find_one(
        {"email": data.email, "deleted_at": None}, {"_id": 0}
    )
    if contact:
        token = secrets.token_urlsafe(48)
        await db.portal_tokens.insert_one({...})
        await send_portal_magic_link_email(contact["email"], token)

    # constant response; do not return token
    return {"message": "If that email is registered, a link has been sent."}
```

### [Severity: High]
**File/Location:** `backend/routers/partner_portal.py` lines 98–220+ and all `token: str` query usage

**The Issue:**
Portal token transport in query parameters is vulnerable to leakage through access logs, browser history, shared links, and referrer headers.

**The Fix:**
Accept token only via `Authorization` header or secure, HTTP-only cookie. Remove token from path/query.

```python
@router.get("/dashboard")
async def portal_dashboard(ctx: PortalContext):
    ...
```

### [Severity: High]
**File/Location:**
- `backend/routers/project_docs.py` lines 63–70
- `backend/routers/project_tasks.py` attachment upload handlers
- `backend/routers/partner_portal.py` upload handlers

**The Issue:**
File uploads are read fully into memory (`content = await file.read()`), with no explicit size cap and no MIME/content validation. This enables memory exhaustion and malicious file upload risk.

**The Fix:**
Stream uploads in chunks, enforce size/content-type allowlist, and reject oversized payloads.

```python
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg"}

if file.content_type not in ALLOWED_TYPES:
    raise HTTPException(status_code=400, detail="Unsupported file type")

size = 0
async with aiofiles.open(file_path, "wb") as out:
    while chunk := await file.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File too large")
        await out.write(chunk)
```

### [Severity: High]
**File/Location:** `backend/services/webhooks.py` lines 59–82

**The Issue:**
Webhook delivery posts to arbitrary subscription URLs without SSRF controls. Even with admin-only create/update routes, this is still a high-impact internal pivot risk (metadata endpoints, private RFC1918 hosts, local services).

**The Fix:**
Validate and enforce outbound URL policy before storing and before delivering.

```python
from urllib.parse import urlparse
import ipaddress, socket

def validate_webhook_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="Webhook URL must be https")
    ip = ipaddress.ip_address(socket.gethostbyname(parsed.hostname))
    if ip.is_private or ip.is_loopback or ip.is_link_local:
        raise HTTPException(status_code=400, detail="Webhook URL target is not allowed")
```

### [Severity: Medium]
**File/Location:** `backend/server.py` lines 379–398

**The Issue:**
In development fallback, CORS is set to `allow_origins=["*"]` with `allow_credentials=True`. Browsers reject wildcard origins for credentialed requests; this causes inconsistent auth behavior and can hide real CORS policy defects until production.

**The Fix:**
Use explicit dev origins for credentialed flows.

```python
if not origins:
    origins = ["http://localhost:5173", "http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
)
```

---

## 3) Performance & Optimization

### [Severity: Medium]
**File/Location:** `backend/routers/schedule_crud.py` lines 45–90

**The Issue:**
`get_schedules` allows high default page size (`limit=1000`) without an upper bound guard. Under load, this can produce large responses, high memory pressure, and slower p95 latency.

**The Fix:**
Clamp `limit` and enforce sane pagination.

```python
MAX_LIMIT = 200
limit = max(1, min(limit, MAX_LIMIT))
skip = max(0, skip)
```

### [Severity: Medium]
**File/Location:** `backend/routers/partner_portal.py` lines 58–62

**The Issue:**
`get_portal_context` writes `last_used_at` on every authenticated portal request. This creates write amplification on read-heavy dashboard/task views and increases lock/IO pressure.

**The Fix:**
Throttle update frequency (e.g., once every 5–15 minutes).

```python
last_used = token_doc.get("last_used_at")
now = datetime.now(timezone.utc)
if not last_used or (now - datetime.fromisoformat(last_used)).total_seconds() > 600:
    await db.portal_tokens.update_one({"token": token}, {"$set": {"last_used_at": now.isoformat()}})
```

### [Severity: Low]
**File/Location:** `backend/server.py` lines 323–333

**The Issue:**
ETag generation relies on `response.body`, which may be absent for streaming responses and can become expensive for large payloads.

**The Fix:**
Gate ETag generation by content type/size and skip for streaming responses.

```python
if getattr(response, "body", None) and len(response.body) < 256_000:
    ...
```

---

## 4) Maintainability & Scalability

### [Severity: Medium]
**File/Location:** `backend/routers/partner_portal.py` (~500+ lines)

**The Issue:**
The portal router is handling auth, dashboard aggregation, tasks, comments, attachments, documents, and messaging in one file. This raises cognitive load and makes regression risk high for future feature changes.

**The Fix:**
Split by bounded context and keep shared dependencies/utilities in dedicated modules.

```text
backend/routers/portal_auth.py
backend/routers/portal_dashboard.py
backend/routers/portal_tasks.py
backend/routers/portal_documents.py
backend/routers/portal_messages.py
backend/services/portal_access.py
```

### [Severity: Medium]
**File/Location:** `backend/core/auth.py` lines 68–98

**The Issue:**
`get_current_user` performs a DB read on every authenticated request for password-change invalidation. This creates cross-cutting latency on all protected endpoints.

**The Fix:**
Store a `pwdv` (password version) claim in JWT and compare against a cached user version (Redis/local cache) with bounded TTL.

```python
# token payload includes pwdv integer
if payload.get("pwdv") != cached_pwdv_for_user(payload["user_id"]):
    raise HTTPException(status_code=401, detail="Session invalidated")
```

---

## 5) External Integrations

### [Severity: Medium]
**File/Location:** `backend/services/webhooks.py` lines 35–43

**The Issue:**
When Redis queue is unavailable, webhook delivery falls back inline inside request processing path. This can inflate latency and tie user-facing request reliability to external webhook responsiveness.

**The Fix:**
Persist to an outbox collection and process asynchronously; never inline deliver in request path.

```python
if pool:
    await pool.enqueue_job("deliver_webhook", sub_id, event, payload)
else:
    await db.webhook_outbox.insert_one({"sub_id": sub_id, "event": event, "payload": payload, "status": "pending"})
```

### [Severity: Medium]
**File/Location:**
- `backend/routers/google_oauth.py` token persistence logic
- `backend/routers/outlook_oauth.py` (same pattern)

**The Issue:**
Refresh tokens are stored directly on employee documents. If DB snapshots/logging are exposed, long-lived external account access can be compromised.

**The Fix:**
Encrypt refresh tokens at rest with a dedicated key, and centralize decrypt/encrypt in a token vault helper.

```python
encrypted = encrypt_secret(refresh_token, key=os.environ["TOKEN_ENCRYPTION_KEY"])
await db.employees.update_one({"id": employee_id}, {"$set": {"google_refresh_token_enc": encrypted}})
```

---

## Priority Remediation Order (Recommended)
1. **Immediate:** Remove token return from portal magic-link endpoint; migrate portal token transport off query strings.
2. **Immediate:** Add upload limits + streaming + MIME allowlist across all upload endpoints.
3. **Immediate:** Add SSRF protections for webhook URL validation.
4. **Next sprint:** Split portal router and reduce per-request auth DB IO.
5. **Next sprint:** Enforce pagination limits and remove inline webhook fallback.

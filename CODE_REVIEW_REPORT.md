# Code Review Report — Iowa Center HubSpoke Scheduler

**Generated:** 2026-04-12

## Executive Summary

This is a full-stack scheduling application (FastAPI + React/Vite + MongoDB) for managing workforce assignments across hub-and-spoke locations in Iowa. The core scheduling workflow is well-designed with drive time calculation, conflict detection, and recurrence support. However, **critical security vulnerabilities (secrets in git history, path traversal), broken CSV import/export functionality, no CI/CD pipeline, and significant data privacy gaps must be addressed before production use**. The frontend is well-structured with good empty states but needs accessibility improvements and dark mode completion.

---

## Critical Findings (must fix before shipping)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| 1 | Security | **Production secrets in git history** — MongoDB password, JWT secret, Redis password, Google Maps API key committed in historical commits | `backend/.env`, `frontend/.env` (commits `e8c0366`, `0d1ba1c`, `f26731d`) | Rotate ALL credentials immediately. Purge `.env` from git history with `git filter-repo`. |
| 2 | Security | **Path traversal in static file serving** — `full_path` joined with `_static_dir` without containment check; `GET /../../backend/.env` can read arbitrary files | `backend/server.py:216-221` | Add `file_path.resolve().is_relative_to(_static_dir.resolve())` check before serving. |
| 3 | Privacy | **Real database exports committed to git** — employee names, schedules, activity logs with user names tracked in repo | `data_export/*.json` | `git rm --cached data_export/` and purge from history. |
| 4 | QA | **CSV import completely broken** — uses MongoDB `_id` (ObjectId) instead of UUID `id` field; lookups always fail; imported schedules also missing all denormalized fields | `backend/routers/schedules.py:52-58,1680-1684,1714-1735` | Use `employee["id"]` not `employee["_id"]`; query with `{"id": ...}` not `{"_id": ...}`; add all denormalized fields. |
| 5 | QA | **CSV export shows "Unknown" for all names** — same `_id` vs `id` mismatch in export endpoint | `backend/routers/schedules.py:1491-1511` | Use denormalized fields already on schedule documents, or fix lookups to `{"id": {"$in": ...}}`. |

---

## Warnings (should fix soon)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| 6 | Security | CORS falls back to wildcard `*` with `allow_credentials=True` when `CORS_ORIGINS` is empty | `backend/server.py:90-99` | Require explicit origin config; never default to `*`. |
| 7 | Security | JWT tokens valid 7 days with no revocation, no refresh tokens; role changes don't invalidate existing tokens | `backend/core/auth.py:31` | Reduce to 15-30 min, add refresh token flow, add `jti` claim + blacklist. |
| 8 | Security | JWT token returned in response body AND httpOnly cookie — defeats httpOnly protection | `backend/routers/auth.py:80-81,99-103` | Remove token from JSON response body; rely on httpOnly cookie. |
| 9 | Security | `deleted_at` accepted in all Update schemas — any editor can manipulate soft-delete state, bypassing delete endpoints | `backend/models/schemas.py:26,39,58,97` | Remove `deleted_at` from all update schemas. |
| 10 | Security | CSP includes `'unsafe-inline' 'unsafe-eval'` — effectively disables XSS protection | `backend/server.py:75` | Use nonce-based CSP; remove `'unsafe-eval'`. |
| 11 | Security | Hardcoded admin email auto-promoted to admin on startup and bypass approval on registration; no email verification | `backend/server.py:158`, `backend/routers/auth.py:16` | Move to env var. Implement email verification. |
| 12 | Security | MongoDB connection string with password logged at startup | `backend/server.py:141` | Redact password before logging. |
| 13 | Performance | **No database indexes** — all queries on schedules, employees, locations, classes do full collection scans | `backend/database.py` | Add compound indexes: `(employee_id, date, deleted_at)`, `(location_id, deleted_at)`, unique `(id)`. |
| 14 | Performance | `get_redis_pool()` creates a new connection pool on every call — leaks connections | `backend/core/queue.py:5-13` | Cache pool as module-level singleton. |
| 15 | Performance | N+1 queries in `_sync_same_day_town_to_town` — ~3N DB queries per sibling schedule | `backend/routers/schedules.py:730-759` | Prefetch all locations and schedules once, compute in-memory. |
| 16 | Performance | `httpx.AsyncClient` created per-request for Google Maps and Outlook calls | `backend/services/drive_time.py:48`, `backend/services/outlook.py:30,74,131` | Create shared client at app lifespan level. |
| 17 | DevOps | Docker containers run as root | `Dockerfile`, `Dockerfile.dev` | Add non-root user: `RUN adduser --system appuser && USER appuser`. |
| 18 | DevOps | No CI/CD pipeline; `run_checks.sh` is a no-op that just echoes "All tests passed" | `run_checks.sh:2` | Create GitHub Actions workflow for linting, tests, security scanning, Docker build. |
| 19 | DevOps | MongoDB/Redis exposed without auth on all interfaces in docker-compose | `docker-compose.yml:5-6,10-11` | Bind to `127.0.0.1`, add authentication, or remove port mappings. |
| 20 | Business | **Employee deletion does not handle existing schedules** — orphaned schedules reference deleted employee | `backend/routers/employees.py:68-78` | Cascade soft-delete to future schedules, or warn user and block. |
| 21 | Business | **Location deletion leaves orphaned schedules** — same cascading problem | `backend/routers/locations.py:97-106` | Block when active schedules exist, or warn and cascade. |
| 22 | Business | No validation that `end_time > start_time` — negative class minutes corrupt all analytics | `backend/models/schemas.py:60-78` | Add Pydantic `model_validator` enforcing `end_time > start_time`. |
| 23 | Business | Stats endpoints use `.to_list(1000)` — silently drops data beyond 1000 schedules | `backend/routers/employees.py:98`, `locations.py:114`, `reports.py:82-85` | Use MongoDB aggregation pipelines for server-side computation. |
| 24 | Business | Bulk location update doesn't recheck conflicts or recalculate town-to-town | `backend/routers/schedules.py:329-367` | Run conflict detection per schedule, or flag affected schedules. |
| 25 | Privacy | No data retention policy — activity logs, soft-deleted records, old schedules kept indefinitely | Multiple | Add TTL indexes on activity_logs. Scheduled cleanup for soft-deleted records. |
| 26 | Privacy | No GDPR right-to-erasure — user deletion doesn't cascade to activity logs, denormalized schedule fields | `backend/routers/users.py:94-102` | Implement complete erasure/anonymization across all collections. |
| 27 | Privacy | Employee PII (name) denormalized into every schedule — persists after employee deletion | `backend/worker.py:203-248` | Anonymize denormalized data on employee deletion. |
| 28 | UX | Delete buttons (employee, location, class) have no confirmation dialog — instant on click | `EmployeeManager.jsx:76-85`, `LocationManager.jsx:102-110`, `ClassManager.jsx:77-85` | Add `AlertDialog` confirmation, matching BulkActionBar pattern. |
| 29 | UX | NotificationsPanel not keyboard-accessible — no Escape dismiss, no focus trap, no ARIA attributes | `NotificationsPanel.jsx:46-128` | Replace with Radix `Popover` component. |
| 30 | Performance | All 1000 schedules loaded on every page load — no date windowing | `frontend/src/hooks/useDashboardData.js:11`, `backend/routers/schedules.py:183-210` | Pass date range from current view; add separate SWR keys per range. |

---

## Suggestions (nice to have)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| 31 | Security | No date/time format validation — `date`, `start_time`, `end_time` are bare strings | `backend/models/schemas.py:63-66` | Add regex validators: `Field(..., pattern=r'^\d{4}-\d{2}-\d{2}$')`. |
| 32 | Security | Password policy: only 8-char minimum, no complexity requirements | `backend/models/schemas.py:8` | Add uppercase/lowercase/digit/special requirements. |
| 33 | Security | `StatusUpdate` and `UserRoleUpdate` accept any string — no enum validation | `backend/models/schemas.py:99,128` | Use `Literal[...]` types. |
| 34 | Security | No pagination upper bound on limit parameters | `backend/routers/schedules.py:191`, `system.py:19` | Add `Field(le=500)` to all `limit` params. |
| 35 | Business | Drive time always doubled (`* 2`) — inaccurate for multi-stop days | `backend/routers/employees.py:109`, `analytics.py:43` | Use travel chain logic for multi-stop stats. |
| 36 | Business | Recurrence "never" silently caps at 52 weeks — user not informed | `backend/services/schedule_utils.py:103-109` | Show effective end date in the API response and UI. |
| 37 | Business | Hub coordinates hardcoded in 3 files across 2 projects | `backend/services/drive_time.py:13-14`, `frontend MapView.jsx:7`, `LocationManager.jsx:148` | Store in DB or env vars. |
| 38 | Performance | `CalendarMonth` and `CalendarWeek` memos defeated by unstable Date/array references | `CalendarMonth.jsx:16-28`, `CalendarWeek.jsx:301-309` | Use `.getTime()` or `.toISOString()` as deps; wrap `days` in `useMemo`. |
| 39 | Performance | `WorkloadDashboard` chart data not memoized; O(N^2) max computation in render loop | `WorkloadDashboard.jsx:77-101,276-283` | Wrap in `useMemo`; pre-compute max outside `.map()`. |
| 40 | Performance | 7 parallel API calls on dashboard mount — no combined endpoint | `frontend/src/hooks/useDashboardData.js:8-14` | Add `/api/dashboard/init` batch endpoint. |
| 41 | UX | Sidebar nav missing `aria-label` — inaccessible when collapsed (icon-only) | `Sidebar.jsx:59-80` | Add `aria-label={item.label}` and `aria-current="page"`. |
| 42 | UX | Calendar prev/next buttons missing `aria-label` | `CalendarView.jsx:201-225`, `MobileCalendar.jsx:138-159` | Add `aria-label="Previous week"` etc. |
| 43 | UX | Dark mode incomplete — many components use hardcoded `bg-white` without `dark:` variant | `WorkloadDashboard.jsx`, `WeeklyReport.jsx`, `StatsStrip.jsx`, managers | Audit and add `dark:` variants everywhere. |
| 44 | UX | Weekly report 6-column grid unusable on mobile | `WeeklyReport.jsx:196-219` | Add `overflow-x-auto` or card layout on mobile. |
| 45 | UX | Kanban drag-and-drop uses HTML5 API — no touch or keyboard support | `KanbanBoard.jsx:29-139` | Use dnd-kit (installed) or add status dropdown on each card. |
| 46 | UX | Form labels not associated via `htmlFor`/`id` in EmployeeManager/LocationManager | `EmployeeManager.jsx:202-247` | Add `htmlFor` to Labels and `id` to Inputs. |
| 47 | UX | `MobileCalendar` references `parseISO` without importing it — runtime crash when tapping a schedule | `MobileCalendar.jsx:183` | Add `parseISO` to the date-fns import on line 3. |
| 48 | UX | `useMediaQuery` uses resize event instead of `matchMedia.change` — janky, misses orientation changes | `frontend/src/hooks/useMediaQuery.js:1-17` | Use `matchMedia().addEventListener('change', ...)`. |
| 49 | Privacy | No consent mechanism at registration | `backend/models/schemas.py` (UserRegister) | Add `consent_given` field with timestamp. |
| 50 | Privacy | JWT payload contains PII (email, name) — readable by anyone with token | `backend/core/auth.py:25-33` | Minimize to `user_id` and `role` only. |
| 51 | Privacy | User data in localStorage — persistent, XSS-accessible | `frontend/src/lib/auth.jsx:22,35,45` | Rely on httpOnly cookie + `/auth/me`; drop localStorage cache. |
| 52 | Privacy | Employee email/phone visible to all authenticated users including viewers | `backend/routers/employees.py:19-23` | Mask PII for non-admin roles. |
| 53 | DevOps | Deprecated `@app.on_event("startup"/"shutdown")` — will break in future FastAPI | `backend/server.py:137,223` | Migrate to `lifespan` context manager. |
| 54 | DevOps | No graceful MongoDB startup retry — app silently starts with broken DB | `backend/database.py:9-11` | Add retry loop with exponential backoff. |
| 55 | DevOps | Seed script `deleteMany({})` can destroy production data — no env check | `seed-demo-data.js:86-89` | Refuse to run when `ENVIRONMENT=production`. |
| 56 | DevOps | Dev tools (pytest, black, mypy, flake8) in production `requirements.txt` | `backend/requirements.txt` | Separate into `requirements-dev.txt`. |
| 57 | QA | No file size validation on CSV upload — server reads entire file into memory | `backend/routers/schedules.py:1569` | Check size before reading; reject > 10MB. |
| 58 | QA | Race condition in drag-and-drop relocate — concurrent drags cause state thrashing | `CalendarView.jsx:142-173` | Queue relocations sequentially or use abort controller. |
| 59 | QA | Optimistic Kanban update: if revalidation also fails, UI stuck in wrong state | `KanbanBoard.jsx:186-203` | Pass previous data to `mutate` for guaranteed rollback. |
| 60 | QA | `ExportCsvDialog` blob URL never revoked — memory leak | `ExportCsvDialog.jsx:56-72` | Call `URL.revokeObjectURL(url)` after `link.click()`. |

---

## Pass-by-Pass Detail

### Security Audit

The most urgent finding is **production secrets in git history** (#1) — all credentials must be rotated. The **path traversal vulnerability** (#2) in static file serving allows arbitrary file reads from the server, including the `.env` file. CORS defaults to wildcard with credentials (#6), JWT tokens are long-lived with no revocation (#7-8), and the CSP is effectively disabled (#10). Mass assignment via `deleted_at` in update schemas (#9) allows unauthorized soft-delete manipulation. Input validation is weak — dates, times, statuses, and roles all accept arbitrary strings (#22, #31-33).

### Business Analysis

The core scheduling model is solid with drive time calculation, conflict detection, recurrence, and town-to-town warnings. Key gaps: **cascading deletes missing** — deleting an employee or location leaves orphaned schedules (#20-21). **Bulk location changes bypass conflict checking** (#24). Stats silently truncate at 1000 records (#23). Drive time `*2` overcounts for multi-stop days (#35). The "never-ending" recurrence silently caps at 52 weeks (#36).

### UX/Accessibility

Empty states are well-implemented across all views. However, **destructive single-item deletes have no confirmation** (#28). The **notification panel lacks keyboard accessibility** (#29). Dark mode is partially implemented — Sidebar works but many components use hardcoded `bg-white` (#43). Multiple interactive elements lack `aria-label` (#41-42, #46). Kanban has no touch or keyboard alternative (#45). `MobileCalendar` has a crash bug from missing `parseISO` import (#47).

### Performance

**No database indexes** (#13) means every query is a full collection scan. **Redis connection pools leak** (#14). **N+1 queries** in town-to-town sync (#15). HTTP clients created per-request (#16). Frontend memos are defeated by unstable references (#38-39). All schedules loaded with no date windowing (#30). Seven parallel API calls on every page mount (#40).

### QA/Edge Cases

**CSV import and export are both fundamentally broken** (#4-5) due to `_id` vs `id` field mismatch. No validation that `end_time > start_time` (#22). Delete operations can be double-fired (#28). Race conditions in drag-and-drop (#58) and Kanban optimistic updates (#59). No file size limit on CSV upload (#57). Blob URL memory leak in export (#60).

### DevOps/Infrastructure

**No CI/CD pipeline** (#18) — the test script is a sham. Containers run as root (#17). MongoDB/Redis exposed without auth (#19). No migration framework (#53-54). Rate limiting only on auth endpoints (#34). MongoDB URL with password logged (#12). Deprecated FastAPI lifecycle hooks (#53).

### Data Privacy

Real database exports committed to git (#3). No data retention policy (#25). No GDPR right-to-erasure (#26). Employee PII denormalized across collections without cleanup (#27). No consent mechanism (#49). JWT contains PII (#50). User data in localStorage (#51). Third-party data sharing with Microsoft/Google undocumented.

---

## Score Summary

| Category | Score (1-10) | Notes |
|----------|-------------|-------|
| Security | **3/10** | Secrets in git, path traversal, weak CSP, no email verification, CORS misconfiguration |
| Business Logic | **6/10** | Core scheduling works well; cascading deletes, bulk operations, and stats truncation need work |
| UX/Accessibility | **5/10** | Good empty states and structure; missing ARIA labels, keyboard access, incomplete dark mode |
| Performance | **4/10** | No indexes, connection leaks, N+1 queries, defeated memos, no date windowing |
| QA/Edge Cases | **3/10** | CSV import/export broken, no time validation, no double-click protection, race conditions |
| DevOps/Infrastructure | **3/10** | No CI/CD, root containers, exposed DBs, no migrations, fake test script |
| Data Privacy | **2/10** | PII in git, no retention, no erasure, no consent, undocumented third-party sharing |
| **Overall** | **4/10** | Functional prototype with critical issues blocking production readiness |

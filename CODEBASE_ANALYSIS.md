# Iowa Center HubSpoke Scheduler - Full Codebase Analysis & Improvement Plan

## Context

The Iowa Center HubSpoke Scheduler is a full-stack logistics/scheduling app for managing employee assignments across hub-and-spoke locations. It features automatic drive time calculation, conflict detection, recurring schedules, calendar views, map integration, workload analytics, and activity logging.

**Stack:** React 19 + Vite + Tailwind + shadcn/ui (frontend) | FastAPI + MongoDB + ARQ/Redis (backend) | Docker + Railway (deployment)

The codebase is functional and feature-rich but has security vulnerabilities, architectural bottlenecks, missing tests, and opportunities for significant UX and performance improvements.

---

## Codebase Analysis Summary

### Strengths
- Clean separation of concerns (routers/services/models in backend, hooks/components/lib in frontend)
- Modern stack with async-first backend (Motor, FastAPI)
- Strong data validation via Pydantic on backend
- Rich UI with shadcn/ui + Radix (built-in accessibility)
- SWR for smart data fetching with caching
- Activity logging audit trail
- Docker multi-stage build for deployment

### Issues Found

| Priority | Issue | Impact |
|----------|-------|--------|
| CRITICAL | No CORS configuration in `backend/server.py` | Cross-origin requests unprotected |
| CRITICAL | JWT tokens in localStorage (`frontend/src/lib/auth.jsx`) | XSS exposes all user tokens |
| HIGH | No React Error Boundaries (`frontend/src/App.jsx`) | Component errors crash entire app |
| HIGH | Zero frontend tests | No safety net for UI changes |
| HIGH | No RBAC - all users have full access | No permission model |
| HIGH | No API rate limiting | Brute-force/abuse risk |
| HIGH | No pagination (`backend/routers/schedules.py` line 38: `.to_list(1000)`) | Memory issues at scale |
| HIGH | Monolithic DashboardPage (478 lines, all views in one component) | Maintenance bottleneck |
| MEDIUM | No TypeScript - all JSX | No compile-time type safety |
| MEDIUM | State-based routing - views not bookmarkable | Poor UX, no deep linking |
| MEDIUM | No code splitting / lazy loading | Large initial bundle |
| MEDIUM | No security headers (CSP, X-Frame-Options, HSTS) | Missing defense layers |
| MEDIUM | Inconsistent error responses (dicts vs strings) | Frontend error handling fragile |
| MEDIUM | No soft deletes - hard deletes everywhere | Data loss risk |
| MEDIUM | Schedule denormalization (stale employee/location names) | Data integrity risk |
| MEDIUM | No structured logging | Debugging difficulty in production |
| LOW | Hardcoded magic values (6AM-7PM, color hex codes) | Maintenance burden |
| LOW | Minimal documentation / README | Onboarding difficulty |
| LOW | No Python dependency lock file | Reproducibility risk |

---

## Improvement Plan

### Phase 1: Security Hardening

**1.1 Add CORS Configuration**
- File: `backend/server.py`
- Add `CORSMiddleware` after `app = FastAPI()` with origins from `CORS_ORIGINS` env var

**1.2 Move JWT Tokens to httpOnly Cookies**
- Files: `backend/core/auth.py`, `backend/routers/auth.py`, `frontend/src/lib/api.js`, `frontend/src/lib/auth.jsx`
- Backend: Set JWT as `httpOnly, Secure, SameSite=Lax` cookie on login; read from cookie in `get_current_user` with `Authorization` header fallback
- Frontend: Remove all `localStorage` token operations; add `withCredentials: true` to Axios; verify session via `/api/auth/me` on load
- Add `POST /api/auth/logout` endpoint to clear cookie

**1.3 Add Security Headers Middleware**
- File: `backend/server.py`
- Add middleware injecting: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`, `Referrer-Policy`

**1.4 Add API Rate Limiting**
- Files: `backend/server.py`, new `backend/core/rate_limit.py`
- Use `slowapi` with Redis backend (already available for ARQ)
- Global: ~100 req/min per IP; Auth endpoints: ~5 req/min

---

### Phase 2: Stability & Error Handling

**2.1 Add React Error Boundaries**
- New file: `frontend/src/components/ErrorBoundary.jsx`
- File: `frontend/src/App.jsx`
- Wrap DashboardPage; optionally wrap individual views (calendar, kanban, map) for granular recovery

**2.2 Standardize Backend Error Responses**
- Files: All routers in `backend/routers/`
- Define `ErrorResponse` model in `backend/models/schemas.py`
- Register custom exception handler in `server.py` normalizing all errors to `{"detail": str, "code": str, "errors": list | null}`

**2.3 Add Structured Logging**
- File: `backend/server.py`, all router/service files
- Add request ID middleware; use JSON-formatted log entries with context (user, request_id, entity)

---

### Phase 3: Architecture & Performance

**3.1 Break Up Monolithic DashboardPage**
- File: `frontend/src/pages/DashboardPage.jsx` (478 lines)
- Extract: `CalendarView.jsx`, `ScheduleFilters.jsx`, `StatsStrip.jsx`
- DashboardPage becomes thin layout shell: sidebar + header + view switch + modals

**3.2 Add URL-Based Routing**
- Files: `frontend/src/App.jsx`, `frontend/src/pages/DashboardPage.jsx`
- Replace `/*` catch-all with explicit nested routes: `/calendar`, `/kanban`, `/workload`, `/map`, `/employees`, `/locations`, `/classes`, `/activity`, `/reports`
- Use `useSearchParams()` for calendar view type, date, filters
- Sidebar navigation uses `useNavigate()` instead of state setter

**3.3 Add Code Splitting / Lazy Loading**
- Files: `frontend/src/App.jsx`, `frontend/src/pages/DashboardPage.jsx`
- `React.lazy()` + `<Suspense>` for: MapView, WorkloadDashboard, KanbanBoard, WeeklyReport
- Dynamic `import()` for html2canvas/jspdf (only on PDF export click)
- Vite `manualChunks` for vendor splitting (radix-ui, recharts, date-fns)

**3.4 Add Pagination to Backend**
- Files: `backend/routers/schedules.py`, `employees.py`, `locations.py`
- Add `skip` and `limit` query params; return `{"items": [...], "total": N, "skip": N, "limit": N}`
- Update `frontend/src/hooks/useDashboardData.js` and `frontend/src/lib/api.js` for new response shape

---

### Phase 4: Access Control

**4.1 Add RBAC**
- Files: `backend/models/schemas.py`, `backend/core/auth.py`, `backend/routers/auth.py`, all router files
- Roles: `admin` (full), `scheduler` (CRUD schedules), `viewer` (read-only)
- Add `role` to user document and JWT payload
- Create `RoleRequired(role)` dependency; apply to mutating endpoints
- Frontend: Expose `user.role` via auth context; conditionally render edit/delete UI

---

### Phase 5: Testing

**5.1 Frontend Test Infrastructure**
- Add: vitest, @testing-library/react, @testing-library/user-event, msw
- Priority test files: auth flow, useDashboardData hook, ScheduleForm validation, CalendarWeek rendering

**5.2 Expand Backend Tests**
- Add edge case tests: drive time conflict overlap, recurrence boundary dates, expired/invalid JWT tokens
- Add RBAC integration tests once Phase 4 is complete

---

### Phase 6: Data Integrity & Cleanup

**6.1 Add Soft Deletes**
- Add `deleted_at` field to all entities; change `delete_one` to `update_one` setting timestamp
- Add `{"deleted_at": None}` filter to all list/get queries
- Add admin-only restore endpoint

**6.2 Fix Data Denormalization**
- When updating employee/location/class, sync denormalized fields in related schedules via ARQ background task
- Add `POST /api/system/sync-denormalized` admin endpoint for manual sync

**6.3 Extract Hardcoded Values**
- Create `frontend/src/lib/constants.js` and `backend/core/constants.py`
- Replace all magic numbers, hex colors, and status strings with named constants

---

### Phase 7: Feature Enhancements (highest impact ideas)

| Feature | Description | Effort |
|---------|-------------|--------|
| **Bulk Operations** | Multi-select + bulk delete/update in calendar and kanban views | Medium |
| **CSV/Excel Import-Export** | `GET /api/schedules/export?format=csv`, file upload import | Medium |
| **Schedule Templates** | Save/load common schedule patterns | Low-Medium |
| **Email Notifications** | SendGrid/SES integration via ARQ worker for schedule changes & reminders | Medium |
| **Dark Mode** | Tailwind dark mode classes + next-themes (already a dependency) | Low |
| **WebSocket Real-Time Updates** | Live schedule changes across tabs/users | High |
| **PWA Support** | Service worker + manifest for mobile installability | Low |
| **External Calendar Sync** | Google Calendar / Outlook integration via OAuth | High |
| **Approval Workflows** | Schedule requests requiring manager approval before confirmation | Medium |
| **Employee Schedule Swap** | Self-service shift trading between employees | Medium |
| **Advanced Analytics** | Historical trends, utilization forecasting, drive time optimization | High |
| **Multi-Tenancy** | Organization-scoped data isolation for multiple centers | High |

---

## Verification Plan

After each phase, verify with:
1. **Phase 1**: Test CORS with cross-origin fetch; verify cookies set with `httpOnly` flag in browser DevTools; confirm rate limiting returns 429 on excess requests
2. **Phase 2**: Trigger a rendering error in a component and verify the error boundary catches it; verify all API errors return consistent JSON shape
3. **Phase 3**: Verify URL routing works with browser back/forward; check network tab for lazy-loaded chunks; test pagination with limit/skip params
4. **Phase 4**: Test that viewer role cannot create/delete; test that scheduler can create but not delete employees
5. **Phase 5**: Run `npx vitest` and `pytest` - all tests pass
6. **Phase 6**: Delete and restore an entity; update employee name and verify schedules reflect the change
7. **Phase 7**: Test each feature end-to-end per its requirements

---

## Critical Files Reference

| File | Role | Phases Affected |
|------|------|----------------|
| `backend/server.py` | App setup, middleware, router registration | 1, 2, 3 |
| `backend/core/auth.py` | JWT creation/validation, password hashing | 1, 4 |
| `backend/routers/auth.py` | Login/register endpoints | 1, 4 |
| `backend/routers/schedules.py` | Largest router - schedule CRUD + conflicts | 2, 3, 6 |
| `backend/models/schemas.py` | All Pydantic models | 2, 4, 6 |
| `frontend/src/App.jsx` | Routing, error boundaries, lazy loading | 2, 3 |
| `frontend/src/pages/DashboardPage.jsx` | 478-line monolith to decompose | 3 |
| `frontend/src/lib/api.js` | Axios config + interceptors | 1, 3 |
| `frontend/src/lib/auth.jsx` | Auth context + localStorage | 1, 4 |
| `frontend/src/hooks/useDashboardData.js` | SWR data fetching | 3 |

# Iowa Center Hub & Spoke - Codebase Review (April 2026)

## Context

Comprehensive review of the Iowa Center Hub & Spoke scheduling platform - a full-stack application managing employee class assignments across satellite locations in Iowa (Des Moines hub). The codebase has undergone significant hardening since initial development.

**Stack:** React 19 + TypeScript + Vite + Tailwind + shadcn/ui | FastAPI + MongoDB + ARQ/Redis | Docker + Railway

---

## Current Strengths

| Category | Implementation |
|----------|---------------|
| **Authentication** | JWT in httpOnly cookies, Bearer header fallback, session invalidation on password change |
| **CSRF Protection** | Double-submit cookie with HMAC signature, rotated per response |
| **Authorization** | RBAC with 4 roles (admin, scheduler, editor, viewer) |
| **Rate Limiting** | slowapi + Redis (5/min auth, 100/min global) |
| **Security Headers** | X-Content-Type-Options, X-Frame-Options, HSTS, CSP, Referrer-Policy |
| **Data Safety** | Soft deletes with restore, structured audit trail |
| **Architecture** | Async-first (FastAPI + Motor + arq), clean separation of concerns |
| **Frontend** | TypeScript, code splitting (React.lazy), URL routing, error boundaries |
| **Caching** | HTTP Cache-Control + ETag, 3-tier drive time cache (LRU/MongoDB TTL/Google API) |
| **DevOps** | Docker multi-stage build, docker-compose, GitHub Actions CI, Sentry |
| **Data Integrity** | Denormalization sync via background jobs, MongoDB compound indexes |
| **Integrations** | Google Calendar + Outlook Calendar sync, Google Maps/Distance Matrix |

---

## Remaining Issues

### High Priority

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | Frontend tests not in CI | `.github/workflows/ci.yml` | Test regressions undetected |
| 2 | CORS defaults to wildcard in production | `backend/server.py` | Security misconfiguration |
| 3 | Frontend API types use `Record<string, unknown>` | `frontend/src/lib/api.ts` | TypeScript safety undermined |
| 4 | `isRedirectingTo401` never reset | `frontend/src/lib/api.ts` | Subsequent 401s silently swallowed |
| 5 | Synchronous Redis in health check | `backend/server.py` health endpoint | Blocks async event loop |

### Medium Priority

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 6 | Per-request DB query in auth (`password_changed_at` check) | `backend/core/auth.py` | Added latency on every request |
| 7 | No httpx connection pooling for Google API | `backend/services/drive_time.py` | TLS handshake overhead |
| 8 | Deprecated `travel_override_minutes` still in schemas | `backend/models/schemas.py` | API confusion |
| 9 | Legacy `/api/` route duplication | `backend/server.py` | Maintenance burden |
| 10 | Worker health monitoring missing | `backend/worker.py` | Silent background job failures |

### Low Priority

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 11 | No retry on Google Distance Matrix API | `backend/services/drive_time.py` | Inaccurate estimates on transient errors |
| 12 | CSP allows `'unsafe-inline'` for scripts | `backend/server.py` | Weakened XSS protection |
| 13 | Password minimum only 8 chars, no complexity | `backend/models/schemas.py` | Brute-force risk |
| 14 | No Python dependency lock file | `backend/requirements.txt` | Non-deterministic builds |
| 15 | No database backup automation | Infrastructure | Data loss risk |

---

## Testing Coverage

| Area | Status | Notes |
|------|--------|-------|
| Backend auth/RBAC | Good | 3 test files |
| Backend recurrence | Good | 2 test files (19KB+) |
| Backend workload/stats | Good | 3 test files |
| Backend schedule CRUD | Missing | No router-level tests |
| Backend calendar sync | Missing | No tests |
| Backend drive time | Missing | No tests |
| Frontend hooks | Partial | 3 test files |
| Frontend components | Minimal | 1 test file |
| Integration/E2E | Missing | No Playwright/Cypress |
| CI backend | Active | flake8 + pytest |
| CI frontend | Build only | Tests not executed |

---

## Architecture Notes

- `schedule_helpers.py` (21KB) is the largest file - calendar-related helpers could be extracted
- Worker imports `_build_schedule_doc` from routers, creating tight coupling
- No database abstraction layer - raw MongoDB ops repeated across routers
- Root-level test files (`backend_test.py`, `test_auth.py`) not picked up by CI

---

## Overall Assessment

**The codebase is production-ready and well-maintained.** Security, architecture, and reliability have been hardened significantly. The most impactful improvements would be closing testing gaps (frontend CI, schedule CRUD tests) and the minor security/performance items listed above.

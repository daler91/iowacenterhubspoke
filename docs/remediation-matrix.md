# Remediation Matrix (Maintainers)

Source inputs:
- `AGENT_REVIEW_REPORT.md` (generated 2026-04-16)
- `docs/tech-debt-followups.md` (`## Open` section)

This matrix normalizes all currently open or not-explicitly-completed findings into one tracker.

## Status model
- **Open**: not yet started
- **In Progress**: active implementation
- **Blocked**: pending dependency/decision
- **Completed**: merged and verified

> Milestone closure policy: all **High** severity rows must include an explicit **Disposition** (`Fixed`, `Accepted Risk`, `Deferred w/ exception`) before a milestone may be marked complete.

## Unified remediation matrix

| ID | Source | Severity | Owner | Target milestone | Status | Disposition | Code location (path + function/class) | Verification method / acceptance test |
|---|---|---|---|---|---|---|---|---|
| R-001 | Review Critical #1 | High | Backend + Data Privacy | 2026-Q2.1 | Open | TBD | `backend/routers/users.py` (`delete_user`), `backend/services/activity.py` (`log_activity` + activity readers) | Integration test: delete user => PII redacted in activity feed and authored refs are soft-deleted/rewired; no orphan user FK semantics. |
| R-002 | Review Critical #2 | High | Backend Security | 2026-Q2.1 | Open | TBD | `backend/server.py` (`sentry_sdk.init`) | Unit test for `before_send` scrubber masks password/token/cookie fields in nested payloads before emit. |
| R-003 | Review Critical #3 | High | Frontend + Privacy | 2026-Q2.1 | Open | TBD | `frontend/src/index.tsx` (PostHog init), `frontend/src/lib/auth.tsx` (`logout`), `frontend/src/App.tsx` (consent UX) | E2E: consent rejected => no identify/capture; consent accepted => analytics allowed; logout calls `posthog.reset()`. |
| R-004 | Review Critical #4 | High | Backend Security | 2026-Q2.1 | Open | TBD | `backend/core/token_vault.py` (`TokenVault.__init__`/encrypt-decrypt flow), OAuth config bootstrap | Startup test: with OAuth creds and missing `TOKEN_ENCRYPTION_KEY`, app fails fast; with key present, tokens are encrypted at rest. |
| R-005 | Review Critical #5 | High | Backend Scheduling | 2026-Q2.1 | Open | TBD | `backend/routers/schedule_crud.py` (`relocate_schedule`) | Concurrency test: two relocations on same schedule => exactly one succeeds, other 409 on atomic guard miss. |
| R-006 | Review Critical #6 | High | Backend Security | 2026-Q2.2 | Open | TBD | `backend/routers/portal/auth.py`, `backend/core/portal_auth.py` (portal token lifecycle) | API test: revoke endpoint invalidates token immediately; usage audit fields (`last_used_at`, IP) captured. |
| R-007 | Review Critical #7 | High | DevOps + Security | 2026-Q2.1 | In Progress | TBD | `.github/workflows/ci.yml`, `backend/requirements.txt` | CI must run dep vuln scan + secret scan + backend typing gate; dependency policy checks fail on EOL/critical packages. |
| R-008 | Review Warning #1 | Medium | Backend Security | 2026-Q2.2 | Open | TBD | `backend/core/auth.py` (`JWT_SECRET` fallback config) | Startup/config test: multi-worker-like env requires explicit `JWT_SECRET`; clear warning in single-process dev only. |
| R-009 | Review Warning #2 | Medium | Backend Security | 2026-Q2.2 | Open | TBD | `backend/core/auth.py` (`_get_pwd_changed_ts` cache path) | Multi-worker test with shared Redis invalidation: stale JWT rejected across workers within defined SLA. |
| R-010 | Review Warning #3 | Medium | Backend Security | 2026-Q2.2 | Open | TBD | `backend/server.py` (CORS parsing/validation) | Config validation test rejects wildcard/path-based origins when credentials enabled. |
| R-011 | Review Warning #4 | Medium | Backend Platform | 2026-Q2.2 | Open | TBD | `backend/core/logger.py` (structured logger formatter/filter) | Unit test redacts nested sensitive keys in `extra` payloads recursively. |
| R-012 | Review Warning #5 | Medium | Backend Scheduling | 2026-Q2.2 | Open | TBD | `backend/routers/schedules.py` (bulk endpoints), `backend/core/rate_limit.py` | Schema test enforces max ids length; load test confirms per-item or weighted rate-limit accounting. |
| R-013 | Review Warning #6 | Medium | Backend API | 2026-Q2.2 | Open | TBD | `backend/models/schemas.py`, `backend/routers/schedule_import.py` | Validation tests reject oversized text fields consistently across API + CSV import. |
| R-014 | Review Warning #7 | Medium | Backend Infra | 2026-Q2.3 | Open | TBD | `backend/migrations/runner.py` | Distributed startup test: only one instance acquires migration lock and runs writes. |
| R-015 | Review Warning #8 | Medium | Backend Performance | 2026-Q2.3 | Open | TBD | `backend/services/town_to_town.py` (`build_town_to_town_segments`/location lookup loop) | Profiling/unit test asserts single batched location fetch replaces N+1 per sibling lookup. |
| R-016 | Review Warning #9 | Medium | Frontend UX/A11y | 2026-Q2.2 | Open | TBD | `frontend/src/components/{EmployeeManager,LocationManager,ClassManager,UserManager}.tsx` | a11y E2E/axe: icon-only actions include descriptive `aria-label`; icons are `aria-hidden`. |
| R-017 | Review Warning #10 | Medium | Frontend UX/A11y | 2026-Q2.2 | Open | TBD | `frontend/src/components/ScheduleForm.tsx` | E2E: failed step validation sets `aria-invalid`, focuses first invalid field, retains toast. |
| R-018 | Review Warning #11 | Low | Frontend UX/A11y | 2026-Q2.3 | Open | TBD | `frontend/src/App.tsx` (Suspense fallback) | Accessibility check verifies `role=status`, `aria-live=polite`, and screen-reader label present. |
| R-019 | Review Warning #12 | Low | DevOps | 2026-Q2.3 | Open | TBD | `Dockerfile.dev` | Container startup test verifies reload toggled strictly by `UVICORN_RELOAD=1`. |
| R-020 | Review Warning #13 | Medium | DevOps | 2026-Q2.3 | Open | TBD | `Dockerfile`, `Dockerfile.dev` | Container healthcheck test fails unhealthy process and succeeds healthy `/api/v1/health`. |
| R-021 | Review Warning #14 | Medium | Backend Business Rules | 2026-Q2.3 | Open | TBD | `backend/routers/projects.py` (phase advance endpoint, `force` branch) | Authorization test: only admin can force; audit log contains skipped-task list. |
| R-022 | Review Warning #15 | Medium | Frontend QA | 2026-Q2.2 | Open | TBD | `frontend/src/components/ScheduleForm.tsx` and schedule mutation dialogs | UI tests assert submit/delete controls disable during in-flight to prevent duplicate mutation. |
| R-023 | Review Suggestion #1 | Low | Frontend Performance | 2026-Q3.1 | Open | TBD | `frontend/src/hooks/useDashboardData.ts` (`extractItems`) | Unit test/DEV check confirms noisy warn removed or DEV-gated and payload sanitized. |
| R-024 | Review Suggestion #2 | Low | Frontend Performance | 2026-Q3.1 | Open | TBD | `frontend/vite.config.js` | Bundle analysis: `@tiptap/*` and `@dnd-kit/*` moved off main chunk. |
| R-025 | Review Suggestion #3 | Low | Frontend Performance | 2026-Q3.1 | Open | TBD | `frontend/src/components/KanbanBoard.tsx`, `CalendarWeek.tsx` | Render perf benchmark for >100 cards shows reduced re-renders after memoization. |
| R-026 | Review Suggestion #4 | Low | Frontend UX | 2026-Q3.1 | Open | TBD | `frontend/src/components/ErrorBoundary.tsx` | UX test verifies actionable fallback copy + reload CTA; details remain optional. |
| R-027 | Review Suggestion #5 | Low | Frontend UX | 2026-Q3.1 | Open | TBD | `frontend/src/components/LocationManager.tsx` | Failure-path test verifies user-facing toast on drive-time auto-calc error. |
| R-028 | Review Suggestion #6 | Medium | Backend Scheduling | 2026-Q3.1 | Open | TBD | `backend/services/schedule_utils.py` (recurrence arithmetic) | DST boundary tests (spring/fall) preserve intended local schedule times. |
| R-029 | Review Suggestion #7 | Medium | Backend Privacy | 2026-Q3.2 | Open | TBD | `backend/routers/users.py` (`/users/me/export`, deletion request flow) | API tests validate export completeness and request-delete workflow with approval checks. |
| R-030 | Review Suggestion #8 | Medium | Frontend + Legal/Privacy | 2026-Q3.2 | Open | TBD | `frontend/src/App.tsx`, new privacy page route/component | UI test verifies persistent privacy-policy link and route content availability. |
| R-031 | Review Suggestion #9 | Low | DevOps | 2026-Q3.2 | Open | TBD | `.env.example` | Static check verifies placeholder sender domain (`example.com`) + replace marker. |
| R-032 | Review Suggestion #10 | Medium | Backend Infra | 2026-Q3.2 | Open | TBD | `backend/server.py` (health endpoint), worker heartbeat emitter | Integration test marks health degraded when worker heartbeat stale. |
| R-033 | Review Suggestion #11 | Low | Backend API | 2026-Q3.2 | Open | TBD | `backend/routers/schedule_crud.py` (linked projects query cap) | Test with >500 linked projects confirms pagination or explicit truncation warning behavior. |
| R-034 | Review Suggestion #12 | Medium | DevOps/Security | 2026-Q3.2 | Open | TBD | `docker-compose.yml` (secret handling) | Deployment checklist test ensures secrets are not injected via plain `env_file` in production profile. |
| R-035 | Tech-debt Open #1 | Medium | Backend Platform | 2026-Q3.1 | Open | TBD | `backend/core/repository.py` (`SoftDeleteRepository`), remaining routers under `backend/routers/` | Migration checklist per-router: no raw `deleted_at` filters remain (`rg` static check + targeted API regressions). |
| R-036 | Tech-debt Open #2 | Medium | Frontend Platform | 2026-Q3.1 | Open | TBD | `.github/workflows/ci.yml`, `frontend/src/components/Calendar*.tsx`, `frontend/src/components/coordination/*.tsx` | CI step `cd frontend && npx tsc --noEmit` added and passing. |
| R-037 | Tech-debt Open #3 | Low | Frontend Architecture | 2026-Q3.1 | Open | TBD | `frontend/src/components/UserManager.tsx`, `LocationManager.tsx` | Static threshold check (component LOC) + unit tests for extracted subcomponents. |
| R-038 | Tech-debt Open #4 | Low | Frontend Performance | 2026-Q3.2 | Open | TBD | `frontend/src/components/{ActivityFeed,WeeklyReport,UserManager}.tsx` | Performance test confirms virtualized rendering for large row counts. |
| R-039 | Tech-debt Open #5 | Medium | Frontend API typing | 2026-Q3.2 | Open | TBD | `frontend/src/lib/api.ts` (`schedulesAPI.*` payload types), schedule form payload builder | Type tests: strict payload signatures compile; invalid shape rejected at compile time. |
| R-040 | Tech-debt Open #6 | Medium | Backend Platform | 2026-Q3.2 | Open | TBD | `backend/server.py` (`legacy_router`, `legacy_api_deprecation_middleware`) | Access-log window proves zero `/api/*` hits; regression test ensures only `/api/v1/*` exposed. |
| R-041 | Tech-debt Open #7 | Medium | Backend Security | 2026-Q3.2 | Open | TBD | `backend/core/auth.py` (`_get_pwd_changed_ts` cache) | Multi-worker auth tests validate Redis-backed invalidation or JWT versioning strategy. |

## Maintenance notes
- Keep this file updated in the same PR as each remediation change.
- When setting **Status=Completed**, fill **Disposition** and include proof in the PR (test names, command output, or artifact link).

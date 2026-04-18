# Code Review Report — Iowa Center Hub & Spoke
Generated: 2026-04-16

## Executive Summary

The codebase is a mature full-stack scheduling platform (FastAPI + Motor MongoDB + Redis + arq; React 19 + TS + Vite) with strong security foundations (JWT cookies, CSRF double-submit, CSP, rate limiting, bcrypt, Sentry) and good engineering hygiene (Playwright a11y tests, structured logging, soft-delete pattern, content-addressed Vite chunks, pre-commit hooks). Top concerns before shipping: hard-delete of users cascades orphan PII into audit logs, Sentry and PostHog are wired without redaction/consent controls, OAuth refresh-token encryption is optional, and a handful of bulk-write endpoints lack atomic read-modify-write guarantees against rapid-fire clients. None of the findings are architectural — all are focused, fixable gaps.

## Critical Findings (must fix before shipping)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| 1 | Privacy | Hard-delete of users leaves user_id references (`created_by`, audit logs, schedule authorship) orphaned with no redaction; PII cascade is reconstructable | `backend/routers/users.py:138-147`, `backend/services/activity.py` | Switch to soft-delete with `deleted_at` (pattern already used on employees/locations/schedules — see `server.py:79-82`); redact name/email on deleted-user activity log reads |
| 2 | Privacy | Sentry `init` has no `before_send` hook — 5xx on login/bulk endpoints can upload request bodies containing passwords, JWT cookies, OAuth tokens, calendar payloads to a third party | `backend/server.py:11-18` | Add `before_send` callback that scrubs `Authorization`, `Cookie`, `csrf_token`, `password`, `token`, `new_password`, `current_password` from event payloads before send |
| 3 | Privacy | PostHog analytics loaded without consent banner, no `posthog.reset()` on logout → once any code path calls `identify()`, user's email/id flows to a third party with no opt-out | `frontend/src/index.tsx` (PostHog init), `frontend/src/lib/auth.tsx` (logout), `App.tsx` (no banner) | Add cookie/analytics consent banner; call `posthog.reset()` in logout; gate `identify()` behind accepted consent |
| 4 | Security | OAuth refresh-token encryption is optional — if `TOKEN_ENCRYPTION_KEY` is unset, Google/Outlook refresh tokens are stored in MongoDB in plaintext. Google Calendar refresh tokens grant long-lived API access to an employee's calendar | `backend/core/token_vault.py:9-14` | Make `TOKEN_ENCRYPTION_KEY` required when any OAuth integration is enabled; fail-fast on startup if Google/Outlook credentials are configured but the key is absent |
| 5 | QA/Data Integrity | `relocate_schedule` performs read → conflict-check → update without atomic guard. Two concurrent relocations race: both pass conflict check against the original state, both apply | `backend/routers/schedule_crud.py:429-443` | Use `find_one_and_update` with filter `{"id": id, "date": original_date, "start_time": original_start}`; 409 on filter miss |
| 6 | Security | Portal bearer tokens (7-day lifetime for partner contact portal access) have no server-side revocation endpoint — a compromised token is valid for full TTL | `backend/routers/portal/auth.py`, `backend/core/portal_auth.py` | Add `DELETE /portal/auth/revoke/{token_id}` (admin-only); log token usage to activity feed with last_used_at/IP |
| 7 | Security | CI has no SAST, dependency vulnerability scan, or secret scan; `passlib==1.7.4` is end-of-life and backend has no type-checker gate | `.github/workflows/ci.yml`, `backend/requirements.txt` | Add `pip-audit` / `safety`, `gitleaks` or `trufflehog`, and `mypy`/`pyright` steps; bump or drop `passlib` in favor of direct `bcrypt` |

## Warnings (should fix soon)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| 1 | Security | `JWT_SECRET` fallback is an in-process random secret in non-production. Multi-worker dev deployments (Railway preview envs that set `ENVIRONMENT=development`) will reject tokens issued by sibling workers | `backend/core/auth.py:14-26` | Require `JWT_SECRET` in any environment with >1 worker; log a clearer warning that the fallback only works in single-process dev |
| 2 | Security | Password-change invalidation cache is per-process, 5-min TTL. After password reset, a stolen JWT still validates on sibling workers for up to 5 minutes | `backend/core/auth.py:103-134` | Move invalidation signal to Redis (publish user_id on password change; each worker listens), or drop cache TTL to 30s |
| 3 | Security | CORS `allow_origins` built from env env with `allow_credentials=True` — if an operator sets `CORS_ORIGINS=*` by mistake, credentialed requests from any origin are accepted (FastAPI will refuse `*` + credentials, but `https://*.example.com` substrings are not validated) | `backend/server.py:522-541` | Refuse startup if `CORS_ORIGINS` contains `*`; validate each entry is a scheme+host (no wildcards or paths) |
| 4 | Privacy | Backend JSON logger (`core/logger.py`) does not recursively redact `password`/`token`/`authorization` fields from structured `extra` payloads | `backend/core/logger.py` | Add a formatter filter that walks `extra` dict and masks known sensitive keys; unit-test with sample log records |
| 5 | QA | Bulk endpoints accept unbounded `ids[]` arrays; 1 rate-limit credit = N DB writes. A single `POST /schedules/bulk-delete` with 10k ids is one credit | `backend/routers/schedules.py` (bulk-*), `backend/core/rate_limit.py` | Cap `ids` array length (e.g., 500) in Pydantic; add a separate per-item rate counter for bulk ops |
| 6 | QA | Pydantic text fields (`notes`, descriptions) have no `max_length`. Unbounded notes enable cheap disk/memory DOS | `backend/models/schemas.py:94,134,212` and siblings | Add `Field(..., max_length=5000)` on all free-text fields; enforce same in CSV import (`backend/routers/schedule_import.py:34`) |
| 7 | QA | Migration runner is not distributed-locked; two app instances booting simultaneously can race migration writes | `backend/migrations/runner.py` | Guard with a Redis `SET NX EX` lock or a unique MongoDB doc `migration_lock` with TTL; single-winner runs migrations |
| 8 | Performance | `town_to_town.py:140-162` is an N+1 — for each sibling schedule, a separate `find_one` for its location | `backend/services/town_to_town.py:140-162` | Collect all `location_id`s, one `find({id: {$in: ...}})`, build a dict, iterate siblings against the map |
| 9 | UX/A11y | Icon-only action buttons (Eye/Pencil/Trash) in list managers lack `aria-label`; screen readers announce only "button" | `frontend/src/components/EmployeeManager.tsx`, `LocationManager.tsx`, `ClassManager.tsx`, `UserManager.tsx` | Add `aria-label="Edit employee"` etc.; mark the Lucide icon `aria-hidden="true"` |
| 10 | UX/A11y | `ScheduleForm.tsx` step validation surfaces only via toast — invalid fields are not highlighted, no `aria-invalid`, no focus transfer | `frontend/src/components/ScheduleForm.tsx` | Set `aria-invalid` on empty-required fields; move focus to first invalid field on step-advance failure; keep toast as augmentation |
| 11 | UX | App.tsx Suspense fallback is a bare spinner with no `role="status"` / `aria-live` / sr-only label | `frontend/src/App.tsx:68-71` | Add `role="status" aria-live="polite"` and an `sr-only` "Loading page…" label |
| 12 | DevOps | `Dockerfile.dev` hardcodes `--reload` in CMD; if misused in staging it enables unintended restarts | `Dockerfile.dev` | Gate `--reload` behind `UVICORN_RELOAD=1` env; keep off by default |
| 13 | DevOps | No `HEALTHCHECK` in either Dockerfile; orchestrators can't auto-recycle stuck containers | `Dockerfile`, `Dockerfile.dev` | Add `HEALTHCHECK CMD curl -f http://localhost:8080/api/v1/health \|\| exit 1` |
| 14 | Business | Phase advancement in coordination module accepts `force=true` with incomplete tasks, allowing skip past mandatory playbook gates described in PRD | `backend/routers/projects.py:350-370`, `PARTNER_COORDINATION_PRD.md` | Restrict `force=true` to admin role; audit-log every forced advance with the list of skipped tasks |
| 15 | QA | Frontend mutating actions (ScheduleForm submit, series delete, bulk ops) don't uniformly disable their trigger button during in-flight requests — rapid clicks can fire duplicates | `frontend/src/components/ScheduleForm.tsx`, dialogs that wrap `schedulesAPI.deleteSeries` | Track `isSubmitting` state; disable button; gate re-entry in the handler |

## Suggestions (nice to have)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| 1 | Performance | Noisy `console.warn` in `extractItems` hot path — fires on every empty response; logs raw response keys to the browser console including potential user emails | `frontend/src/hooks/useDashboardData.ts:9-11` | Gate behind `import.meta.env.DEV`; shorten payload preview |
| 2 | Performance | `Vite` manual chunk split omits `@tiptap/*` and `@dnd-kit/*` — they ship in the main bundle on every page | `frontend/vite.config.js` | Add `vendor-editor` and `vendor-dnd` manual chunks |
| 3 | Performance | `useMemo`/`React.memo` sparse on KanbanBoard cards and Calendar list rows; noticeable jank during drag when card count > 100 | `frontend/src/components/KanbanBoard.tsx`, `CalendarWeek.tsx` | Wrap cards in `memo`; memoize `dnd-kit` sensors array with empty deps |
| 4 | UX | `ErrorBoundary` non-chunk error message is bare `error.message` — low-context for users (e.g. "Network timeout" with no "try again" guidance) | `frontend/src/components/ErrorBoundary.tsx:86` | Add a human sentence + reload CTA; keep detailed message behind "Show details" |
| 5 | UX | `LocationManager` drive-time auto-calc failure swallows error with `console.warn` — user sees an empty field, no indication why | `frontend/src/components/LocationManager.tsx:52` | Toast a user-facing message |
| 6 | Business | Recurrence arithmetic in `backend/services/schedule_utils.py` uses naive datetime — DST transitions shift derived dates by 1 hour | `backend/services/schedule_utils.py:25-100` | Use timezone-aware datetime + `dateutil.rrule` for rule evaluation |
| 7 | Privacy | No `/users/me/export` (GDPR Article 20) or `/users/me/request-delete` self-service endpoints | `backend/routers/users.py` | Add export endpoint that returns user + owned entities as JSON; add soft-delete self-request with admin approval |
| 8 | Privacy | No cookie/privacy policy link in footer — users aren't told Sentry, PostHog, Google/Outlook tokens are collected | `frontend/src/App.tsx`, new `/privacy` page | Create `/privacy` page; link from a persistent footer |
| 9 | DevOps | `.env.example` uses the real domain `noreply@iowacenter.org`; copy-paste into prod leaks deliverability baselines | `.env.example:26` | Change to `noreply@example.com` with an explicit `# REPLACE ME` marker |
| 10 | DevOps | `/api/v1/health` checks Mongo + Redis but not arq worker heartbeat; dead workers look healthy | `backend/server.py:569-590` | Worker writes Redis heartbeat key on loop tick; health check reads with max-staleness |
| 11 | QA | Hardcoded `.to_list(500)` on linked projects fetch silently drops beyond-500 results | `backend/routers/schedule_crud.py:80` | Raise to a page size that matches the caller's expected max; log warning if truncated |
| 12 | DevOps | `docker-compose.yml` loads backend secrets via `env_file` — visible to `docker inspect` and child processes | `docker-compose.yml` | Use Docker secrets or bind-mount a read-only `.env` with restricted perms in production compose |

## Pass-by-Pass Detail

### Security Audit

Strong foundations: JWT is HS256 with explicit `JWT_SECRET` required in prod (`core/auth.py:14-26`); double-submit CSRF with HMAC-signed, rotated-per-response tokens (`server.py:398-433`); CSP, HSTS, X-Frame-Options set in middleware (`server.py:500-508`); bcrypt for passwords; rate limiting via slowapi; upload size and content-type whitelist (10 MB, 9 types) in `core/upload.py`; SPA static-serve uses a pre-built allow-set rather than path-join of user input (`server.py:649-699`). Legacy `/api/*` routes are actively being sunset with RFC 8594 headers (`server.py:616-638`).

Gaps:
- **JWT secret fallback** (`core/auth.py:14-26`): non-production fallback uses per-process random secret — inconsistent across workers.
- **Password-change invalidation** (`core/auth.py:103-134`): in-process only with 5-min TTL; multi-worker stale-auth window.
- **OAuth token vault** (`core/token_vault.py:9-14`): encryption key is optional; plaintext fallback silently stores refresh tokens.
- **Portal tokens** (`core/portal_auth.py`, `routers/portal/*`): no server-side revocation endpoint; stolen token valid for full 7-day TTL.
- **CORS config** (`server.py:522-541`): env-driven list is not validated against wildcards; `allow_credentials=True` paired with a sloppy env would be dangerous.
- **CI gates** (`.github/workflows/ci.yml`): no SAST, no dep vuln scan, no secret scan, no backend type-checker.
- **Dependencies** (`backend/requirements.txt`): `passlib==1.7.4` is EOL; pin drift should be audited.

No critical hardcoded credentials or obvious injection surfaces found. MongoDB queries consistently use Motor parameterized APIs (no string-concatenation queries observed). `verify_rbac.py:5,10` contains a `"test_secret"` literal but the file is test-only.

### Business Analysis

The app solves its stated business problem: hub-and-spoke scheduling across Iowa locations with drive-time, conflict detection, recurrence, CSV import/export, and the partner-coordination module described in `PARTNER_COORDINATION_PRD.md`. Data model in `backend/models/schemas.py` and `coordination_schemas.py` aligns with PRD entities (projects, tasks, partner_orgs, partner_contacts, documents, messages, portal_tokens). Phase enforcement is largely correct.

Gaps:
- **Phase-gate bypass** (`backend/routers/projects.py:350-370`): `force=true` advances past incomplete tasks with only a warning; PRD intent is stricter.
- **Recurrence across DST** (`backend/services/schedule_utils.py:25-100`): naive datetime arithmetic shifts derived dates by 1 hour at US spring/fall transitions.
- **Auto-schedule with empty employee list** (`backend/routers/projects.py:345`): creating a project with `auto_create_schedule=true` and `employee_ids=[]` passes validation, producing a malformed schedule document.

Scope drift: minimal — features in code match the PRD; the "partner bandwidth" dashboard metric is appropriately deferred to Phase 2.

### UX / Accessibility

Good foundation: dedicated Playwright a11y suite with axe-core (`frontend/tests/e2e/a11y.spec.ts`), keyboard nav test (`keyboard.spec.ts`), custom ErrorBoundary with stale-chunk recovery (`ErrorBoundary.tsx`), skeleton loaders (`ui/skeleton.tsx`), ScheduleForm exposes `role="tablist"` / `aria-selected` / `aria-controls` correctly, Radix UI primitives provide accessibility baseline, `focus-visible` rings in button styles, Lucide icons used consistently (no raw `<img>` to miss `alt` on).

Gaps:
- **Icon-only action buttons** lack `aria-label` in the four list managers (EmployeeManager, LocationManager, ClassManager, UserManager).
- **ScheduleForm step validation** shows only toast; no `aria-invalid` on empty required fields, no focus return.
- **App.tsx Suspense fallback** (lines 68-71) has no `role="status"` / `aria-live` / sr-only text.
- **LocationManager:52** swallows auto-calc failure with `console.warn` — user sees an empty field with no explanation.
- **ErrorBoundary fallback** (line 86) displays raw `error.message` without user-actionable guidance for non-chunk errors.

Mobile responsiveness: Tailwind breakpoints used throughout; dedicated `mobile.spec.ts` E2E present. Color contrast: Tailwind tokens used, no obvious low-contrast `text-gray-300 on white` patterns spotted in spot checks.

### Performance

Good choices: SWR with `revalidateOnFocus: false`, `dedupingInterval: 2000`, `errorRetryCount: 5` (`useDashboardData.ts:15-20`); sourcemap `hidden` for Sentry; manual Vite chunks for UI/charts/date; route-level `lazy()` with Suspense in App.tsx; ETag + Cache-Control middleware on GET APIs (`server.py:437-477`); MongoDB indexes created at startup for every hot query path (`server.py:72-160`); TTL indexes on notifications/dedup ledger/queue prevent unbounded growth.

Note on useDashboardData: the 7 `useSWR` hooks run in parallel automatically (each mounts independently), so the original "sequential" concern is invalid; kept out of warnings. The real issue is noisy log in `extractItems` (Suggestion 1).

Gaps:
- **N+1 in town_to_town** (`backend/services/town_to_town.py:140-162`): per-sibling `find_one` for location.
- **KanbanBoard / CalendarWeek memoization**: cards not wrapped in `memo`; `useSensors` recreated per render.
- **Bundle split**: `@tiptap/*`, `@dnd-kit/*` fall into main bundle.
- **Hot-path console.warn**: `extractItems` logs raw response on every empty array.

No unbounded `useEffect` chains or sequential API waterfalls spotted. Drive-time cache in MongoDB has unique key + TTL index (`server.py:85-86`).

### QA / Edge Cases

Strengths: soft-delete via `deleted_at` on core entities; index on `deleted_at` in every relevant collection; `findOneAndUpdate` used for most state transitions (schedules status, user approval); Pydantic validation everywhere at the boundary; SWR retry logic prevents ephemeral-failure UX degradation; background calendar tasks drained on shutdown with 10s grace (`server.py:312-321`); CSRF exempt list is narrow and explicit.

Gaps:
- **relocate_schedule race** (`routers/schedule_crud.py:429-443`): fetch → conflict-check → update is not atomic against the original snapshot.
- **Bulk endpoints** (`routers/schedules.py` bulk-*): no per-item cap in Pydantic; one rate-limit credit per bulk-of-N.
- **Free-text length caps** (`models/schemas.py:94,134,212`): missing `max_length` on `notes` fields; cheap DOS via 10 MB notes.
- **`linked_projects` page-size** (`routers/schedule_crud.py:80`): hardcoded `.to_list(500)` silently truncates.
- **Frontend double-click protection**: submit buttons are not uniformly disabled during in-flight.
- **Series delete** (`routers/schedule_crud.py:345-360`): 200 with `deleted_count: 0` when series_id doesn't exist; no 404.

Network failure handling in frontend: errors surface via SWR onError → toast, but mutation rollback is ad-hoc (not a shared pattern).

### DevOps / Infrastructure

Strengths: multi-stage Dockerfile; pre-commit hooks wired (`.pre-commit-config.yaml`); structured JSON logging with request-id context (`core/logger.py`, `server.py:511-520`); migration runner refuses to start on failure (`server.py:289-293`); index creation is idempotent; frontend build artifacts served with hashed chunks at immutable cache and `no-cache` on index.html (`server.py:668-685`); legacy routes sunset via RFC 8594 headers; Sentry with explicit `ENVIRONMENT` tag.

Gaps:
- **No HEALTHCHECK** in either Dockerfile.
- **`--reload` hardcoded in `Dockerfile.dev` CMD** — not env-gated.
- **CI missing**: SAST, dep vuln scan, secret scan, backend type check (mypy/pyright).
- **docker-compose** secrets via env_file (visible to `docker inspect`).
- **Migration runner** is not distributed-locked — two boots race.
- **Health check** doesn't probe arq worker liveness.
- **Rate limiting** doesn't protect bulk-by-count.
- **`.env.example`** has a real-looking domain (`noreply@iowacenter.org`).

Backend requirements are mostly pinned; `passlib==1.7.4` is EOL. No `pip-audit` in CI.

### Data Privacy

Collected PII: user `email` (EmailStr), `name`, `password` (bcrypt'd); employee `name`, `email`, `phone`, calendar tokens; partner contact `name`, `email`, `phone`; location `latitude`/`longitude`; activity logs store `user_name`. OAuth refresh tokens for Google/Outlook are stored and optionally encrypted via `core/token_vault.py`.

Gaps:
- **Hard-delete user → orphan PII** in activity logs and `created_by` fields (Critical 1).
- **Sentry without `before_send`** → request bodies including passwords and tokens can be shipped (Critical 2).
- **PostHog without consent** and no `posthog.reset()` on logout (Critical 3).
- **OAuth token encryption optional** (Critical 4).
- **Portal token revocation** missing (Critical 6).
- **Backend logger** doesn't recursively redact `password` / `token` / `authorization` in `extra` dicts.
- **No `/users/me/export` or `/users/me/delete`** (GDPR Articles 15/17/20).
- **No cookie banner / privacy policy page**.

By design and acceptable: portal auth is magic-link + short-lived bearer; notifications have TTL; `oauth_states` cleared at 10 min. Google/Outlook service-account auth pattern is fine; scopes should be documented in README.

## Score Summary

| Category | Score (1-10) | Notes |
|----------|-------------|-------|
| Security | 7 | Strong core (CSP, CSRF, JWT, bcrypt, rate limit, upload hardening) but OAuth token encryption is optional, no CI security gates, EOL passlib, portal token revocation missing |
| Business Fit | 8 | Data model and scheduling logic match PRD; phase-gate `force=true` bypass and naive-datetime recurrence are the main correctness gaps |
| UX / Accessibility | 7 | Good test coverage, Radix primitives, skeletons, error boundary — held back by icon-button aria gaps and toast-only form validation |
| Performance | 7 | SWR tuned well, indexes present, bundle split in place; one real N+1, some missing memoization, bundle split is incomplete |
| QA / Edge Cases | 6 | Pydantic + soft-delete are solid; relocate race, unbounded free-text, bulk-without-caps, and lack of frontend in-flight disabling pull this down |
| DevOps | 6 | Structured logging, pre-commit, sunset headers all good; CI lacks security/type gates, no HEALTHCHECK, migration runner unlocked, compose secrets leak |
| Data Privacy | 4 | Multiple blocking items: hard-delete cascade, Sentry PII leak, PostHog consent, optional token encryption. Foundations are there but nothing is wired end-to-end for compliance |

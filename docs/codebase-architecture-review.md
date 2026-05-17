# Codebase Architecture Review

Generated: 2026-05-17

## Executive Summary

This repository is a mature FastAPI + MongoDB + Redis worker + React/Vite platform for internal scheduling, partner coordination, portal workflows, reporting, and notifications. Recent security and portal work closed several high-risk findings: portal routers are split, portal child resources are project/task scoped, soft-deleted shared resources are excluded from downloads/exports, new reset and portal tokens are stored as digests, portal task attachment preview/download is implemented, uploads are size-capped/streamed, telemetry is scrubbed/consent-gated, and deployment health checks now include API and worker signals.

The strongest remaining opportunities are incremental hardening rather than a rewrite: complete the data-access boundary migration, reduce oversized modules, make TypeScript/mypy debt actionable, tighten remaining auth/session lifecycle risks, and add performance guardrails around heavy lists and fan-out endpoints.

## Current Architecture

- **Application type**: Internal business platform for class scheduling, partner project coordination, portal messaging/tasks/documents, reporting, and notifications.
- **Backend stack**: FastAPI app assembly in `backend/app_factory.py` and `backend/server.py`; Motor/Mongo data layer in `backend/database.py`; router-oriented API layer under `backend/routers/`; service modules under `backend/services/`; Pydantic models under `backend/models/`; Redis/ARQ background work under `backend/worker.py` and `backend/jobs/*`.
- **Startup lifecycle**: `backend/startup/*` owns migrations, index checks, bootstrap/seeding, and startup validation. `backend/server.py` stays closer to the app composition/serve boundary.
- **Portal backend**: Portal functionality is split under `backend/routers/portal/` with a shared bearer-token context in `backend/core/portal_auth.py` and token digest helpers in `backend/core/token_digest.py`.
- **Frontend stack**: React 19 + TypeScript + Vite 7. Entry point is `frontend/src/index.tsx`; shared internal auth/API behavior is in `frontend/src/lib/api.ts`; partner portal API helpers are in `frontend/src/lib/coordination-api.ts`; portal pages/components live under `frontend/src/pages/portal/` and `frontend/src/components/portal/`.
- **Package/runtime**: Python dependencies are pinned in `backend/requirements*.txt`; frontend dependencies and scripts are in `frontend/package.json`; root `package.json` remains tooling-only.
- **Domain concepts**: schedules, employees, classes, locations, partner organizations, projects, tasks, task attachments, shared documents, messages/comments, notifications, reset tokens, portal tokens, exports, and audit/telemetry events.

## Main Data And Control Flow

1. Internal frontend requests use `frontend/src/lib/api.ts`, which handles CSRF, refresh-token retry, and login redirects.
2. Portal frontend requests use the bearer-token portal flow and must not be redirected through the internal login/refresh path.
3. FastAPI routers apply role/portal context checks, query/update MongoDB, and call services for side effects.
4. Slow or scheduled side effects run through ARQ worker jobs, including heartbeat updates used by health checks.
5. Startup code applies migrations, validates indexes/configuration, and runs bootstrap tasks through `backend/startup/*`.

## Highest-Priority Open Findings

### 1. Incomplete Data-Access Boundary

- **Priority**: P0
- **Category**: Maintainability / data integrity
- **Files involved**: `backend/core/repository.py`, many `backend/routers/*.py`, `docs/tech-debt-followups.md`
- **Problem**: `SoftDeleteRepository` exists, but many routers still handcraft `{"deleted_at": None}` and duplicate CRUD/list/pagination patterns.
- **Why it matters**: Every ad hoc query is another place where soft-deleted data, inconsistent pagination, or inconsistent restore/delete behavior can regress.
- **Recommendation**: Continue migrating routers in small batches with contract tests before and after each batch. Add a lightweight guard for new raw soft-delete filters once a domain has moved to the repository layer.

### 2. Type Safety Gates Are Still Advisory

- **Priority**: P1
- **Category**: Refactor safety
- **Files involved**: `frontend/package.json`, `.github/workflows/ci.yml`, `frontend/src/lib/api.ts`, `frontend/src/hooks/useScheduleForm.ts`
- **Problem**: `npm run typecheck` and backend mypy checks are tracked but not yet fully blocking because existing debt remains.
- **Why it matters**: API shape drift, broad error types, and schedule payload ambiguity can still escape compile-time checks.
- **Recommendation**: Keep typecheck in CI as a visible baseline, then burn debt down by feature folder. Start with schedule payload types and shared API error normalization.

### 3. Oversized Modules And Mixed Responsibilities

- **Priority**: P1
- **Category**: Maintainability / testability
- **Files involved**: `backend/routers/auth.py`, `backend/routers/projects.py`, `backend/worker.py`, `backend/services/notification_events.py`, `frontend/src/components/coordination/TaskDetailModal.tsx`, `frontend/src/components/UserManager.tsx`, `frontend/src/components/LocationManager.tsx`, `frontend/src/pages/portal/PortalDashboard.tsx`
- **Problem**: Several large modules still mix transport, policy, data shaping, side effects, and presentation logic.
- **Why it matters**: Reviews are harder, targeted tests are harder to write, and unrelated changes collide more often.
- **Recommendation**: Extract feature-local query builders, DTO mappers, policy helpers, job adapters, hooks, and presentational subcomponents. Preserve public API/response shapes while moving one responsibility at a time.

### 4. Performance Guardrails Are Incomplete

- **Priority**: P1
- **Category**: Scalability
- **Files involved**: `backend/routers/projects.py`, schedule routers/services, `frontend/src/components/ActivityFeed.tsx`, `frontend/src/components/WeeklyReport.tsx`, manager views
- **Problem**: Some project/schedule endpoints still perform broad reads, fan-out, or post-processing. Some frontend lists still render all rows.
- **Why it matters**: Tail latency and browser responsiveness will degrade as project/task/schedule volume grows.
- **Recommendation**: Add explicit page/size caps where missing, prefer Mongo aggregation where it reduces request-path loops, add endpoint timing metrics, and introduce a shared virtualized list/table wrapper for heavy frontend surfaces.

### 5. Remaining Auth And Portal Lifecycle Hardening

- **Priority**: P1
- **Category**: Security / operations
- **Files involved**: `backend/core/portal_auth.py`, `backend/core/token_digest.py`, `backend/routers/portal/*`, `backend/routers/auth.py`, `backend/core/auth.py`, frontend portal route/session code
- **Current state**: New reset and portal tokens are digest-backed, validation falls back to legacy raw rows during transition, and admin/listing responses exclude raw token material.
- **Remaining risk**: Portal tokens are still transported through the existing frontend URL/sessionStorage flow by design for the current round. Password-change/session invalidation still has multi-worker cache-coherence follow-up risk.
- **Recommendation**: Plan a separate portal transport redesign around HttpOnly cookies or another server-managed session mechanism. For internal auth, consider Redis-backed invalidation or token-version claims before relying on horizontal scale.

## Recently Improved Or No Longer Current Findings

- **Portal router split**: The former monolithic portal router has been split under `backend/routers/portal/`.
- **Portal child-resource authorization**: Task attachments/comments now require partner-visible parent tasks and project-scoped child lookups.
- **Soft-delete leaks**: Shared document downloads and outcomes exports now exclude soft-deleted rows.
- **Token storage**: New password reset and portal invite tokens store HMAC-SHA256 digests, with legacy plaintext fallback only for short-lived existing rows.
- **Portal attachment download/preview**: The backend route now matches frontend preview/download calls and scopes attachments by `id`, `task_id`, and `project_id`.
- **Portal UX failure states**: Portal dashboard/detail surfaces now expose loading, error, retry, empty, pending-action, and icon-button accessibility states.
- **Upload handling**: Shared upload helpers enforce size limits and stream files instead of relying on unbounded in-memory reads.
- **Telemetry privacy**: Backend Sentry has a scrubber path, frontend Sentry strips sensitive request data, and PostHog initialization is consent-gated.
- **Deployment health**: Docker images include health checks, production compose includes an API health check and worker heartbeat health check, and dev reload behavior is environment-gated.
- **CI/security visibility**: GitHub Actions include backend tests, frontend tests/build/lint/testid checks, secret scanning, pip-audit, npm audit, and advisory typecheck/mypy jobs.

## Deduplication Opportunities

1. **Soft-delete and pagination boilerplate**
   - Consolidate remaining router CRUD/list paths through `SoftDeleteRepository` and shared pagination helpers.

2. **Calendar side-effect orchestration**
   - Introduce a provider adapter and job orchestration helper for repeated Google/Outlook create/delete/sync patterns.

3. **API error normalization**
   - Centralize axios/FastAPI error parsing into one frontend helper used by scheduling, coordination, and portal surfaces.

4. **Large list rendering**
   - Add a shared virtualized list/table shell for activity feeds, reports, manager tables, and other large collections.

5. **Page and form shell patterns**
   - Extract repeated title/action/error/loading layout primitives where components currently hand-roll the same structure.

## Refactoring Roadmap

1. **Repository migration batch**
   - Move low-risk partner/project/document routers first, with soft-delete visibility tests.

2. **API contract and typecheck cleanup**
   - Normalize API errors, tighten schedule payload types, and convert typecheck from advisory to blocking once the baseline is green.

3. **Portal lifecycle hardening**
   - Keep the current bearer-token route behavior until a dedicated session redesign is scheduled. Then move token transport out of URL/sessionStorage and add admin-friendly revocation/lifecycle controls.

4. **Worker modularization**
   - Continue moving job families into `backend/jobs/*` and service-layer orchestration functions while preserving ARQ entrypoint signatures.

5. **Project/schedule performance pass**
   - Add endpoint-level timing, review fan-out paths, add caps, and push work into aggregation/caching where behavior is stable.

6. **Frontend component decomposition**
   - Extract hooks/subcomponents from oversized manager, coordination, and portal components after contract tests lock in user-visible behavior.

## Testing Recommendations

- Add contract tests for each router moved to `SoftDeleteRepository`.
- Keep security regression tests around portal task/document/attachment/message access, token digest lookup, legacy-token fallback, and soft-deleted resource exclusions.
- Add worker job unit tests with fake calendar/email/webhook providers.
- Add frontend tests for normalized API errors, portal retry/pending states, and schedule payload handling.
- Add performance fixtures for project board/list endpoints and large frontend collections.
- Keep `npm run typecheck` and backend mypy visible in CI until they can become mandatory gates.

## Maintainer Notes

- Treat `README.md`, `frontend/README.md`, `docs/tech-debt-followups.md`, `docs/portal_permission_matrix.md`, and this file as the canonical living docs.
- Treat `docs/archive/*` and historical audit reports as snapshots unless a canonical doc explicitly links to them as historical context.
- When updating security docs, separate "fixed in current code" from "still open"; several former critical portal findings are now regression-test expectations rather than live findings.

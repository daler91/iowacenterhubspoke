# Codebase Architecture Review

## Executive Summary

This repository is a mature full-stack scheduling + partner-coordination platform (FastAPI + MongoDB + Redis worker + React/Vite frontend) with substantial recent debt paydown already documented in `docs/tech-debt-followups.md`.

The strongest opportunities now are **incremental architecture hardening** rather than rewrites:
1. finish the in-progress repository/data-access boundary migration,
2. split oversized endpoint and UI modules,
3. secure critical vulnerabilities including URL-leaked portal tokens, PII exposures, memory-bound file uploads, and race conditions,
4. standardize repeated notification/calendar orchestration patterns,
5. reduce request-path query fan-out and unbounded list rendering,
6. raise refactor safety via targeted contract/integration tests.

The codebase appears salvageable and actively improved, though recent security audits highlight immediate remediation needs. Recommendations below are intentionally PR-sized and dependency-aware.

## Current Architecture

- **Application type**: Internal business platform for class scheduling, partner project coordination, portal messaging/tasks/docs, reporting, and notifications.
- **Backend stack**: FastAPI app assembly in `backend/server.py`; Motor/Mongo data layer via `backend/database.py`; ARQ background worker in `backend/worker.py`; router-oriented API layer under `backend/routers/`; service modules under `backend/services/`; Pydantic models in `backend/models/`.
- **Frontend stack**: React 19 + TypeScript + Vite; entry in `frontend/src/index.tsx`; shared API client and request/401 logic in `frontend/src/lib/api.ts`; large feature components in `frontend/src/components/*`.
- **Package/runtime**:
  - Python deps pinned in `backend/requirements.txt`.
  - Frontend deps/scripts in `frontend/package.json`.
  - Root `package.json` is tooling-only.
- **Main entry points**:
  - API: `backend/server.py`
  - Worker: `backend/worker.py`
  - Frontend: `frontend/src/index.tsx`
- **Domain concepts**: schedules, employees, classes, locations, partner orgs, projects, tasks, documents, messages, notifications, portal auth tokens.
- **Pattern summary**:
  - Mostly “router + direct DB access + service helpers”.
  - A newer repository abstraction (`backend/core/repository.py`) is present but only partially adopted.
  - Background side-effects (email/calendar/webhooks/reminders/digest) are mixed between request handlers and worker jobs.

### Main data/control flow

1. Frontend requests API via axios client (`frontend/src/lib/api.ts`) with CSRF + refresh-token retry behavior.
2. FastAPI routers execute auth checks, query/update Mongo, and call services (`backend/routers/*.py`).
3. Async/slow side effects are queued to ARQ and executed by `backend/worker.py`.
4. Startup lifecycle (`backend/server.py`) runs index/migration/bootstrap routines.

## Highest-Priority Findings

### 1) Incomplete data-access boundary (soft-delete + query duplication)
- **Priority**: P0
- **Category**: Deduplication / Modularity / Maintainability
- **Files involved**: `backend/core/repository.py`, many `backend/routers/*.py` (notably `projects.py`, `partner_orgs.py`, `project_docs.py`, `schedule_bulk.py`, etc.), `docs/tech-debt-followups.md`.
- **Problem**: `SoftDeleteRepository` exists but most routers still handcraft `{"deleted_at": None}` and repetitive CRUD/pagination logic.
- **Evidence**: `docs/tech-debt-followups.md` explicitly tracks “remaining 22 routers”; code search shows pervasive repeated soft-delete filters.
- **Why it matters**: High regression surface (easy to forget filters), inconsistent behavior, harder global changes to soft-delete semantics.
- **Recommendation**: Continue incremental router-by-router migration to `SoftDeleteRepository` + shared pagination helpers; enforce via lightweight lint/check in CI.
- **Impact**: High
- **Effort**: Medium
- **Risk**: Medium (behavioral drift if not contract-tested per router)

### 2) Oversized modules with mixed responsibilities
- **Priority**: P1
- **Category**: Refactoring / Testability
- **Files involved**: `backend/server.py`, `backend/worker.py`, `backend/routers/auth.py`, `backend/routers/projects.py`, `backend/services/notification_events.py`, `frontend/src/components/coordination/TaskDetailModal.tsx`, `frontend/src/components/UserManager.tsx`, `frontend/src/components/LocationManager.tsx`.
- **Problem**: Very large files mix orchestration, policy, transport concerns, data shaping, and side effects.
- **Evidence**: Line-count analysis shows many 500–1100+ LOC files; README and existing debt doc already call out oversized components.
- **Why it matters**: Harder code review, brittle edits, difficult unit isolation, increased merge conflicts.
- **Recommendation**: Extract feature-local modules (query builders, DTO mappers, permission/policy helpers, background side-effect adapters, subcomponents).
- **Impact**: High
- **Effort**: Medium-large
- **Risk**: Medium

### 3) Request-path fan-out and aggregation pressure in project/schedule surfaces
- **Priority**: P1
- **Category**: Scalability
- **Files involved**: `backend/routers/projects.py`, `backend/routers/schedule_*.py`, `backend/services/workload_cache.py`, `backend/server.py` (indexing).
- **Problem**: Some endpoints still perform multi-query fan-out and additional enrichment loops under broad filters.
- **Evidence**: `projects.py` board endpoint parallelizes phase queries + facet + task aggregation; schedule-related modules include repeated broad reads and post-processing.
- **Why it matters**: Latency tail and CPU/DB pressure rise with dataset growth (projects/tasks/schedules).
- **Recommendation**: Add explicit pagination caps consistently, push more aggregation into Mongo pipelines where safe, and add endpoint-level timing metrics.
- **Impact**: Medium-high
- **Effort**: Medium
- **Risk**: Medium

### 4) Frontend type safety and API contracts remain partially hardened
- **Priority**: P1
- **Category**: Maintainability / Refactor Safety
- **Files involved**: `frontend/src/lib/api.ts`, `frontend/src/hooks/useScheduleForm.ts`, high-LOC components in `frontend/src/components/*`, `docs/tech-debt-followups.md`.
- **Problem**: Strict TypeScript is not yet CI-gated and some API payload/error typing remains broad.
- **Evidence**: Follow-up doc explicitly notes `tsc --noEmit` debt and schedule payload typing gap.
- **Why it matters**: Refactors can silently break runtime shape assumptions; broad `unknown/Record` payloads reduce editor/compiler guardrails.
- **Recommendation**: Stage strictness by feature folders; tighten schedule API payload union and shared error-response helpers.
- **Impact**: Medium
- **Effort**: Medium
- **Risk**: Low-medium

### 5) Critical Security, Privacy, and Data Integrity Exposures
- **Priority**: P0
- **Category**: Security / Privacy / Architecture
- **Files involved**: `backend/routers/partner_portal.py`, `backend/server.py`, `frontend/src/index.tsx`, `backend/services/webhooks.py`, `backend/routers/schedule_crud.py`.
- **Problem**: Portal magic link API returns the token in the response and relies on query params; Sentry/PostHog capture PII/credentials without scrubbers/consent; file uploads are buffered entirely in memory; Webhooks lack SSRF protection; and `relocate_schedule` contains an atomic race condition.
- **Evidence**: Agent and Audit reports confirm token returned directly on `partner_portal.py`; Sentry `init` lacks `before_send` (`server.py:11-18`); `file.read()` used without chunking; `relocate_schedule` fetches and updates without locking.
- **Why it matters**: Severe compliance (PII leakage), data integrity (double booking), and availability (memory exhaustion DOS) risks. Tokens leaked in URLs undermine authentication.
- **Recommendation**: Remove token from portal API response, require Bearer tokens, add `before_send` to Sentry, stream file uploads, validate webhook URLs against private IPs, and use `find_one_and_update` for schedule changes.
- **Impact**: High
- **Effort**: Medium
- **Risk**: Medium

## Deduplication Opportunities

1. **Soft-delete query duplication**
   - **Files**: Broad `backend/routers/*.py` set (e.g., `projects.py`, `partner_orgs.py`, `project_docs.py`, `employees.py`, `schedule_bulk.py`).
   - **Symbols**: repeated inline Mongo filters and list/detail/update/delete patterns.
   - **Duplicate**: `{"deleted_at": None}` + pagination/total boilerplate.
   - **Why it matters**: consistency + defect prevention.
   - **Consolidation**: migrate remaining routers to `SoftDeleteRepository` and shared pagination envelope.
   - **Impact/Effort/Risk**: High / Medium / Medium.

2. **Calendar side-effect orchestration patterns**
   - **Files**: `backend/worker.py`, schedule routers/services.
   - **Symbols**: repeated Google/Outlook create/delete + employee loop + mapping persistence patterns.
   - **Duplicate**: Similar idempotency, event payload construction, logging and error paths.
   - **Consolidation**: introduce calendar-provider adapter interface + shared job orchestration helper.
   - **Impact/Effort/Risk**: Medium / Medium / Medium.

3. **Frontend error parsing and 401 handling assumptions**
   - **Files**: `frontend/src/lib/api.ts`, `frontend/src/hooks/useScheduleForm.ts`, `frontend/src/components/CalendarView.tsx`.
   - **Duplicate**: ad-hoc axios error narrowing for `response.status/detail/conflicts`.
   - **Consolidation**: one typed `normalizeApiError()` utility and typed conflict/detail guards.
   - **Impact/Effort/Risk**: Medium / Small / Low.

4. **Large list/table rendering patterns without shared virtualization wrapper**
   - **Files**: `frontend/src/components/ActivityFeed.tsx`, `frontend/src/components/WeeklyReport.tsx`, `frontend/src/components/UserManager.tsx`.
   - **Duplicate**: repeated full-map rendering and row UI patterns.
   - **Consolidation**: shared virtualized list/table shell with item renderer.
   - **Impact/Effort/Risk**: Medium / Medium / Low.

5. **Frontend UI Shells and Layouts**
   - **Files**: `frontend/src/components/*` (15+ pages).
   - **Symbols**: Hand-rolled page titles, subtitles, breadcrumbs, and actions.
   - **Duplicate**: Lack of a shared `PageShell` / `PageHeader` primitive.
   - **Consolidation**: Extract a central `PageShell` to enforce design system coherence and standard loading/error bounds.
   - **Impact/Effort/Risk**: High / Medium / Low.

## Refactoring Opportunities

1. **`backend/server.py` bootstrap decomposition**
   - **Problem**: app assembly + index management + migration + seeding + static serving in one module.
   - **Refactor**: split into `startup/indexes.py`, `startup/migrations.py`, `startup/seeds.py`, `app_factory.py`.
   - **Tradeoff**: More files; clearer ownership.
   - **Priority**: P1.

2. **`backend/worker.py` responsibilities split**
   - **Problem**: business logic helpers, provider orchestration, cache invalidation, ARQ config all co-located.
   - **Refactor**: isolate job functions into `jobs/` modules and keep `WorkerSettings` as composition root.
   - **Tradeoff**: import-path churn.
   - **Priority**: P1.

3. **`backend/routers/projects.py` endpoint decomposition**
   - **Problem**: mixed query composition, domain policy, shape normalization.
   - **Refactor**: extract project query service + DTO mappers; keep router thin.
   - **Tradeoff**: careful behavior parity testing required.
   - **Priority**: P1.

4. **Frontend oversized component decomposition**
   - **Files**: `TaskDetailModal.tsx`, `UserManager.tsx`, `LocationManager.tsx`, `ProjectDetail.tsx`, `PortalDashboard.tsx`.
   - **Problem**: presentation, form logic, side-effects, permissions mixed.
   - **Refactor**: extract hooks + presentational subcomponents + API adapters.
   - **Tradeoff**: temporary prop drilling unless context boundaries are designed.
   - **Priority**: P1/P2.

5. **Auth router policy extraction**
   - **File**: `backend/routers/auth.py`.
   - **Problem**: dense auth flows + policy checks + token/session behavior.
   - **Refactor**: extract password/reset/session policy helpers and response shaping.
   - **Tradeoff**: security-sensitive; require high test coverage before/after.
   - **Priority**: P0 for safety scaffolding, P1 for decomposition.

6. **Portal Router Decomposition**
   - **File**: `backend/routers/partner_portal.py`.
   - **Problem**: 500+ LOC handling auth, tasks, docs, messages, and dashboard in one module.
   - **Refactor**: Split into `routers/portal/auth.py`, `tasks.py`, etc., leveraging a central `PortalContext` bearer-token dependency.
   - **Tradeoff**: Increases file count but resolves mixed responsibilities and URL token leakages.
   - **Priority**: P1.

## Scalability Concerns

1. **Project board fan-out and per-request aggregation**
   - **Evidence**: `backend/routers/projects.py` board path uses parallel phase queries + task stat aggregation.
   - **Failure mode**: slower responses and DB load growth as active projects/tasks increase.
   - **Recommendation**: add endpoint metrics, per-filter cache where acceptable, and pagination/load-more for heavy columns (already partially present via phase limits).
   - **Status**: Confirmed architectural pressure point (mitigated, not eliminated).
   - **Priority/Effort**: P1 / Medium.

2. **Startup index creation in app process**
   - **Evidence**: extensive `_ensure_indexes()` in `backend/server.py`.
   - **Failure mode**: slower cold starts; possible startup contention in scaled replicas.
   - **Recommendation**: migrate long index lifecycle to explicit migration/ops job and keep only critical safety checks at startup.
   - **Status**: Confirmed pattern; risk increases with scale.
   - **Priority/Effort**: P2 / Medium.

3. **Frontend non-virtualized large collections**
   - **Evidence**: debt tracker explicitly names unvirtualized heavy lists.
   - **Failure mode**: UI jank and poor responsiveness at moderate row counts.
   - **Recommendation**: shared virtualization wrapper + progressive loading.
   - **Status**: Confirmed.
   - **Priority/Effort**: P1 / Medium.

4. **Password-change cache coherence across multi-worker deployments**
   - **Evidence**: documented in `docs/tech-debt-followups.md`.
   - **Failure mode**: stale auth state up to cache TTL on other workers.
   - **Recommendation**: Redis-backed invalidation or token versioning claim.
   - **Status**: Confirmed risk under horizontal scale.
   - **Priority/Effort**: P1 / Small-medium.

5. **Unbounded File Uploads and Bulk Operations**
   - **Evidence**: File uploads read fully into memory (`await file.read()`). `schedules.py` bulk endpoints accept unbounded `ids[]`.
   - **Failure mode**: Memory exhaustion DOS under load; DB performance degradation.
   - **Recommendation**: Stream uploads in chunks and enforce `MAX_UPLOAD_BYTES`. Cap Pydantic array lengths for bulk ops.
   - **Status**: Confirmed risk.
   - **Priority/Effort**: P1 / Medium.

## Modularity and Boundary Issues

1. **Router layer directly coupled to Mongo DSL**
   - **Current**: many routers construct raw filters/updates inline.
   - **Problem**: business logic and persistence concerns interleaved.
   - **Target**: repository/query-service modules per bounded context.
   - **Migration path**: complete soft-delete repo adoption first, then extract complex aggregation/query services (`projects`, `schedule`).

2. **Worker jobs contain domain orchestration + infra plumbing**
   - **Current**: `backend/worker.py` mixes scheduler helpers, provider calls, logging, cache invalidation, job registration.
   - **Problem**: hard to unit-test domain behavior separately from ARQ context.
   - **Target**: `services/*` pure orchestration functions injected into thin ARQ wrappers.
   - **Migration path**: move one job family at a time (calendar jobs, then schedule bulk, then reminder/digest).

3. **Frontend feature boundaries inconsistent**
   - **Current**: some shared logic in `lib/` and hooks, but many feature components still embed API/data shaping.
   - **Problem**: low reuse, hard test seams.
   - **Target**: feature folders with `api.ts`, `hooks.ts`, `components/`, `types.ts` per domain.
   - **Migration path**: start with `coordination` and `manager` components flagged by LOC/debt tracker.

## Testing Recommendations

- **Observed**: Backend test suite is broad (236 collected) but collection emits many `PytestUnknownMarkWarning` for `@pytest.mark.asyncio`.
- **Add/Improve**:
  1. Contract tests for each router migrated to `SoftDeleteRepository` before/after migration.
  2. Security-critical auth/session tests around refresh/replay/password-change cache behavior.
  3. Worker job unit tests with fake providers for calendar/email/webhook idempotency behavior.
  4. Frontend hook-level tests for `useScheduleForm` payload typing and error normalization.
  5. Performance regression checks for board/list endpoints (dataset fixtures + response-time budget assertions).
  6. Security assertion tests for oversized file uploads and SSRF payload blocks on webhooks.
  7. TypeScript strictness validation (`tsc --noEmit`) as a mandatory CI step.
- **Refactors to defer until tests exist**:
  - `auth.py` decomposition,
  - `projects.py` query/service extraction,
  - calendar job orchestration unification.

## Suggested Migration Roadmap

### Quick wins (1–3 PRs)
- Standardize frontend API error normalization utility.
- Close critical security gaps: remove portal token from API response, add Sentry PII scrubber, fix `relocate_schedule` atomic race, add file upload limits.
- Register/clean async pytest markers to remove warning noise.
- Add architecture guard checks (e.g., no new raw soft-delete filters in migrated routers).

### Medium-sized refactors (3–6 PRs)
- Migrate remaining routers to repository abstraction in batches by domain.
- Split `worker.py` into job modules.
- Decompose `UserManager` and `LocationManager`; add virtualization wrapper and adopt in named heavy lists.

### Larger architectural improvements (later wave)
- Extract query services for project board/report endpoints.
- Rework startup index management into migration/ops lifecycle.
- Finish TS strictness rollout and gate `tsc --noEmit` in CI.

## PR-by-PR Refactoring Plan

1. **PR: “Security & Privacy Hardening: Portal Auth, Uploads, PII, Data Integrity”**
   - **Goal**: Close high-severity security vectors.
   - **Files likely affected**: `partner_portal.py`, `server.py`, `project_docs.py`, `webhooks.py`, `index.tsx`, `schedule_crud.py`.
   - **Steps**: Remove portal token from API response and switch to Bearer Auth; add Sentry `before_send`; chunk file uploads with size caps; add SSRF validation to webhooks; change `relocate_schedule` to `find_one_and_update`.
   - **Tests**: Negative tests for oversized uploads, SSRF payloads, API auth responses, and schedule race conditions.
   - **Validation**: Execute security test suite and `pytest`.
   - **Risk**: High (touches auth, ingress, and data mutations).
   - **Rollback**: Revert specific payload limits or auth transport.
   - **Dependencies**: None.

2. **PR: “Repository migration batch 1: partner/project docs routers”**
   - **Goal**: remove duplicated soft-delete/list boilerplate from low/medium complexity routers.
   - **Files likely affected**: `backend/routers/partner_orgs.py`, `backend/routers/project_docs.py`, `backend/core/repository.py` (if tiny extensions needed), related tests.
   - **Steps**: baseline tests -> migrate read/list/update/delete paths -> parity assertions.
   - **Tests**: add integration tests for soft-delete visibility and restore semantics.
   - **Validation**: `cd backend && pytest -q tests/test_repository.py tests/test_partner_* tests/test_project_*`.
   - **Risk**: Medium.
   - **Rollback**: revert router-specific commits only.
   - **Dependencies**: none.

3. **PR: “Repository migration batch 2: schedule auxiliary routers”**
   - **Goal**: apply same patterns to schedule-adjacent routers where safe.
   - **Files**: `backend/routers/schedule_bulk.py`, `schedule_crud.py`, etc.
   - **Steps**: migrate simple CRUD/list paths first; defer complex aggregation branches.
   - **Tests**: schedule conflict/list/delete regression tests.
   - **Validation**: `cd backend && pytest -q tests/test_schedule_* tests/test_workload_*`.
   - **Risk**: Medium-high.
   - **Rollback**: router-by-router revert.
   - **Dependencies**: PR 1 patterns.

4. **PR: “Worker modularization: calendar jobs extraction”**
   - **Goal**: isolate provider orchestration from ARQ configuration.
   - **Files**: `backend/worker.py`, new `backend/services/calendar_jobs.py` (or `backend/jobs/`).
   - **Steps**: move logic behind preserved function signatures; keep WorkerSettings stable.
   - **Tests**: add idempotency and error-path unit tests with mocks.
   - **Validation**: `cd backend && pytest -q tests/test_calendar_sync_unit.py tests/test_notification_dispatch.py`.
   - **Risk**: Medium.
   - **Rollback**: restore previous `worker.py` job functions.
   - **Dependencies**: none.

5. **PR: “Frontend: API error normalization + schedule payload typing groundwork”**
   - **Goal**: reduce repeated axios error parsing and improve API contracts.
   - **Files**: `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`, `frontend/src/hooks/useScheduleForm.ts`, affected components/tests.
   - **Steps**: introduce normalized error helper, migrate two high-use call sites, tighten schedule payload return type incrementally.
   - **Tests**: update/add unit tests under `frontend/src/lib/*.test.ts` and hook tests.
   - **Validation**: `cd frontend && npm test` and `npm run lint`.
   - **Risk**: Low-medium.
   - **Rollback**: revert helper adoption at call sites.
   - **Dependencies**: none.

6. **PR: “Frontend: component decomposition + list virtualization phase 1”**
   - **Goal**: split manager components and improve large-list performance.
   - **Files**: `frontend/src/components/UserManager.tsx`, `LocationManager.tsx`, `ActivityFeed.tsx`, `WeeklyReport.tsx`, new shared virtualization component.
   - **Steps**: extract dialogs/forms, add virtualized list wrapper, apply to one component first then expand.
   - **Tests**: interaction tests for extracted subcomponents; basic render/perf smoke checks.
   - **Validation**: `cd frontend && npm test && npm run lint`.
   - **Risk**: Medium.
   - **Rollback**: keep wrapper optional behind feature flag/prop.
   - **Dependencies**: PR 4 helpful but not mandatory.

7. **PR: “Deployment-scale auth/session hardening”**
   - **Goal**: remove per-process password-change cache coherence risk.
   - **Files**: `backend/core/auth.py`, auth router/service integration points, tests.
   - **Steps**: implement Redis invalidation or token version approach; backfill tests.
   - **Tests**: multi-session/multi-worker simulation tests.
   - **Validation**: `cd backend && pytest -q tests/test_auth_* tests/test_brute_force_unit.py`.
   - **Risk**: Medium-high (security-sensitive).
   - **Rollback**: fallback to old cache path guarded by config toggle.
   - **Dependencies**: none.

## Commands Run

- Inspected architectural insights and deep analysis from `AGENT_REVIEW_REPORT.md`, `CODEBASE_RUTHLESS_AUDIT_2026-04-08.md`, `UX_ARCHITECTURE_REVIEW.md`, and `UX_ACCESSIBILITY_REVIEW.md`.
- Reviewed `tech-debt-followups.md` and `migrations.md` for context on previous architectural migrations.
- Analyzed `server.py` and `docker-compose.prod.yml` to understand initialization flows, dependencies, and environment constraints.

- `pwd; rg --files -g 'AGENTS.md'` — **failed** (no AGENTS matched; `rg` exit code 1).
- `find .. -name AGENTS.md -print` — **passed**.
- `rg --files | head -n 200` — **passed**.
- `cat package.json` — **passed**.
- `cat frontend/package.json` — **passed**.
- `cat backend/requirements.txt` — **passed**.
- `cat README.md` — **passed**.
- `cat backend/server.py` — **passed**.
- `cat backend/worker.py` — **passed**.
- `find backend frontend/src frontend/tests -type f \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 wc -l | sort -nr | head -n 30` — **passed**.
- `rg '"deleted_at"\s*:\s*None' backend | head -n 80` — **passed**.
- `cd backend && pytest --collect-only -q` — **passed** (with warnings).
- `sed -n '1,220p' frontend/src/index.tsx` — **passed**.
- `sed -n '1,220p' backend/routers/__init__.py` — **passed**.
- `sed -n '1,220p' backend/core/repository.py` — **passed**.
- `rg "apiClient|axios|fetch\(" frontend/src -g '*.{ts,tsx}' | head -n 120` — **passed**.
- `sed -n '1,260p' docs/tech-debt-followups.md` — **passed**.
- `sed -n '1,220p' backend/routers/projects.py` — **passed**.
- `sed -n '1,220p' frontend/src/lib/api.ts` — **passed**.

## Limitations

- This review did not execute full backend/frontend test/lint/build suites (only backend test collection) to avoid long-running/mutating setup and because the task scope is architecture analysis.
- Because command execution is restricted in this cloud agent environment, additional runtime analysis commands could not be run interactively. Findings heavily rely on existing detailed audit reports.
- Some command outputs were truncated by terminal token limits when printing very large files; additional targeted file reads were used to validate key conclusions.
- No runtime profiling or production telemetry was available in this environment, so scalability findings are based on code-structure evidence and documented debt notes rather than live performance traces.

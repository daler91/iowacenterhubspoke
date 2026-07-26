# Tech-debt follow-ups

The April 2026 tech-debt remediation effort closed the highest-impact
architecture and tooling issues but deliberately left several PR-sized
follow-ups. A July 2026 codebase review closed another round. This document
tracks the current maintainer-facing baseline.

Every item in **Open** was re-verified against the code on 2026-07-26, with
counts measured rather than recalled. If you find a claim here that the code
contradicts, treat the doc as wrong and fix it in the same PR — several of the
bugs the July review found were possible because documentation asserted a state
the code did not have.

## Open

> Verified against the code on 2026-07-26. Every claim below was checked; items
> that turned out to be already finished were moved to "Recently improved"
> rather than left sitting here. A tracker that reports closed work as open
> sends the next contributor to re-investigate it.

### Migrate remaining routers onto `SoftDeleteRepository`

`backend/core/repository.py::SoftDeleteRepository` is used by six routers:
`locations.py`, `classes.py`, `employees.py`, `partner_orgs.py`,
`project_docs.py`, `schedule_bulk.py`. **207 hand-written `{"deleted_at": None}`
filters remain** across the rest. Highest-value remaining targets by count:
`projects.py` (30), `schedule_crud.py` (22), `reports.py` (16),
`project_tasks.py` (12).

See `docs/repository-pattern.md` for the recipe. Each router should be its own
PR, added to `MIGRATED` in `tests/test_migrated_router_soft_delete_guard.py` —
that guard is scoped per router to the collection it migrated, so a router that
also queries un-migrated collections can still be locked in.

Two things that bite on every migration:

- Tests using `patch.object(db, '<collection>')` stop working. The repository
  resolves `db["<collection>"]` and holds the handle it was constructed with,
  so attribute patching no longer intercepts it — patch the repo method instead
  (see `tests/test_employee_stats.py` for the pattern).
- `tests/test_endpoints_integration.py::test_soft_deleted_rows_disappear_from_list_endpoints`
  is the end-to-end safety net for this work. Extend it per migrated router.

### Reduce the frontend strict-mode baseline

`npm run typecheck` reports **851 errors across 67 files** — mostly implicit-any
props in older `.tsx` files and untyped Radix wrapper returns. It is down from
1,072/88, entirely as a side effect of deleting dead code.

CI runs the raw `typecheck` as advisory (for the full list in the log) and
`npm run check-types-ratchet` as **blocking**. The ratchet
(`frontend/scripts/typecheck-ratchet.js`) holds a per-file ceiling, so new
errors fail the build while the baseline is paid down.

To finish: sweep the remaining files — `BulkActionBar.tsx` (56),
`CalendarWeek.tsx` (44), `UserManager.tsx` (40), `KanbanBoard.tsx` (37) are the
largest — running `node scripts/typecheck-ratchet.js --update` after each to
lock in the gain. When the baseline reaches zero, delete the ratchet and drop
`continue-on-error` from the advisory step.

### Decompose the remaining oversized components

`PortalDashboard.tsx` is done — split into `portal/{shared,hooks,components,pages}`
behind a 152-line shell. Remaining targets:

- `frontend/src/components/coordination/TaskDetailModal.tsx` (1,004 lines, 18
  `useState`) — description editing, threaded comments, mentions, attachments,
  assignment and deletion in one component.
- `frontend/src/components/UserManager.tsx` (717) — extract invite/status/role
  subcomponents.
- `frontend/src/components/LocationManager.tsx` — extract form/dialog and
  drive-time helper UI.

### Memoise the portal list components

Deferred from the `PortalDashboard` split. `ProgressBar`, `MetricCard` and
`EmptyState` are `memo()`'d. `TaskCard` and `ProjectCard` are not: they receive
inline handlers from their pages, so `memo` would never hit until those are
wrapped in `useCallback`. That changes the pages' render path and wants its own
commit.

### Extend list virtualization

`ui/virtualized-wrapper.tsx` is applied in `ActivityFeed.tsx`, `WeeklyReport.tsx`
and `UserManager.tsx`. Remaining unvirtualized surfaces, in order of list size:
`portal/pages.tsx` (20 `.map()` sites), `coordination/ProjectBoard.tsx` (7),
`KanbanBoard.tsx` (6).

Note `WeeklyReport.tsx:217` passes `role="table"` to the wrapper, producing a
`div[role=table]` with no `role="row"`/`role="cell"` descendants — invalid ARIA,
announced as an empty table. Fix when touching that file.

### Tighten schedule form payload typing

`schedulesAPI.create` / `update` / `relocate` / `checkConflicts` /
`updateSeries` still accept broad schedule payload types because
`useScheduleForm.buildPayload` returns multiple recurrence shapes. Refactor the
payload builder to return a discriminated union aligned with backend
`ScheduleInput`, then tighten the API method signatures.

### Replace the in-process password-change cache for multi-worker deploys

`backend/core/auth.py` caches password-invalidation state per process (L1, 30s)
over Redis markers (L2, 15min) over Mongo. `docs/auth-session-invalidation.md`
describes the `pwdv` JWT claim design as implemented, and the code matches it —
so this is narrower than it once was. What remains is confirming behaviour
under genuine multi-worker load before scaling past one worker.

### Finish the portal token transport redesign

Portal magic links are **reusable bearer tokens for their 3-day lifetime**, not
one-time-use, carried in the URL path. `core/portal_auth.py` checks only
`revoked_at` and `expires_at`; `last_used_at` is a throttled analytics write.
There is no rate limit on token *use*, only on link request.

Real exposure is browser history, server access logs, and email link-scanners
that pre-fetch URLs — not third-party `Referer` leakage, which
`Referrer-Policy: strict-origin-when-cross-origin` already prevents. The
HttpOnly-cookie redesign remains deferred; when implemented, preserve the
current partner recovery UX and API authorization semantics.

### CI gaps

- **The production `Dockerfile` is never built in CI.** A Dockerfile-breaking
  change merges green and fails at deploy. Largest remaining hole.
- No `concurrency:` group (superseded PR pushes keep burning runners) and no
  `timeout-minutes:` on any job.
- Six actions are unpinned (`backend`, `frontend`, `frontend-e2e`).
  `backend-security` and `secret-scan` pin full SHAs with a written rationale
  that the other jobs do not follow.
- `pip-audit` scans `requirements.txt`, not the `requirements-dev.txt` CI
  installs. `pytest` is pinned in production `requirements.txt`.
- ESLint runs `jsx-a11y` only. `react-hooks/exhaustive-deps` is the notable
  absence on a codebase this dependent on hook dep arrays.
- `npm audit` is non-blocking, and cannot be flipped until `react-router-dom`
  moves past 8.2.0 (GHSA-qwww-vcr4-c8h2, RSC-mode CSRF; this SPA does not use
  RSC mode).

### Migrate `App.css` onto design tokens

`frontend/src/App.css` hard-codes **23 distinct hex values**, including literal
`#4F46E5` where `hsl(var(--hub))` exists, and hand-patches dark mode rather than
letting it fall out of the variables. It is the one place contradicting an
otherwise complete token migration — `.tsx` files carry zero raw Tailwind
palette classes. Five rule blocks in it are also dead.

## Recently improved

### Closed in the July 2026 review (verified against code)

- **Legacy `/api/*` mount removed.** Its `Sunset: Wed, 01 Jul 2026` had passed
  and the frontend had zero non-v1 calls. `legacy_router` and the deprecation
  middleware are gone from `backend/server.py`; `test_rbac.py` was exercising
  that legacy surface and now targets `/api/v1`.
- **Four silent-failure bugs fixed**, each with a guard: webhook delivery
  enqueued an unregistered arq job name (all 14 event types were dead);
  mixed-case email was a three-way account lockout; password reset ignored
  soft-delete; `features/coordination/api.ts` called a nonexistent method.
- **Real endpoint tests against MongoDB in CI.** `tests/test_endpoints_integration.py`
  runs against `mongo:7` + `redis:7-alpine` service containers. `REQUIRE_MONGO=1`
  turns "no database, skip" into a hard failure so the suite cannot go vacuous.
  This closes the gap `test_rbac.py` named in its own docstring.
- **Four abandoned refactors deleted** — `frontend/src/features/`, the flat
  `backend/jobs/*_jobs.py` layout, the duplicate `VirtualizedList`, and three
  copies of `time_to_minutes`. Plus ~2,300 lines of dead frontend code and 18
  orphaned dependencies.
- **Boot-time index creation fails closed.** One blanket `except` used to
  swallow a failure on the first index, silently skipping every uniqueness and
  TTL guard after it.
- **Real 404s.** Unknown client routes rendered a blank white page; unmatched
  `/api/v1/*` returned `index.html` with HTTP 200.
- **`.dockerignore` / `.gitignore` secret rules** — the Dockerfile copies
  `backend/` into the final image and prod compose tells operators to create
  `./secrets/`; neither was excluded.
- **Login timing oracle closed**, `webhook_outbox` drained by a worker cron,
  `schedule_slot_claims` given a TTL, and the `exports.py` N+1 (up to 1001
  queries) reduced to one.
- **Test isolation.** `conftest.py` imports the real `motor` and `httpx` before
  any test module, so the dozen `sys.modules.setdefault(..., MagicMock())` stubs
  can no longer leak into tests needing the genuine driver.


- Portal router split: the legacy monolithic portal router has been replaced by
  the `backend/routers/portal/` package.
- Critical portal leak fixes: partner-visible task checks now gate child
  comments/attachments, child-resource queries include `task_id` and
  `project_id`, and tasks outside the partner org/project are blocked.
- Soft-delete leaks: shared portal document downloads and outcome exports now
  exclude `deleted_at` rows.
- Token storage: new password-reset and portal-token rows store
  `token_digest`, with short-lived legacy raw-token lookup fallback until old
  tokens expire.
- Portal attachment route: partner task attachment preview/download now has a
  backend route matching the frontend API and serves sanitized basename paths.
- Portal UX: dashboard/project detail surfaces expose loading, error, retry,
  empty, and rapid-action pending states for tasks/documents/messages and task
  detail attachments.
- Upload hardening: project, task, and portal uploads use streaming helpers with
  `MAX_UPLOAD_BYTES` limits instead of unbounded reads.
- Observability/privacy: backend Sentry uses `core.sentry_scrub`, frontend
  Sentry strips sensitive headers, PostHog is consent-gated, and logout resets
  analytics identity.
- CI/security: GitHub Actions now includes dependency scanning, gitleaks,
  frontend audit, e2e checks, and non-blocking backend/frontend type checks.
- DevOps: Dockerfiles include health checks, `Dockerfile.dev` gates reload
  behind `UVICORN_RELOAD=1`, and the worker emits a Redis heartbeat used by
  health checks.

## Done in the April 2026 effort

- Phase 1 - CSV upload DoS guardrails, 401 redirect debounce,
  password-change cache invalidation, Redis lifespan, root-test cleanup,
  archived audits.
- Phase 2 - `core/pagination.py`, deprecated `travel_override_minutes`
  removal, migration runner, legacy `/api/` sunset headers.
- Phase 3a - `core/repository.py` (`SoftDeleteRepository`),
  `routers/locations.py` and `routers/classes.py` migrated, schedule CRUD
  helper extraction.
- Phase 3b - portal router split into the `backend/routers/portal/` package.
- Phase 4a - typed `frontend/src/lib/api.ts` / `frontend/src/lib/types.ts`,
  plus `frontend/src/vite-env.d.ts`.
- Phase 4b - shared calendar layout helpers and focused unit tests.
- Phase 5 - `.pre-commit-config.yaml`, `docs/migrations.md`,
  `docs/repository-pattern.md`, and this tracker.

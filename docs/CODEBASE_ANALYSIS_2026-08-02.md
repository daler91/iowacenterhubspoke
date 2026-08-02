# HubSpoke Full Codebase Analysis — 2026-08-02

Prepared by a multi-agent review: ten subsystem deep-readers, adversarial
verification of every claimed critical/high defect, and a completeness critic
that swept for gaps between subsystem boundaries. Findings that carry a
**VERIFIED** tag survived a dedicated refutation pass against the actual code.

This document is a point-in-time snapshot. Where a finding is already tracked
in `docs/tech-debt-followups.md`, that is noted rather than re-raised as new.

---

## 1. Executive summary

HubSpoke is in **unusually good health for its size** (~23.6k lines of backend
Python, ~29.8k lines of frontend TypeScript, 69 backend test files). The
request path is mature: dual-JWT auth with a documented invalidation scheme,
digest-only token storage, a soft-delete repository that makes forgetting the
`deleted_at` filter structurally impossible on migrated routers, SHA-pinned CI
with fail-closed integration tests against real Mongo/Redis, and a tech-debt
tracker that most findings merely confirm.

The risk is **bimodal**, concentrated in two areas that the request-path
quality masks:

1. **The asynchronous half of the system is materially less trustworthy than
   the request path.** Worker calendar jobs crash on a kwarg mismatch, the
   task-reminder cron aborts on naive datetimes, event webhooks never fire at
   all, and the worker process has no Sentry. This is a pattern of
   shipped-but-never-executed code that unit tests with stubbed providers
   cannot see.

2. **Deployment-assumption defects** — correct code meeting wrong
   infrastructure assumptions: rate-limit keying that collapses to a single
   global bucket behind Railway's proxy (defeating brute-force protection), a
   `.dockerignore` that bakes dev credentials into local production builds, and
   a production compose example that stores uploads on an ephemeral filesystem.

A third recurring theme is **single-path vs bulk-path divergence**: calendar
sync, notifications, and denormalized snapshots are maintained on the
single-document path but skipped on bulk/series/import paths.

### Confirmed high-severity findings (fix first)

| # | Finding | Where | Status |
|---|---------|-------|--------|
| H1 | Outlook calendar jobs crash on every invocation (`idempotency_key` kwarg the providers don't accept) | `backend/services/worker_jobs.py:92,113` | **VERIFIED**, reproduced |
| H2 | Event webhooks never fire — `fire_webhook_event` has zero production callers | `backend/services/webhooks.py:115` | **VERIFIED** (2 readers) |
| H3 | Rate limits & brute-force throttles key on the proxy IP on Railway → one global bucket | `backend/docker-entrypoint.py:70` + `core/rate_limit.py:19` | **VERIFIED**, wheel-level confirmed |
| H4 | `.dockerignore` rules are root-anchored → local prod builds bake `backend/.env` secrets into the image | `.dockerignore:14-17` | **VERIFIED**, reproduced with dockerd |
| H5 | Completed-project cards throw `ReferenceError` on click (`navigate` undefined) | `frontend/src/components/coordination/ProjectBoard.tsx:384` | **VERIFIED**, `tsc` confirms |

### Verified-but-downgraded

| Finding | Where | Verdict |
|---------|-------|---------|
| Task-reminder cron aborts the whole hourly run on any tz-naive `due_date` | `backend/services/task_reminders.py:39` | **VERIFIED → medium** (trigger unreachable from the bundled UI, which always sends `Z`-suffixed dates; reachable only via direct API with a contractually-valid plain date) |

### Remediation order

1. Fix the three async-path defects: H1 (kwarg), the reminder-cron naive-datetime abort, and wire `fire_webhook_event` in or remove the feature (H2). Add Sentry to the worker.
2. Pass `--proxy-headers`/set `FORWARDED_ALLOW_IPS` and re-key rate limits (H3).
3. Fix `.dockerignore` (`**/`-prefix every pattern) and add a persistent uploads volume to prod compose (H4 + infra).
4. Fix the ProjectBoard crash (H5).
5. Then address the frontend truncation-at-200 and the timezone contract before organic data growth makes them visible.

---

## 2. Confirmed high-severity findings (detail)

### H1 — Every Outlook calendar job crashes on a kwarg mismatch
`backend/services/worker_jobs.py:92,113` · **VERIFIED (reproduced)**

`create_calendar_event_idempotent` and `delete_calendar_event` always pass
`idempotency_key=...` to `adapter.create_event`/`delete_event`. The adapters in
`backend/jobs/calendar/jobs.py` bind directly to
`services.outlook.create_outlook_event` / `delete_outlook_event` /
`services.google_calendar.*`, none of which declare `idempotency_key` or
`**kwargs`. Every invocation raises
`TypeError: ... unexpected keyword argument 'idempotency_key'` before any
provider call.

The Outlook path is actively enqueued (`services/calendar_sync.py:62-73,87-92`)
whenever `OUTLOOK_CALENDAR_ENABLED`, so with Outlook on, **all** Outlook event
create/delete jobs fail, retry 3× (`worker.py` `max_tries=3`), and die — Outlook
calendar sync is completely broken, silently (fire-and-forget enqueue). Google
sync happens to work because it runs **in-process** via `calendar_sync.py`, not
through the broken adapter chain; the registered Google arq jobs are dead code.

CI is green because `tests/test_worker_calendar_services.py` stubs providers
with `async def provider_create(*args, **kwargs)`, and the Outlook unit tests
call the service functions directly, never through the adapter chain.

**Fix:** strip the kwarg in the adapter, or add `**_` to the provider
signatures, and add one test that drives a real provider signature through the
adapter.

### H2 — Event webhooks never fire
`backend/services/webhooks.py:115` · **VERIFIED by two independent readers**

The admin webhook feature is fully built: CRUD + test + rotate-secret endpoints
(`routers/webhooks.py`), a `WebhookManager.tsx` UI, HMAC signing,
Fernet-encrypted secrets, SSRF defenses, an outbox + drain cron, and
auto-disable after 10 failures. But `fire_webhook_event` — the emitter — has
**zero production call sites**. A repo-wide grep finds only its definition, one
direct test call, and a docstring mention. No `project.created`,
`task.completed`, `document.uploaded`, etc. is ever emitted; the drain cron
services a queue nothing populates; the only real delivery is the manual
`/webhooks/{id}/test` ping.

Consequence: admins configure integrations that appear healthy (test ping
succeeds, subscription shows active) and never receive a single real event —
exactly the silent-failure class the repo's own July-2026 review treats as its
most serious category. Worse, `docs/tech-debt-followups.md` lists the July fix
as having *un-broken* webhook delivery ("all 14 event types were dead"), but
only the arq job-name mismatch was fixed; the emit sites were never wired, so
the doc now asserts a state the code does not have.

**Fix:** call `fire_webhook_event` from the relevant router/service mutations
(mirroring `notify_*`), or remove the feature and its UI. Either way, add a test
that pins at least one real emit path.

### H3 — Rate limits collapse to a single global bucket on Railway
`backend/docker-entrypoint.py:70`, `backend/core/rate_limit.py:19` · **VERIFIED (uvicorn wheel inspected)**

The limiter keys on `get_remote_address` (i.e. `request.client.host`). The
production entrypoint execs uvicorn with no `--proxy-headers` /
`--forwarded-allow-ips`, and `FORWARDED_ALLOW_IPS` is set nowhere in the repo.
uvicorn 0.25.0 defaults `forwarded_allow_ips` to `127.0.0.1`, and its
`ProxyHeadersMiddleware` only rewrites the client when the TCP peer is trusted.
Behind Railway's edge proxy (a first-class target — `railway.json`,
`RAILWAY_ENVIRONMENT` detection in `core/auth.py` and `core/token_vault.py`) the
peer is the proxy's internal IP, so **every request shares one rate-limit key**.

Consequences:
- `/auth/login` at 5/min becomes 5/min **for the entire user base** — any
  anonymous client sending 5 login POSTs/min continuously 429s login for
  everyone.
- Aggregate traffic above 20/min starves `/auth/refresh`, force-logging-out
  users.
- The per-IP layer of brute-force defense is void (the per-email lockout still
  works).

Docker-compose deploys publish the port directly and are unaffected. Nothing in
the tech-debt tracker acknowledges this.

**Fix:** add `--proxy-headers --forwarded-allow-ips=<railway proxy range>` (or
set `FORWARDED_ALLOW_IPS`) in the entrypoint/Procfile, and add an integration
assertion that `X-Forwarded-For` drives the rate-limit key.

### H4 — `.dockerignore` bakes dev secrets into local production builds
`.dockerignore:14-17` · **VERIFIED (reproduced with a real Docker build)**

`.dockerignore` uses gitignore-style patterns (`.env`, `*.env`, `*.pem`,
`*token.json*`), but Docker matches with `filepath.Match` against the full
context path: a pattern without `**` matches **only at the top level**.
`backend/.env` — the exact file the `.dockerignore` comment says these rules
protect — is therefore **not** excluded. Following the documented
`docker-compose.prod.yml` flow on a host where dev compose required creating
`backend/.env`, `COPY backend/ ./` (Dockerfile:21) bakes that file's
`JWT_SECRET` / `SMTP_PASSWORD` / `TOKEN_ENCRYPTION_KEY` into an image layer at
`/app/.env`. `backend/database.py:7` then `load_dotenv(ROOT_DIR/'.env')` in the
running container, so those baked dev secrets become silent fallbacks in
production.

Same root cause leaks `backend/tests`, `**/__pycache__`, `*.pyc`, and
`frontend/node_modules` into the build context/image. `.gitignore`'s `*.env`
(gitignore semantics *do* recurse) keeps the file out of git, so Railway/CI
clean-checkout builds are safe — exposure is limited to local/host builds,
which is why this is high, not critical. The tech-debt tracker lists these rules
as *completed* work, overstating the protection.

**Fix:** `**/.env`, `**/*.env`, `**/*.pem`, `**/node_modules`, `**/__pycache__`,
`**/*.pyc`, `**/tests`.

### H5 — Completed-project cards crash on click
`frontend/src/components/coordination/ProjectBoard.tsx:384` · **VERIFIED (`tsc` TS2304)**

The Completed section renders
`onClick={() => navigate(\`/coordination/projects/${project.id}\`)}`, but
`useNavigate()` is only called inside `DraggableProjectCard`; the `ProjectBoard`
body never binds `navigate`. Clicking any completed card throws an uncaught
`ReferenceError` in the handler (React doesn't catch event-handler errors), so
navigation silently never happens — completed projects are unreachable from the
board. `tsc` reports exactly `TS2304: Cannot find name 'navigate'`.

It ships because `npm run build` is pure `vite build` (no `tsc` step) and this
is one of the file's two **baselined** strict-mode errors
(`scripts/typecheck-baseline.json`) — the exact runtime-bug class the ratchet
was built to prevent, grandfathered in. The e2e fixture can't catch it because
`EMPTY_BOARD.complete` is empty.

**Fix:** hoist `const navigate = useNavigate()` into the `ProjectBoard` body and
retire the baseline entry.

---

## 3. Medium-severity findings by subsystem

### Scheduling domain
- **Town-to-town sync discards `drive_to_override_minutes` on every create.**
  `services/town_to_town.py:152-172` unconditionally resets `drive_time_minutes`
  to the location default (or the *legacy* `travel_override_minutes`), never
  consulting the current override field. The API response shows the override;
  the stored doc is reset moments later, so conflict padding, workload
  drive-hours, and stats all use the wrong value. No test covers overrides.
- **Class/location employee-breakdown stats group on legacy `$employee_name`.**
  `routers/classes.py:211`, `locations.py:234` — post-migration schedules never
  carry `employee_name`, so every modern schedule buckets as "Unknown" in the
  profile charts.
- **Bulk/series operations skip calendar-event sync.**
  `schedule_bulk.py:55-87`, `schedule_crud.py:467-503` — bulk delete, delete
  series, bulk reassign, bulk update-location, and update-series soft-delete or
  mutate without touching external calendars. Staff keep events for cancelled
  classes and drive to them. No reconciliation job exists.
- **CSV import commit trusts the client and omits denormalized fields.**
  `schedule_import.py:395-427` — no format/DST/reference validation on the
  commit path (those live only in `/import/preview`); imported docs miss
  `location_name`, `drive_time_minutes`, class snapshots, and town-to-town
  fields, so they render without a location, get zero drive-time padding
  forever, and show "Unassigned". Batch rows aren't conflict-checked against
  each other despite the "atomic, conflict-checked" contract.
- **Recurring create + `idempotency_key` violates the per-user unique index
  mid-`insert_many`, leaving a partial series.** `schedule_helpers.py:85-88` —
  latent today (the frontend never sends the key) but breaks any API client
  that follows the documented retry-safety contract.

### Coordination & portal
- **Auto phase-advance counts soft-deleted tasks.** `phase_advance.py:49-60` —
  the `remaining` query lacks `deleted_at: None`, so a deleted incomplete task
  blocks phase advance forever. The manual-advance endpoint filters correctly,
  confirming intent.
- **Portal responses leak internal-only fields.** `portal/dashboard.py:27-33`
  and `workspace.py` return full project/partner-org docs to partner contacts,
  including the 10k-char internal `notes` (relationship/negotiation commentary),
  `created_by`, and org `status`. The portal UI renders none of these — it's an
  API over-return, contrasting with the deliberate stripping of task `details`
  elsewhere.

### Security & auth
- **Sentry receives plaintext passwords and raw tokens.**
  `core/sentry_scrub.py:64` scrubs headers/cookies/data/query but never
  `exception.frames[].vars`, breadcrumbs, or `request.url`. sentry-sdk 2.8.0
  defaults `include_local_variables=True`; login/register/reset models use plain
  `str` (not `SecretStr`), so an unhandled exception ships
  `UserLogin(email=..., password='<plaintext>')`, and a 500 on
  `GET /auth/reset-password/{token}` ships the raw token in the unscrubbed URL
  path. The observability checklist's verification steps would pass despite this.
- **`ADMIN_EMAILS` registration is standing unauthenticated privilege
  escalation.** `routers/auth.py:281` — registering with an address in
  `ADMIN_EMAILS` grants instant admin with no email-ownership verification (and
  the consent requirement is even waived). Until the legitimate owner registers,
  any visitor who submits that (well-known org) address becomes admin.
- **No unique index on `users.email`.** `routers/auth.py:274` — registration is
  check-then-insert; two concurrent registrations for the same email both
  insert, and every email-uniqueness assumption downstream (login,
  employee-linkage, reset lookup) then resolves ambiguously.

### Services & jobs
- **Offboarded internal staff keep receiving notifications.**
  `notification_prefs.py:251` and siblings — every partner-contact lookup filters
  `deleted_at: None`, but none of the internal-user lookups do (soft-delete
  leaves `status: approved`). Deleted staff keep getting project fan-outs, task
  assignments, and digest emails.
- **A failed instant email is recorded as handled, permanently suppressing
  dedup-keyed notifications.** `notifications.py:104` — a transient SMTP failure
  writes `outcome='skipped'` to `notifications_sent`, and `_was_already_sent`
  treats any record as delivered, so the reminder is never retried. Defeats the
  dedup-key retry semantics the module is built around.
- **In-process Google write clobbers the Outlook event mapping.**
  `calendar_sync.py:208` replaces the whole `calendar_events.{emp}` object
  instead of the dotted sibling path, dropping `outlook_event_id`. Masked today
  only because the Outlook job crashes first (H1) — becomes live the moment H1
  is fixed, orphaning Outlook events on delete/relocate.

### Frontend
- **Full page reload after 4h access-token expiry forces re-login despite a
  valid 30-day refresh token.** `lib/api.ts:120-128` excludes `/auth/me` from
  the refresh-on-401 flow, and the boot probe *is* `/auth/me`. Return-visit
  users must re-enter credentials, making the 30-day refresh token nearly
  useless for the common case. A boot-time refresh attempt (guarded by the
  existing single-flight dedupe) would fix it with no security change.
- **Partner portal renders internal rich-text HTML as literal markup.**
  `portal/PortalTaskDetailModal.tsx:317` — staff write descriptions in a TipTap
  editor that saves HTML; the portal renders it as `whitespace-pre-wrap` text,
  so partners see raw `<p><strong>…` tags. Not XSS (React escapes), but a
  guaranteed cross-surface rendering defect.
- **`CalendarWeek` layout memoization defeated by an unstable `days` dep.**
  `CalendarWeek.tsx:303` rebuilds `days` via `Array.from(...)` every render, so
  `computeDriveChain`+`computeOverlapLayout` for all 7 days re-run on every drag
  frame — the exact thing the inline comment says the memo prevents.
  `CalendarDay.tsx` does it correctly.
- **Two keyboard/nested-interactive a11y defects on drag cards.**
  `ProjectDetail.tsx` TaskCards can't be opened by keyboard (WCAG 2.1.1);
  `KanbanBoard.tsx` nests `<a>` (EntityLink) inside a `<button>` (invalid HTML,
  axe nested-interactive). The axe e2e gate misses both — it runs against mocked
  empty data, so no cards ever render.

### Infra / CI / docs
- **Prod compose stores uploads on the ephemeral container filesystem.**
  `docker-compose.prod.yml:34-71` sets no `UPLOAD_DIR` and mounts no volume for
  `/app/uploads`, despite the Dockerfile's own warning — all attachments are
  lost on every redeploy/recreate. `mongo_data` gets a named volume; uploads
  don't.
- **Dev compose frontend publishes 5173 but Vite is pinned to 3000.**
  `docker-compose.yml:57` — nothing listens on 5173, 3000 isn't published, so
  `docker-compose up` per the README yields an unreachable frontend; the README
  documents the dead port. The quick-start also fails earlier because
  `env_file: ./backend/.env` must exist and the README never says to create it.
- **Tech-debt tracker's "CI gaps" section reports five items as open that the
  same commit closed** (`docs/tech-debt-followups.md:155-170`) — docker-build
  job, concurrency+timeouts, SHA-pinned actions, pip-audit scanning
  requirements-dev, and eslint exhaustive-deps all exist now. Contradicts the
  doc's own "verified against code" contract.

### Dependencies
- **Motor is deprecated upstream and pinned at a Nov-2023 release.**
  `requirements.txt:13` — `motor==3.3.2` (latest 3.7.1). MongoDB deprecated
  Motor in May 2025 with support ending ~May 2026 (already past). The entire
  data layer rides a driver that will get no further fixes, including security
  fixes; it also caps `pymongo<5`, holding pymongo at 4.6.3. Upstream path is
  `pymongo.AsyncMongoClient`.
- **`npm audit` gate is advisory for ALL prod vulnerabilities.**
  `.github/workflows/ci.yml:162-164` — `continue-on-error: true` was added for
  one acknowledged-not-applicable advisory (react-router
  GHSA-qwww-vcr4-c8h2), but npm audit has no per-advisory exception, so any
  *new* high/critical in the 44 prod deps also merges green. The advisory's fix
  (react-router 8.3.0) now exists, so the blocking condition is satisfiable; or
  use `audit-ci`/`better-npm-audit` with an allowlist for the single GHSA.

---

## 4. Selected low-severity findings & noteworthy tech debt

These are worth tracking but are not release-blocking.

- **Cache-Control middleware stamps positive `max-age` on error responses**
  (`server.py:337`) — a cached 401 can be served for up to 5 minutes after
  re-login (no `Vary`); PUT/DELETE don't invalidate the browser's cached GET
  list. The intended ETag/304 fallback is **dead code** under
  `BaseHTTPMiddleware` (`call_next` never exposes `.body`), so no conditional GET
  ever revalidates.
- **Worker's `max_tries=3` comment promises retries that never happen**
  (`worker.py:342`) — arq only retries on an explicit `Retry`, which no job
  raises. Transient failures in password-reset/magic-link emails and calendar
  sync are terminal, invisible (the anti-enumeration design returns success
  regardless).
- **Worker process never initializes Sentry** (`worker.py:27`) although prod
  compose provisions `SENTRY_DSN` to it — combined with the no-retry reality,
  background failures are observable only in container logs.
- **DNS-rebinding TOCTOU in webhook SSRF validation** (`services/webhooks.py`) —
  the denylist check and the httpx connect resolve DNS independently; a
  low-TTL flip can point the connect at `169.254.169.254`. Mitigated by
  admin-only + HTTPS-only + no-redirects (hence low). Also,
  `socket.getaddrinfo` runs synchronously inside async handlers, blocking the
  loop.
- **Login lockout isn't cleared by password reset** (`auth.py:666`) though the
  429 message tells users to reset to recover; self-heals in 15 min.
- **Admin soft-delete never revokes the refresh chain** (`auth.py:559`) — a
  deactivated user's device keeps rotating tokens for up to 30 days (access is
  blocked by the fail-closed `is_deleted` check, so this is defense-in-depth
  erosion).
- **Invitation tokens are stored raw and returned in bulk by
  `GET /users/invitations`** (`users.py:414`) — contradicting the
  create-endpoint's own no-token policy; these grant a pre-assigned role up to
  admin. Requires an admin session or DB read to exploit.
- **Production CSP `script-src` includes blanket `https:`** (`server.py:360`) —
  neutralizes most of the header's XSS value; the SPA serves all its own chunks
  from `'self'`.
- **CSV/XLSX exports write user text unescaped** (`schedule_import.py:176-194`,
  `exports.py`) — spreadsheet formula injection (`=HYPERLINK(...)`) when an admin
  opens an export.
- **GDPR export queries schedules by the wrong field** (`users.py:241`, uses
  `created_by` instead of `created_by_user_id`) — the `schedules_created`
  section is always empty.
- **CSRF token rotates on every response with no frontend 403-retry**
  (`server.py:270-293`, `lib/api.ts`) — a read-cookie-then-rotate race under
  concurrent requests can produce intermittent 403s on mutations. (Backend-core
  called this "harmless"; the security reader's more complete analysis shows the
  race — treat it as a real intermittent-failure risk.)
- **Secret reuse:** `CSRF_SECRET` and `TOKEN_DIGEST_SECRET` both default to
  `JWT_SECRET`, so rotating `JWT_SECRET` silently invalidates every outstanding
  reset/portal token digest and CSRF token. No key-rotation runbook exists.
- **Three unused packages ship to production** (`boto3`, `typer`,
  `requests-oauthlib`) — `boto3`+`botocore` alone add ~80MB and audit surface;
  `requests`/`pytest` are also test-only but in prod requirements.
- **Alert-driven-only dependency maintenance** — no `dependabot.yml`/renovate,
  so CVE-touched packages are current while everything else is frozen at
  2023-2024 (redis-py 3 majors behind, pandas/reportlab/bcrypt/mypy a major
  each, `@sentry/react` two majors). No Python lockfile → non-deterministic
  builds.

---

## 5. Cross-cutting issues (between subsystem boundaries)

These fall in the gaps between readers and are easy to miss in a
single-subsystem review.

- **Frontend fetch-all vs the backend 200-item pagination cap.**
  `core/pagination.py` caps every list endpoint at `MAX_PAGE_SIZE=200`;
  `useDashboardData` calls `getAll()` with no params for
  locations/employees/classes/schedules, never reads `total`, and has no
  pagination UI. Any collection past 200 rows — or the ±60-day schedule window
  at only ~1.7 schedules/day — **silently disappears** from the calendar,
  kanban, and manager views. Confirmed against both files. This is a latent
  data-loss-from-the-user's-view bug that surfaces with organic growth.
- **Four competing "today"/timezone definitions.** The scheduling reader found
  three divergent *server-side* "today" definitions (UTC date in series
  windowing, server-local `date.today()` in employee/location guards). The
  fourth is the *browser*: `DashboardPage` computes the ±60-day window with
  `date-fns` over `new Date()` in the browser's local zone, while the backend
  interprets wall-clock strings as `SCHEDULE_TIMEZONE` (America/Chicago). No
  mechanism surfaces the configured schedule timezone to the client, so a user
  in another timezone sees off-by-one-day window boundaries and "today"
  schedules. `tzdata` is pinned at 2024.2 (two years of IANA rule changes
  missing) in a scheduling app.
- **Hand-maintained FE/BE contract mirrors have no drift guard.**
  `frontend/src/lib/upload-constraints.ts` mirrors `backend/core/upload.py` by
  comment, but the backend limit is `MAX_UPLOAD_BYTES`-configurable while the
  frontend hardcodes 10MB — any operator override silently desyncs client
  validation. Same class: the `"reused"` refresh-token string match, e2e-fixture
  phase names. Given the repo's fondness for static guard tests, a
  cross-boundary contract check is a natural missing ratchet.
- **Correction to a reader finding:** the services reader flagged
  `schedule.upcoming_today`, `schedule.town_to_town`, and
  `schedule.idle_employee` as "implemented but nothing dispatches." This is
  **partly wrong** — `routers/system.py` (which no reader covered) consumes all
  three as **in-app live alerts** via `_LIVE_TYPE_KEYS`/`get_frequency`. They are
  correctly not *email/digest* dispatched, so the registry flag is defensible.

---

## 6. Areas not fully covered (scope honesty)

- **`backend/routers/system.py`** — reviewed only during synthesis (above); a
  full pass of `/system/config`, `/activity-logs`, and the live-alerts batching
  (`_fetch_all_with_guard`, `_NOTIFICATION_MAX_DOCS=10_000`) is still owed.
- **Google Maps / Places integration** (`MapView.tsx`,
  `PlacesAutocomplete.tsx`, `LocationFormDialog.tsx`) and the **jsPDF +
  html2canvas PDF export** path got no functional/security review. The Maps key
  is baked into the public bundle at build time with referrer-restriction
  resting on a Dockerfile comment; whether `railway.json` passes the build ARG
  is unverified (if not, prod maps silently degrade). `html2canvas` is
  effectively unmaintained (no release since Jan 2022).
- **Operational continuity** — no evidence of MongoDB backup/DR, a restore
  runbook, or key-rotation procedures. (The unused `boto3` pin may be a vestige
  of an intended backup-to-S3 job.) Nothing alerts on worker-heartbeat staleness
  beyond the `/health` `worker_degraded` flag, which requires someone polling.
- **Pydantic model layer** (`models/schemas.py`, `coordination_schemas.py`) —
  reviewed only incidentally. Several findings (arbitrary status strings on
  `PUT /schedules`, untyped `due_date`, `EmailStr` on create but plain `str` on
  update) point to a *pattern* of inconsistent create-vs-update validation
  strictness worth a dedicated pass.
- **Docs not verified against code:** `PARTNER_COORDINATION_PRD.md`,
  `docs/OUTLOOK_SETUP.md`, `UX_ACCESSIBILITY_REVIEW.md`,
  `codebase-architecture-review.md`, `observability-scrubbing-checklist.md`.

---

## 7. What the codebase does well

Worth stating plainly, because it shapes how much to trust the rest:

- **Auth is textbook.** Atomic one-time-use refresh-token claim, replay
  detection with a 30s two-tab grace window and full-chain revocation, bcrypt
  dummy-verify timing equalization, JWT-secret strength enforcement at boot, and
  a token-versioning invalidation scheme whose design doc matches the code.
- **`SoftDeleteRepository`** makes forgetting the `deleted_at` filter
  structurally impossible on migrated routers, with a static guard test that
  prevents regrowth of raw filters, and CAS helpers for concurrency-sensitive
  paths.
- **Portal tenant isolation** is centralized in one boundary
  (`require_partner_project`), gated by owner-visibility before any child
  access, double-scoped by `task_id+project_id`, and locked by cross-org
  rejection tests.
- **Anti-enumeration** is done right: password reset and portal magic-link do
  all DB/token/SMTP work in worker jobs so handler timing is input-independent;
  tokens are stored as HMAC digests with TTL indexes.
- **CI is disciplined:** every action SHA-pinned, least-privilege permissions,
  fail-closed integration tests against real Mongo/Redis (`REQUIRE_MONGO=1`), a
  docker-build job that boots the real image and asserts PID-1 uid == 1001, and
  two clever static ratchets (enqueue-job-name guard, per-file TS-error
  ceiling) with anti-vacuousness self-tests.
- **Privilege-drop entrypoints** are fail-closed (refuse to exec if still root).
- **The CVE-pin comment block** in `requirements.txt` names each CVE, its
  transitive path, and why the minimum version was chosen — a future maintainer
  can safely bump it.
- **The tech-debt tracker** uses measured counts (176 raw `deleted_at` filters,
  851 TS errors across 67 files) that verify exact against code — apart from the
  stale "CI gaps" section flagged above.

---

## 8. Methodology

- **10 subsystem readers** (backend core/assembly, scheduling, coordination +
  portal, services/jobs/migrations, security/auth, backend tests, frontend core,
  frontend components, dependencies, infra/CI/docs) read their scope in full.
- **Adversarial verification:** every critical/high claim was handed to an
  independent verifier prompted to *refute* it against the code, tracing callers
  and checking for mitigations (middleware, guards, tests, tracked deferrals).
  Several claims were reproduced empirically (the Docker build for H4, a live
  uvicorn wheel inspection for H3, `tsc` for H5, executing the real provider
  signatures for H1). One high was downgraded to medium on verification
  (task-reminder cron).
- **Completeness critic:** swept for files no reader covered, cross-cutting
  contracts between subsystems, and contradictions between reports — its output
  is Sections 5 and 6.

Total: 18 agents, ~2.3M tokens of analysis.

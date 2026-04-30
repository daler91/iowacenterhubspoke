# HubSpoke — Scheduling + Coordination Platform

HubSpoke is a full-stack app used by Iowa Center teams to schedule classes, coordinate partner projects, and provide partner-facing portal access.

## Features (implemented)

- **Scheduling calendar** with conflict checks, recurrence support, and bulk operations.
- **Travel/drive-time handling** with Google Maps integration and fallback calculations.
- **Role-based access** for internal users plus invitation/approval flows.
- **Coordination module** for partners, projects, tasks, docs, comments/messages, outcomes, and promotion checklists.
- **Partner portal** token-authenticated views for partner dashboards, tasks, messages, and documents.
- **Notifications + email flows** (digest/reminders, invitations, password reset, portal magic links).
- **Exports/reporting endpoints** and activity logging.

> Note: roadmap ideas and historical analysis docs live under `docs/archive/`; feature claims here are limited to modules currently present in `backend/routers` and `frontend/src`.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind, Radix UI |
| Backend API | FastAPI (Python 3.11), Motor (MongoDB) |
| Data | MongoDB 7 |
| Queue/async jobs | Redis + arq worker |
| Auth | JWT + refresh-token storage, CSRF double-submit |
| Deployment | Docker / Docker Compose, Railway |

## Project Structure (current)

```text
.
├── backend/
│   ├── server.py                    # FastAPI app assembly, middleware, startup lifecycle
│   ├── worker.py                    # arq jobs + worker settings
│   ├── database.py                  # Mongo connection + db handle
│   ├── migrations/                  # Versioned migration scripts + runner
│   ├── core/                        # Auth, logging, rate-limit, queue/config helpers
│   ├── models/                      # Pydantic schemas (scheduling + coordination)
│   ├── services/                    # Domain services (calendar sync, email, notifications, drive time, etc.)
│   └── routers/
│       ├── auth.py
│       ├── schedules.py             # Aggregates schedule_* route modules
│       ├── schedule_*.py            # CRUD/create/bulk/import/conflict helpers
│       ├── locations.py employees.py classes.py users.py reports.py analytics.py
│       ├── projects.py project_*.py partner_orgs.py event_outcomes.py promotion_checklist.py
│       ├── exports.py webhooks.py notification_preferences.py system.py
│       └── portal/                  # Partner portal router package split
│           ├── auth.py dashboard.py tasks.py messages.py documents.py
│           └── _shared.py
├── frontend/
│   ├── src/
│   │   ├── index.tsx
│   │   ├── components/
│   │   │   ├── portal/              # Portal-specific React UI
│   │   │   ├── coordination/        # Partner/project/task coordination UI
│   │   │   ├── analytics/
│   │   │   └── ui/                  # Shared design-system primitives
│   │   ├── hooks/                   # Data + interaction hooks
│   │   ├── lib/                     # API/auth/shared utilities
│   │   └── pages/                   # Top-level pages (e.g., login)
│   └── package.json                 # Frontend scripts and deps
├── docs/                            # Operational + architecture docs
├── Dockerfile / Dockerfile.dev
├── docker-compose.yml               # Local full stack (mongo/redis/backend/worker/frontend)
└── railway.json
```

## Runtime Flow

1. **API startup (`backend/server.py`)**
   - Loads env/config, logging, optional Sentry.
   - Mounts all routers (including `routers/portal/*`).
   - On startup, ensures indexes, runs startup data migrations, and seeds defaults when needed.

2. **Worker startup (`backend/worker.py`)**
   - `arq worker.WorkerSettings` processes async jobs (email, reminders, notification digests, calendar side effects, etc.).

3. **Frontend runtime (`frontend/src`)**
   - Vite serves SPA locally (`npm start`), app talks to backend API (via configured base URL env).

4. **Compose local dev (`docker-compose.yml`)**
   - Brings up Mongo + Redis + backend + worker + frontend as one stack.

## Getting Started

### Prerequisites

- Node.js 20+ recommended (frontend runs on npm scripts).
- Python 3.11+.
- MongoDB 7.
- Redis 7 (required for worker/queued features; app may still run API-only without worker).

### Local development (Docker Compose)

```bash
docker-compose up --build
```

Services:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8080/api/v1`
- API docs: `http://localhost:8080/docs`

### Manual setup

#### Backend API

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# minimal
export MONGO_URL=mongodb://localhost:27017
export DB_NAME=iowa_center_hub
export JWT_SECRET=change-me

# optional / feature-gated
export REDIS_URL=redis://localhost:6379
export GOOGLE_MAPS_API_KEY=your_key_here

uvicorn server:app --reload --host 0.0.0.0 --port 8080
```

#### Worker (optional but recommended for async features)

```bash
cd backend
source venv/bin/activate
arq worker.WorkerSettings
```

#### Frontend

```bash
cd frontend
npm install
npm start
```

## Scripts + Package Managers

- Root `package.json` is tooling-only (currently `npm run seed` for demo data).
- Frontend uses **npm scripts** from `frontend/package.json` (`start`, `build`, `test`, `lint`, etc.).
- Backend is Python-managed (`pip` + `uvicorn`/`arq` commands; no backend `package.json`).

## Environment Variables

Core backend variables used in current runtime/deploy flow:

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URL` | Yes | Mongo connection string used by API and worker. |
| `DB_NAME` | No | Defaults to `iowa_center_hub` when not set. |
| `JWT_SECRET` | Yes in production | Required for secure token signing; do not rely on dev fallback in production. |
| `CSRF_SECRET` | Recommended | Falls back to JWT secret if unset. |
| `REDIS_URL` | Required for worker-backed features | Needed by arq worker and Redis-backed runtime paths. |
| `ENVIRONMENT` | Recommended | Use `production` in deployed envs for correct behavior/logging. |
| `CORS_ORIGINS` | Production required | Comma-separated allowed origins for browser access. |
| `APP_URL` | Production required | Canonical public URL used in generated links (portal/invite/reset email flows). |
| `GOOGLE_MAPS_API_KEY` | Optional | Enables Google Distance Matrix path when configured. |
| `SENTRY_DSN` | Optional | Enables Sentry error reporting. |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` `EMAIL_FROM` | Required for real email sending | If SMTP is unset, dev-mode logging behavior applies. |
| `UPLOAD_DIR` | Optional | Upload storage path; container entrypoint prepares/chowns this directory. |

For concrete deploy notes (especially `APP_URL`/`CORS_ORIGINS` and SMTP behavior), see the docs linked below.

## Canonical Operational Docs

Use these docs as the source of truth before changing related code:

- [`docs/migrations.md`](docs/migrations.md) — migration runner behavior and adding migrations.
- [`docs/repository-pattern.md`](docs/repository-pattern.md) — repository migration guidance and soft-delete query conventions.
- [`docs/tech-debt-followups.md`](docs/tech-debt-followups.md) — prioritized remediation tracker.
- [`docs/OUTLOOK_SETUP.md`](docs/OUTLOOK_SETUP.md) — Outlook OAuth setup details.
- [`docs/portal_permission_matrix.md`](docs/portal_permission_matrix.md) — portal role/permission matrix.

Historical analyses in [`docs/archive/`](docs/archive/) are useful context but are not canonical runbooks.

## Deployment Notes

- `Dockerfile` is the production container build path used by Railway (`railway.json`).
- `backend/docker-entrypoint.py` handles upload directory setup and then execs `uvicorn`.
- `docker-compose.yml` is the canonical local multi-service runtime.


## Contributor Status (April 2026 refactor)

Use this section as the quick status board before starting implementation work.

### Completed phases

The April 2026 remediation shipped in five phases:

- **Phase 1** — CSV upload DoS guardrails, 401 redirect debounce fixes, password-change cache invalidation wiring, Redis lifespan cleanup, test cleanup, archive hygiene.
- **Phase 2** — shared backend pagination utilities, removal of deprecated `travel_override_minutes`, migration runner, and `/api/*` legacy deprecation/sunset headers.
- **Phase 3a** — `SoftDeleteRepository` introduced and adopted in `locations`/`classes`; schedule CRUD helper extraction.
- **Phase 3b** — partner portal router split from a monolith into the `backend/routers/portal/` package.
- **Phase 4a/4b** — typed API/frontend model layer improvements, Vite env typing, calendar layout helper extraction + tests.
- **Phase 5** — baseline contributor docs and tooling (`docs/migrations.md`, `docs/repository-pattern.md`, pre-commit, follow-up tracker).

For detailed provenance, see `docs/tech-debt-followups.md`.

### Active deferred areas (still open)

From `docs/tech-debt-followups.md`, these are intentionally deferred and still active:

- Migrate the remaining routers to `SoftDeleteRepository`.
- Enable `tsc --noEmit` in CI once strict-mode TypeScript debt is reduced.
- Decompose oversized frontend components (`UserManager`, `LocationManager`).
- Add list virtualization for large rendered tables/lists.
- Tighten schedule form payload typing and API signatures.
- Hard-remove legacy `/api/` mount after production hit count reaches zero.
- Hard-remove in-process password-change cache approach for multi-worker deployments.

### Where to extend safely

Prefer these extension points to keep implementation consistent:

- **Repository/data-access work**: use `backend/core/repository.py::SoftDeleteRepository` and the migration recipe in `docs/repository-pattern.md` rather than reintroducing inline `{"deleted_at": None}` filters.
- **Portal features**: follow the `backend/routers/portal/` package split conventions (feature-specific module boundaries, shared helpers) instead of growing a single large router file.
- **Pagination and list endpoints**: use shared utilities in `backend/core/pagination.py` to keep response shape and validation behavior uniform.
- **Schema changes**: implement DB changes via the migration runner documented in `docs/migrations.md`.

### Do not reintroduce

- Direct use of deprecated `travel_override_minutes` fields.
- New code paths that depend on the legacy `/api/*` mount.
- New raw soft-delete filters when a repository abstraction exists.
- Re-growth of partner portal into one monolithic router file.

### Consistency cross-links

- Repository pattern guide: [`docs/repository-pattern.md`](docs/repository-pattern.md)
- Migration runner guide: [`docs/migrations.md`](docs/migrations.md)
- Tech debt tracker: [`docs/tech-debt-followups.md`](docs/tech-debt-followups.md)
- Architecture/context reviews: [`docs/archive/UX_ARCHITECTURE_REVIEW.md`](docs/archive/UX_ARCHITECTURE_REVIEW.md), [`docs/archive/PARTNER_PORTAL_CROSS_FUNCTIONAL_ANALYSIS_2026-04-29.md`](docs/archive/PARTNER_PORTAL_CROSS_FUNCTIONAL_ANALYSIS_2026-04-29.md)

## License

Private — Iowa Center internal use.

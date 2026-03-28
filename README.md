# Iowa Center Hub & Spoke — Scheduling Platform

A full-stack scheduling platform built for the Iowa Center to manage employee class assignments across multiple satellite locations. The "hub and spoke" model uses Des Moines as the central hub, with employees traveling to surrounding Iowa cities.

## Features

- **Calendar Scheduling** — Drag-and-drop weekly/daily/monthly calendar with 30-minute snap intervals
- **Drive Time Calculation** — Google Distance Matrix API integration with Haversine fallback estimates
- **Town-to-Town Travel** — Automatic detection and visualization when employees visit multiple cities in one day
- **Conflict Detection** — Real-time conflict checking including drive time buffers and Outlook calendar integration
- **Recurrence** — Weekly, biweekly, and custom recurrence patterns with bulk schedule generation
- **Role-Based Access** — Admin, scheduler, editor, and viewer roles with invitation-based onboarding
- **Analytics & Forecasting** — Trend analysis, drive optimization suggestions, and linear regression forecasting
- **Reports** — Weekly summary reports with PDF export, workload breakdowns by employee and class
- **CSV Import/Export** — Bulk schedule management via CSV files
- **Activity Logging** — Structured audit trail of all schedule operations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS, Radix UI |
| **Backend** | Python 3.11, FastAPI, Motor (async MongoDB driver) |
| **Database** | MongoDB 7 |
| **Cache/Queue** | Redis 7, arq (async task queue) |
| **Auth** | JWT (HTTP-only cookies), bcrypt, CSRF double-submit |
| **Maps** | Google Distance Matrix API (optional) |
| **Deployment** | Docker, Railway |

## Project Structure

```
├── backend/
│   ├── server.py              # FastAPI app, middleware, startup
│   ├── database.py            # MongoDB connection
│   ├── core/
│   │   ├── auth.py            # JWT, password hashing, RBAC
│   │   ├── rate_limit.py      # SlowAPI rate limiting
│   │   ├── constants.py       # Shared constants
│   │   ├── logger.py          # Structured JSON logging
│   │   └── queue.py           # Redis/arq job queue
│   ├── models/
│   │   └── schemas.py         # Pydantic request/response models
│   ├── routers/
│   │   ├── auth.py            # Register, login, logout, invitations
│   │   ├── schedules.py       # Schedule router (combines sub-routers)
│   │   ├── schedule_crud.py   # Schedule CRUD + relocate
│   │   ├── schedule_bulk.py   # Bulk operations
│   │   ├── schedule_import.py # CSV import/export
│   │   ├── schedule_conflicts.py # Conflict checking + travel chain
│   │   ├── locations.py       # Location CRUD + drive time endpoints
│   │   ├── employees.py       # Employee CRUD + stats
│   │   ├── classes.py         # Class type CRUD + stats
│   │   ├── users.py           # User management (admin)
│   │   ├── reports.py         # Dashboard stats, workload, weekly summary
│   │   ├── analytics.py       # Trends, forecast, drive optimization
│   │   └── system.py          # Config, activity logs, notifications
│   └── services/
│       ├── drive_time.py      # Drive time caching + Google API
│       ├── activity.py        # Activity log service
│       └── schedule_utils.py  # Conflict detection, recurrence, helpers
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Router setup, protected routes
│   │   ├── components/        # UI components (calendar, forms, managers)
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # API client, auth context, utilities
│   │   └── pages/             # Login, Dashboard
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.js
├── Dockerfile                 # Multi-stage production build
├── docker-compose.yml         # Local development stack
└── railway.json               # Railway deployment config
```

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.11+
- MongoDB 7+
- Redis 7+ (optional — falls back to synchronous processing)

### Local Development (Docker)

```bash
# Start all services (MongoDB, Redis, backend, worker, frontend)
docker-compose up

# Frontend: http://localhost:5173
# Backend API: http://localhost:8080/api/v1
# API Docs: http://localhost:8080/docs
```

### Manual Setup

**Backend:**

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Required
export MONGO_URL=mongodb://localhost:27017
export DB_NAME=iowa_center_hub
export JWT_SECRET=$(openssl rand -hex 32)

# Optional
export GOOGLE_MAPS_API_KEY=your_key_here
export REDIS_URL=redis://localhost:6379

uvicorn server:app --reload --port 8080
```

**Frontend:**

```bash
cd frontend
yarn install
yarn start
# Opens at http://localhost:5173
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URL` | Yes | — | MongoDB connection string |
| `DB_NAME` | No | `iowa_center_hub` | Database name |
| `JWT_SECRET` | **Production** | Random (dev) | Secret for JWT signing. **Must be set in production.** |
| `CSRF_SECRET` | No | `JWT_SECRET` | CSRF token HMAC secret |
| `GOOGLE_MAPS_API_KEY` | No | — | Enables Google Distance Matrix for accurate drive times |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis for job queue and rate limiting |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins |
| `SENTRY_DSN` | No | — | Sentry error tracking |
| `ENVIRONMENT` | No | `development` | `production` or `development` |
| `VITE_GOOGLE_MAPS_API_KEY` | No | — | Frontend Google Maps key |

## API Overview

All endpoints are under `/api/v1`. Interactive docs at `/docs` (Swagger UI) and `/redoc`.

| Group | Prefix | Description |
|-------|--------|-------------|
| Auth | `/auth` | Register, login, logout, invitations |
| Schedules | `/schedules` | CRUD, bulk ops, import/export, conflicts |
| Locations | `/locations` | Location CRUD, drive time lookups |
| Employees | `/employees` | Employee CRUD, stats |
| Classes | `/classes` | Class type CRUD, stats |
| Users | `/users` | Admin user management |
| Reports | `/dashboard`, `/reports`, `/workload` | Stats and summaries |
| Analytics | `/analytics` | Trends, forecast, drive optimization |
| System | `/system`, `/activity-logs`, `/notifications` | Config and logs |
| Health | `/health` | Liveness check (MongoDB + Redis status) |

## Deployment

The app is configured for **Railway** with a multi-stage Docker build:

1. Stage 1: Builds the React frontend with Vite
2. Stage 2: Serves the FastAPI backend with the built frontend as static files

```bash
# Production build
docker build -t iowa-center .
docker run -p 8080:8080 \
  -e MONGO_URL=mongodb://... \
  -e JWT_SECRET=... \
  iowa-center
```

## License

Private — Iowa Center internal use.

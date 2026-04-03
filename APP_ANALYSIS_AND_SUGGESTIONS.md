# Iowa Center Hub & Spoke - Future Enhancement Suggestions

> Last updated: April 2026. For current codebase analysis and known issues, see `CODEBASE_ANALYSIS.md`.

## Implemented Features (Complete)

The following previously-suggested improvements have been implemented:

- CORS configuration
- JWT in httpOnly cookies
- CSRF protection (double-submit cookie)
- Security headers (XSS, HSTS, CSP, clickjacking)
- Rate limiting (slowapi + Redis)
- RBAC (admin/scheduler/editor/viewer)
- Error boundaries
- TypeScript migration
- Code splitting + lazy loading
- URL-based routing
- Soft deletes with restore
- Structured JSON logging
- Denormalization sync (background jobs)
- Constants extraction
- Schedule router split
- .env.example template
- Comprehensive README
- CI/CD pipeline (GitHub Actions)
- Docker Compose for local dev
- Sentry error tracking
- MongoDB compound indexes
- API versioning (/api/v1/)
- Health check endpoint
- Outlook + Google Calendar integration
- Bulk operations + CSV import/export

---

## Remaining Enhancement Ideas

### High Impact

| Feature | Description | Effort |
|---------|-------------|--------|
| **Schedule Templates** | Save/load common schedule configurations for one-click creation | Medium |
| **Email Notifications** | Schedule assignments, reminders, conflict warnings via SendGrid/SES | Medium |
| **WebSocket Real-Time** | Live schedule updates across tabs/users | High |
| **E2E Tests** | Playwright tests for critical user journeys | Medium |

### Medium Impact

| Feature | Description | Effort |
|---------|-------------|--------|
| **Employee Self-Service** | Read-only portal for employees to view their schedules | High |
| **Approval Workflow** | Draft schedules requiring manager approval | Medium |
| **Drag-and-Drop Rescheduling** | Drag schedule blocks on calendar (@dnd-kit already installed) | Medium |
| **PWA Support** | Service worker + manifest for mobile installability | Low |
| **Dark Mode** | Wire up next-themes (already installed) with Tailwind dark classes | Low |

### Low Impact

| Feature | Description | Effort |
|---------|-------------|--------|
| **Print-Friendly Views** | Optimized print stylesheets for calendar views | Low |
| **Database Backup Automation** | Scheduled mongodump to S3 | Medium |
| **API Documentation** | Enrich OpenAPI/Swagger with examples and descriptions | Medium |

# HubSpoke Scheduler - PRD

## Original Problem Statement
Build a web-based employee scheduling application that visually accounts for drive times and travel blocks using a Hub and Spoke travel model (Hub: 2210 Grand Ave, Des Moines, IA 50312).

### Added Product Requirements
- Google Map view to visualize locations
- PDF export functionality
- Project management views: Kanban board, workload dashboard, activity feed, employee profiles, notifications
- Scheduling enhancements: conflict detection, recurring schedules, weekly summary reports, drag-and-drop calendar interactions
- Improved mobile responsiveness
- Outlook Calendar integration (blocked pending user credentials)
- Class Series tracking with on-the-fly class creation during scheduling

## Architecture
- **Frontend**: React + Tailwind + Shadcn UI
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **Map**: Google Maps JavaScript API (@vis.gl/react-google-maps)
- **Auth**: JWT (bcrypt + PyJWT)
- **PDF**: jsPDF + html2canvas

## User Personas
- **Team Manager**: Schedules employees, manages locations, views calendar
- **Admin**: Full CRUD on employees, locations, and schedules

## Core Requirements
1. JWT Authentication (register/login)
2. Location CRUD with drive time from Hub
3. Employee CRUD with calendar color
4. Class scheduling with automatic travel time blocking
5. Town-to-town warning system
6. Weekly/Daily/Monthly calendar views
7. Google Maps view with Hub & Spoke markers
8. PDF export of calendar
9. Project dashboards and reporting
10. Class Series tracking with reusable class types

## What's Been Implemented (March 20, 2026)
- [x] Full JWT auth (register/login/protected routes)
- [x] Location management with 5 seeded Iowa locations
- [x] Employee management with color coding
- [x] Class scheduling with auto drive time calculation
- [x] Town-to-town travel detection & warning
- [x] Weekly calendar view with class + drive time blocks
- [x] Daily calendar view
- [x] Monthly calendar overview
- [x] Google Maps integration with Hub/Spoke markers
- [x] PDF export functionality
- [x] Dashboard with stats overview
- [x] Sidebar navigation
- [x] Responsive design

### PM Features Added (March 20, 2026)
- [x] Employee Workload Dashboard (bar charts, pie chart, per-employee cards with class/drive time breakdown)
- [x] Kanban/Status Board (Upcoming → In Progress → Completed columns with drag-and-drop cards)
- [x] Activity Feed (timeline of recent actions: schedules created/deleted, employees added, status changes)
- [x] Employee Profiles (detailed stats, location breakdown chart, recent assignments list)
- [x] Notifications Panel (bell icon with alerts: upcoming classes, town-to-town warnings, idle employees)

## What's Been Implemented (March 21, 2026)
- [x] Class Series data model and `/api/classes` CRUD endpoints
- [x] Schedule-to-class linkage with `class_id`, `class_name`, and `class_color`
- [x] Class sync behavior: renaming a class updates linked schedules
- [x] Safe class deletion: schedules retain readable class metadata even after class removal
- [x] New Classes dashboard view and sidebar navigation item
- [x] Inline class creation inside `ScheduleForm` via “Add New Class” flow
- [x] Calendar, Kanban, Workload Dashboard, and Weekly Report now surface class info
- [x] Weekly report supports class filtering; workload now includes class breakdown per employee
- [x] Backend class feature test coverage added in `/app/backend/tests/test_class_series.py`

## Key Endpoints
- `/api/auth/{register,login,me}`
- `/api/locations`
- `/api/employees`
- `/api/classes`
- `/api/schedules`
- `/api/schedules/check-conflicts`
- `/api/schedules/{id}/relocate`
- `/api/dashboard/stats`
- `/api/workload`
- `/api/activity-logs`
- `/api/notifications`
- `/api/reports/weekly-summary`

## Test Results
- Backend: 100% (23/23 tests passed)
- Frontend: 95% (all core + PM features working)

### Latest Verification (March 21, 2026)
- Self-tested backend via authenticated API flows for class CRUD, schedule linkage, class sync, and class deletion preservation
- Smoke-tested frontend registration + Classes view on preview URL
- Testing agent iteration 4: backend 100%, frontend 100% for Class Series feature

## Prioritized Backlog
### P0 (Done)
- Core scheduler MVP
- Project management suite
- Recurring schedules, conflict detection, PDF export, drag-and-drop relocation
- Class Series tracking and on-the-fly class creation

### P1 (Next)
- Outlook Calendar integration once Azure credentials are provided by the user
- Kanban drag-and-drop polish / refinement for broader workflow management

### P2 (Future)
- Email/SMS notifications for reminders and schedule changes
- Team-wide weekly reports
- Pagination for heavy API responses
- Production hardening (e.g. rate limiting)

## Current Status
- App is functional end-to-end for scheduling, travel-time logic, maps, reporting, and class tracking
- Outlook integration remains blocked by missing user credentials
- No MOCKED core flows or APIs

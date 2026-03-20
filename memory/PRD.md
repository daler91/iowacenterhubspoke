# HubSpoke Scheduler - PRD

## Original Problem Statement
Build a web-based employee scheduling application that visually accounts for drive times and travel blocks using a Hub and Spoke travel model (Hub: 2210 Grand Ave, Des Moines, IA 50312).

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

## Test Results
- Backend: 100% (17/17 tests passed)
- Frontend: 95% (all core functionality working)

## Prioritized Backlog
### P0 (Done)
- All core features implemented

### P1 (Next)
- Drag-and-drop schedule rearrangement on calendar
- Employee filtering on calendar
- Conflict detection (prevent double-booking)

### P2 (Future)
- Email notifications for schedule changes
- Recurring class schedules
- Employee availability management
- Reporting dashboard with drive time analytics

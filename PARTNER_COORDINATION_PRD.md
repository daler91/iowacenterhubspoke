# Partner Coordination Module — PRD & Implementation Spec

> **Repository:** `github.com/daler91/iowacenterhubspoke`
> **Stack:** React 19 + TypeScript + Vite + Tailwind + Radix UI / FastAPI + Python 3.11 + Motor / MongoDB 7 + Redis 7
> **Context:** This module adds external partner coordination on top of the existing employee scheduling platform for the Iowa Center for Economic Success.

---

## Problem

The existing Hub & Spoke platform handles internal scheduling (employee assignments, drive times, calendar conflicts). But external coordination with partner organizations (chambers, co-working spaces, libraries, community colleges) who host classes at their locations is managed through scattered emails and manual follow-up. This module treats each class engagement as a structured project with partner-facing collaboration, task tracking, and repeatable playbooks.

---

## New MongoDB Collections

Add these collections alongside the existing ones (`schedules`, `locations`, `employees`, `classes`, `users`, etc.):

```
projects
├── _id
├── schedule_id          → references schedules._id (optional, can exist independently)
├── partner_org_id       → references partner_orgs._id
├── template_id          → references project_templates._id (null if created blank)
├── title                → string
├── event_format            → "workshop" | "series" | "office_hours" | "onboarding"
├── event_date           → datetime
├── phase                → "planning" | "promotion" | "delivery" | "follow_up" | "complete"
├── community            → string (e.g. "Carroll", "Fort Dodge")
├── venue_name           → string
├── registration_count   → int
├── attendance_count     → int (null until delivery)
├── warm_leads           → int (null until follow-up)
├── notes                → string
├── created_at
├── updated_at
└── created_by           → references users._id

project_templates
├── _id
├── name                 → string (e.g. "Single-Session Workshop")
├── event_format           → "workshop" | "series" | "office_hours" | "onboarding"
├── default_tasks[]
│   ├── title
│   ├── phase            → "planning" | "promotion" | "delivery" | "follow_up"
│   ├── owner            → "internal" | "partner" | "both"
│   ├── offset_days      → int (negative = days before event, positive = days after)
│   └── details          → string
└── collateral_kit[]     → list of default document references

tasks
├── _id
├── project_id           → references projects._id
├── title                → string
├── phase                → "planning" | "promotion" | "delivery" | "follow_up"
├── owner                → "internal" | "partner" | "both"
├── assigned_to          → string (name or contact_id)
├── due_date             → datetime
├── completed            → boolean
├── completed_at         → datetime | null
├── completed_by         → string
├── sort_order           → int (for drag reordering)
├── details              → string
└── created_at

partner_orgs
├── _id
├── name                 → string (e.g. "Hub 712", "Better Way Project")
├── community            → string
├── location_id          → references locations._id (existing collection)
├── venue_details
│   ├── capacity         → int
│   ├── av_setup         → string
│   ├── wifi             → boolean
│   ├── parking          → string
│   ├── accessibility    → string
│   └── signage          → string
├── co_branding          → string (guidelines/notes)
├── status               → "prospect" | "onboarding" | "active" | "inactive"
├── notes                → string
├── created_at
└── updated_at

partner_contacts
├── _id
├── partner_org_id       → references partner_orgs._id
├── name                 → string
├── email                → string
├── phone                → string
├── role                 → string (e.g. "venue manager", "marketing contact")
├── is_primary           → boolean
└── created_at

documents
├── _id
├── project_id           → references projects._id (null for org-level docs)
├── partner_org_id       → references partner_orgs._id (for org-level docs)
├── filename             → string
├── file_type            → string (pdf, pptx, docx, link, etc.)
├── file_path            → string (storage path or URL)
├── visibility           → "internal" | "shared"
├── uploaded_by          → string
├── uploaded_at          → datetime
└── version              → int

messages
├── _id
├── project_id           → references projects._id
├── channel              → string (project title or "general")
├── sender_type          → "internal" | "partner"
├── sender_name          → string
├── sender_id            → string (user_id or contact_id)
├── body                 → string
├── created_at
└── read_by[]            → list of reader IDs

portal_tokens
├── _id
├── contact_id           → references partner_contacts._id
├── token                → string (unique, URL-safe)
├── expires_at           → datetime
├── created_at
└── last_used_at
```

---

## New API Routers

Add these files to `backend/routers/` following the existing pattern (FastAPI router, Motor async, Pydantic schemas):

### `routers/projects.py` — `/api/v1/projects`

```
GET    /                         → list projects (filterable by community, phase, event_format, partner_org_id)
POST   /                         → create project (blank or from template_id)
GET    /{id}                     → get project with task counts per phase
PUT    /{id}                     → update project fields
DELETE /{id}                     → delete project and associated tasks
POST   /{id}/advance-phase       → move project to next phase
GET    /board                    → portfolio kanban view (projects grouped by phase with progress stats)
GET    /dashboard                → multi-community dashboard (metrics, community cards, partner health)
```

When creating from a template: clone `default_tasks[]` from `project_templates`, calculate `due_date` for each task using `event_date + offset_days`, create task documents in `tasks` collection.

### `routers/project_tasks.py` — `/api/v1/projects/{project_id}/tasks`

```
GET    /                         → list tasks for project (filterable by phase, owner, completed)
POST   /                         → create custom task
PUT    /{task_id}                → update task (title, phase, owner, due_date, details)
PATCH  /{task_id}/complete       → toggle completion (set completed, completed_at, completed_by)
PATCH  /reorder                  → bulk update sort_order for drag-and-drop
DELETE /{task_id}                → delete task
```

### `routers/partner_orgs.py` — `/api/v1/partner-orgs`

```
GET    /                         → list partner orgs (filterable by community, status)
POST   /                         → create partner org (link to existing location_id)
GET    /{id}                     → get partner org with contacts and project history
PUT    /{id}                     → update partner org
GET    /{id}/contacts            → list contacts for org
POST   /{id}/contacts            → add contact
PUT    /{id}/contacts/{cid}      → update contact
GET    /{id}/health              → partner health score (avg task completion rate, last active, classes hosted)
```

### `routers/partner_portal.py` — `/api/v1/portal`

This router uses magic link token auth, NOT the existing JWT auth. Middleware extracts token from URL param, validates against `portal_tokens`, and scopes all queries to that contact's `partner_org_id`.

```
POST   /auth/request-link        → send magic link email to partner contact
GET    /auth/verify/{token}      → validate token, return contact + org info, set session
GET    /dashboard                → partner overview (upcoming classes, open tasks, classes hosted)
GET    /projects                 → list projects visible to this partner org
GET    /projects/{id}/tasks      → partner's tasks only (owner = "partner" or "both")
PATCH  /projects/{id}/tasks/{tid}/complete → partner completes a task
GET    /projects/{id}/documents  → documents with visibility = "shared" only
POST   /projects/{id}/documents  → partner uploads a file
GET    /projects/{id}/messages   → messages for this project
POST   /projects/{id}/messages   → partner sends a message
GET    /org-documents            → org-level shared documents
```

### `routers/project_docs.py` — `/api/v1/projects/{project_id}/documents`

```
GET    /                         → list documents (filterable by visibility)
POST   /                         → upload document (multipart form, set visibility)
PATCH  /{doc_id}/visibility      → toggle internal/shared
DELETE /{doc_id}                 → delete document
GET    /{doc_id}/download        → serve file
```

### `routers/project_messages.py` — `/api/v1/projects/{project_id}/messages`

```
GET    /                         → list messages (filterable by channel, paginated)
POST   /                         → send message
GET    /channels                 → list available channels for this project
```

### Extend existing `routers/reports.py`

Add these endpoints to the existing reports router:

```
GET    /coordination/summary     → top-level metrics (classes delivered, attendance, leads, partner count)
GET    /coordination/by-community → per-community breakdown
GET    /coordination/partner-health → partner health table (completion rate, last active, classes hosted)
GET    /coordination/outcomes    → attendee-to-client conversion data
```

---

## Pydantic Schemas

Add to `backend/models/schemas.py` (or create `backend/models/coordination_schemas.py`):

```python
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, Literal
from bson import ObjectId

class ProjectCreate(BaseModel):
    title: str
    event_format: Literal["workshop", "series", "office_hours", "onboarding"]
    partner_org_id: str
    event_date: datetime
    community: str
    venue_name: str
    template_id: Optional[str] = None
    schedule_id: Optional[str] = None

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    event_date: Optional[datetime] = None
    phase: Optional[Literal["planning", "promotion", "delivery", "follow_up", "complete"]] = None
    registration_count: Optional[int] = None
    attendance_count: Optional[int] = None
    warm_leads: Optional[int] = None
    notes: Optional[str] = None

class TaskCreate(BaseModel):
    title: str
    phase: Literal["planning", "promotion", "delivery", "follow_up"]
    owner: Literal["internal", "partner", "both"]
    due_date: datetime
    details: Optional[str] = ""
    assigned_to: Optional[str] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    phase: Optional[str] = None
    owner: Optional[str] = None
    due_date: Optional[datetime] = None
    details: Optional[str] = None
    sort_order: Optional[int] = None

class PartnerOrgCreate(BaseModel):
    name: str
    community: str
    location_id: Optional[str] = None
    venue_details: Optional[dict] = {}
    co_branding: Optional[str] = ""
    status: Literal["prospect", "onboarding", "active", "inactive"] = "prospect"

class PartnerContactCreate(BaseModel):
    name: str
    email: str
    phone: Optional[str] = ""
    role: Optional[str] = ""
    is_primary: bool = False

class MessageCreate(BaseModel):
    channel: str
    body: str

class DocumentUpload(BaseModel):
    visibility: Literal["internal", "shared"] = "shared"
```

---

## Frontend Components

Add to `frontend/src/` following the existing patterns (TypeScript, Tailwind, Radix UI):

### New pages — add to router in `App.tsx`

```
/coordination                → CommunityDashboard.tsx (multi-community summary)
/coordination/board          → ProjectBoard.tsx (portfolio kanban)
/coordination/projects/:id   → ProjectDetail.tsx (class-level kanban)
/coordination/partners       → PartnerManager.tsx (partner org list + profiles)
/coordination/partners/:id   → PartnerProfile.tsx (single partner detail)
/portal/:token               → PortalDashboard.tsx (partner-facing, uses PortalLayout)
```

### `components/coordination/ProjectBoard.tsx`

Portfolio-level kanban board.

- 4 columns: Planning, Promotion, Delivery, Follow-Up
- Each column has a header with phase name, dot color indicator, and card count
- Cards are draggable between columns (use `@dnd-kit/core` or similar)
- Each card shows: title, date, venue + community, type badge (Workshop/Series/Office Hours), task progress bar (completed/total), alert indicator if partner tasks are overdue
- Top toolbar: community filter dropdown, class type filter dropdown, "+ New class" button
- Clicking a card navigates to `/coordination/projects/:id`
- Warning border (amber) on cards with overdue partner tasks

### `components/coordination/ProjectDetail.tsx`

Class-level kanban board — individual tasks as cards.

- Header: back link to board, class title, phase badge, date + venue + partner name
- 4 phase columns, same as portfolio board
- Task cards show: task title with checkbox, owner badge (You = blue, Partner = purple, Both = coral), due date (warning style if overdue)
- Completed tasks fade (opacity 0.45) with strikethrough but remain visible
- Cards are draggable between columns for reclassification
- "+ Add task" button creates custom task in any column
- Task card click opens inline edit (title, owner, due date, details)
- Legend at bottom showing owner badge meanings

### `components/coordination/PartnerManager.tsx`

- Searchable list of partner orgs with community, status badge, contact count
- Click through to PartnerProfile with: org details, venue details, contact list, project history, health score (avg task completion), last active date
- Add/edit partner org and contacts

### `pages/CommunityDashboard.tsx`

Multi-community summary dashboard.

- Top row: 5 metric cards (classes delivered, total attendance, warm leads, active partners, upcoming classes with alert count)
- Community cards row: one per city (Carroll, Fort Dodge, Marshalltown, Grinnell, Oskaloosa) showing delivered/upcoming counts, stacked phase bar, attendance + leads
- Upcoming classes table: sortable, columns = class name, community, date, phase badge, registrations, status/blocker text
- Partner health table: partner name, community, classes hosted, avg task completion rate (color coded), last active date
- Time range filter (last 90 days, this quarter, YTD) + export button

### `components/portal/PortalLayout.tsx`

Simplified app shell for partner-facing views. No sidebar navigation, no admin controls. Just:
- Header with partner org name, community, and logged-in contact avatar/name
- Tab bar: Overview, Your Tasks, Documents, Messages

### `components/portal/PortalDashboard.tsx`

Partner portal main view (rendered inside PortalLayout).

**Overview tab:**
- 3 metric cards: upcoming classes, open tasks (warning if overdue), classes hosted
- Class cards sorted by date, each with: class name, date/time, phase badge, partner's outstanding tasks as checkboxes (complete directly from here)
- Recent activity feed (timestamped actions from both sides)

**Your Tasks tab:**
- Flat list of all partner-assigned tasks across projects, grouped by class
- Checkboxes for completion, due dates with overdue highlighting

**Documents tab:**
- Files grouped by class with file type badges (PDF, PPTX, LINK)
- Download links, upload button per class section
- Persistent "Partnership documents" section for org-level collateral

**Messages tab:**
- Channel switcher (one per active class + "General")
- Chat-style message list with avatar initials, names, timestamps
- Text input + send button
- No account creation needed — all via magic link token in URL

---

## Integration Points with Existing Code

### Schedule linkage (`routers/schedule_crud.py`)
When a schedule entry is created, add optional UI to create a coordination project. Pass `schedule_id` to the project creation endpoint. The project inherits date, location, and employee from the schedule record.

### Location reuse (`routers/locations.py`)
Partner org `location_id` references the existing `locations` collection. Venue-specific details (capacity, AV) live on `partner_orgs.venue_details` as an extension, not a duplication.

### Drive time integration (`services/drive_time.py`)
The existing drive time service informs delivery phase tasks. When generating tasks from a template, calculate suggested arrival time using the employee's previous location and the existing Haversine/Google Distance Matrix logic. Set the "arrive for tech check" task time accordingly.

### Conflict awareness (`routers/schedule_conflicts.py`)
Extend conflict checking to flag when a coordinator has multiple class projects in promotion phase simultaneously, indicating potential bandwidth issues. Surface this in the dashboard.

### Auth extension (`core/auth.py`)
Add a `partner` role to the existing RBAC system. Partner auth uses magic link tokens (stored in `portal_tokens` collection) that are short-lived (7 days), email-delivered, and scope API access to the partner's org only. The portal router validates tokens via middleware, not the existing JWT cookie flow.

### Reports extension (`routers/reports.py`)
Add coordination-specific endpoints to the existing reports router. These query the new collections and return metrics for the dashboard.

---

## Default Playbook Templates (Seed Data)

Seed these into `project_templates` on first deploy. `offset_days` is relative to `event_date` (negative = before, positive = after).

### Template: Single-Session Workshop

```json
{
  "name": "Single-session workshop",
  "event_format": "workshop",
  "default_tasks": [
    {"title": "Confirm date and time with partner", "phase": "planning", "owner": "internal", "offset_days": -42, "details": "Check against partner calendar and local conflicts"},
    {"title": "Confirm room and AV details", "phase": "planning", "owner": "partner", "offset_days": -38, "details": "Capacity, AV setup, Wi-Fi, parking, signage"},
    {"title": "Finalize workshop content", "phase": "planning", "owner": "internal", "offset_days": -35, "details": "Slide deck, handouts, prompt cheat sheets"},
    {"title": "Draft flyer and promo materials", "phase": "planning", "owner": "internal", "offset_days": -32, "details": "Customizable per community with logos and venue"},
    {"title": "Partner approves flyer", "phase": "planning", "owner": "partner", "offset_days": -30, "details": "Review for accuracy and co-branding"},
    {"title": "Set up registration", "phase": "planning", "owner": "internal", "offset_days": -28, "details": "Google Form, Eventbrite, or platform-native"},
    {"title": "Identify local co-promoters", "phase": "planning", "owner": "both", "offset_days": -28, "details": "Other orgs, social media pages, newsletters"},

    {"title": "Share flyer to partner channels", "phase": "promotion", "owner": "partner", "offset_days": -28, "details": "Newsletter, social, lobby posting, website"},
    {"title": "Share flyer to Iowa Center channels", "phase": "promotion", "owner": "internal", "offset_days": -28, "details": "Email list, social, cross-posts"},
    {"title": "Send reminder to co-promoters", "phase": "promotion", "owner": "internal", "offset_days": -21, "details": "Chamber newsletter deadlines, local media"},
    {"title": "Registration check-in (midpoint)", "phase": "promotion", "owner": "internal", "offset_days": -14, "details": "Review numbers, decide if extra push needed"},
    {"title": "Final reminder blast", "phase": "promotion", "owner": "both", "offset_days": -5, "details": "3-5 days before event"},
    {"title": "Confirm headcount with partner", "phase": "promotion", "owner": "internal", "offset_days": -3, "details": "Room setup, materials count"},

    {"title": "Confirm room setup", "phase": "delivery", "owner": "partner", "offset_days": 0, "details": "Tables, chairs, projector, Wi-Fi credentials"},
    {"title": "Arrive for tech check", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": "30-45 minutes before start"},
    {"title": "Run sign-in and check-in", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": "Capture attendee info for follow-up"},
    {"title": "Deliver workshop", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": ""},
    {"title": "Distribute implementation kit", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": "Handouts, cheat sheets, resource links"},
    {"title": "Collect feedback survey", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": "Paper or QR code to digital survey"},

    {"title": "Send thank-you to partner", "phase": "follow_up", "owner": "internal", "offset_days": 1, "details": "Include attendance summary, photos"},
    {"title": "Send attendee follow-up email", "phase": "follow_up", "owner": "internal", "offset_days": 2, "details": "Survey link, resources, next steps"},
    {"title": "Log attendance and outcomes", "phase": "follow_up", "owner": "internal", "offset_days": 5, "details": "How many, who, warm leads for coaching/lending"},
    {"title": "Schedule partner debrief", "phase": "follow_up", "owner": "internal", "offset_days": 7, "details": "What worked, what to adjust, next session interest"},
    {"title": "Update partner org profile", "phase": "follow_up", "owner": "internal", "offset_days": 10, "details": "Notes on venue, relationship, future availability"}
  ]
}
```

### Template: New Partner Onboarding

```json
{
  "name": "New partner onboarding",
  "event_format": "onboarding",
  "default_tasks": [
    {"title": "Intro meeting or call", "phase": "planning", "owner": "internal", "offset_days": -42, "details": ""},
    {"title": "Identify partner goals and audience needs", "phase": "planning", "owner": "internal", "offset_days": -38, "details": ""},
    {"title": "Share org overview and service menu", "phase": "planning", "owner": "internal", "offset_days": -35, "details": ""},
    {"title": "Confirm mutual interest", "phase": "planning", "owner": "both", "offset_days": -30, "details": ""},
    {"title": "Identify primary and secondary contacts", "phase": "promotion", "owner": "partner", "offset_days": -28, "details": ""},
    {"title": "Collect venue details", "phase": "promotion", "owner": "partner", "offset_days": -25, "details": "Capacity, AV, schedule availability"},
    {"title": "Agree on co-branding guidelines", "phase": "promotion", "owner": "both", "offset_days": -21, "details": ""},
    {"title": "Agree on promotion responsibilities", "phase": "promotion", "owner": "both", "offset_days": -21, "details": ""},
    {"title": "Select first class to pilot", "phase": "promotion", "owner": "both", "offset_days": -18, "details": ""},
    {"title": "Set pilot date", "phase": "promotion", "owner": "both", "offset_days": -14, "details": ""},
    {"title": "Pilot evaluation", "phase": "follow_up", "owner": "both", "offset_days": 7, "details": "Does both sides want to continue? What cadence?"},
    {"title": "Move partner to active status", "phase": "follow_up", "owner": "internal", "offset_days": 10, "details": "Set up quarterly check-in schedule"}
  ]
}
```

### Template: Drop-In / Office Hours

```json
{
  "name": "Partner-hosted office hours",
  "event_format": "office_hours",
  "default_tasks": [
    {"title": "Confirm date with partner", "phase": "planning", "owner": "internal", "offset_days": -14, "details": ""},
    {"title": "Notify partner of visit", "phase": "promotion", "owner": "internal", "offset_days": -7, "details": ""},
    {"title": "Partner posts to their channels", "phase": "promotion", "owner": "partner", "offset_days": -5, "details": "Lobby sign, newsletter mention"},
    {"title": "Show up and set up", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": ""},
    {"title": "Log visitors and conversations", "phase": "follow_up", "owner": "internal", "offset_days": 1, "details": "Track foot traffic, warm leads, follow-up needed"}
  ]
}
```

---

## Phased Rollout

### Phase 1 — MVP
- Project creation from playbook templates and blank projects
- Task CRUD with internal/external assignment, kanban views (portfolio + class-level)
- Magic-link partner portal with overview, tasks, and documents tabs
- Document sharing with upload and visibility controls
- Partner org and contact profiles linked to existing locations
- Manual messaging interface

### Phase 2 — Automation & Reporting
- Automated email reminders based on task due dates
- Promotion tracking with co-marketing checklist
- Multi-community dashboard with metrics and partner health scoring
- Post-event outcome tracking (attendance → client conversion)
- CSV/Excel export for all data
- Webhook hooks for n8n/Zapier integration

### Phase 3 — Scale
- Portfolio-level analytics with trend lines and forecasting (extend existing analytics router)
- Playbook marketplace — share templates across orgs
- Email marketing integration for promotion phase
- Cohort tracking for multi-session series
- Partner NPS/satisfaction surveys in follow-up workflow

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time from class idea to confirmed and promoted | Reduce by 40% | Project creation to promotion phase start |
| Partner task completion without manual follow-up | >80% | Tasks completed before due date / total partner tasks |
| Classes delivered per quarter per community | 3+ | Project completion count |
| Attendee-to-client conversion | >15% | Warm leads / total attendance |
| Partner satisfaction | NPS >50 | Post-debrief survey |

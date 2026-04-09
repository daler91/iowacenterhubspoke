# Business Analyst Assessment: Processes & UI/UX
## Iowa Center Hub & Spoke Scheduling Platform

> **Date:** April 2026 | **Scope:** Process gaps + UI/UX friction | **Personas:** Schedulers, Coordinators, Partners

### Context

The Iowa Center for Economic Success operates a hub-and-spoke model for delivering educational classes across Iowa. Employees travel from the Des Moines hub to satellite cities (Carroll, Fort Dodge, Marshalltown, etc.) to deliver workshops, series, and office hours at partner venues. The platform has two main modules: (1) a scheduling system for employee class assignments with drive-time awareness, and (2) a partner coordination module for managing relationships with external host organizations.

This assessment identifies process gaps and UI/UX friction points that impact three user personas: **Schedulers** (internal staff managing the calendar), **Coordinators** (internal staff managing partner engagements), and **Partners** (external organizations hosting classes via the portal).

---

## Part 1: Process Gaps

### P1. Schedule-to-Project Disconnect (High Impact)

**Problem:** Schedules and coordination projects are loosely coupled. `schedule_id` on projects is optional (`frontend/src/components/coordination/ProjectCreateDialog.tsx`). A scheduler can create a calendar entry without a coordination project, and a coordinator can create a project without a matching schedule. Nothing enforces or even prompts alignment.

**Business Risk:** Classes get scheduled but partner coordination never happens (no venue confirmation, no promotion). Or partner projects exist with no calendar slot, leading to confusion about whether the class is actually booked.

**Recommendation:** When creating a schedule for a partner location, prompt the user: "Create a coordination project for this class?" Conversely, when creating a project, offer to auto-create the schedule entry. Add a visual indicator on calendar blocks that lack a coordination project and vice versa.

**Files:** `frontend/src/components/ScheduleForm.tsx`, `frontend/src/components/coordination/ProjectCreateDialog.tsx`, `backend/routers/schedule_create.py`, `backend/routers/projects.py`

---

### P2. Partner Status Transitions Are Ungated (Medium Impact)

**Problem:** Partner org status (`prospect` -> `onboarding` -> `active` -> `inactive`) is a manual dropdown toggle with no process gates (`frontend/src/components/coordination/PartnerProfile.tsx`). Nothing prevents moving a partner to "active" without completing onboarding tasks, having contacts on file, or confirming venue details.

**Business Risk:** Partners marked "active" without venue details or confirmed contacts, leading to failed class deliveries.

**Recommendation:** Gate status transitions: require at least 1 contact and venue details populated before allowing "active" status. Show a checklist on PartnerProfile of what's needed for each transition.

**Files:** `backend/routers/partner_orgs.py`, `frontend/src/components/coordination/PartnerProfile.tsx`

---

### P3. Conflict Override Has No Audit Trail (Medium Impact)

**Problem:** When a schedule conflict is detected, users can "force" the schedule through (`CalendarView.tsx:handleRelocate` with `force=true`). There's no requirement to provide a justification, and the override isn't distinctly captured in the activity log.

**Business Risk:** No way to review why conflicts were overridden. Patterns of risky scheduling can't be identified.

**Recommendation:** Add a `conflict_override_reason` field. When force-scheduling, require a brief justification. Log this as a distinct activity event type.

**Files:** `frontend/src/components/RelocateConflictDialog.tsx`, `backend/routers/schedule_crud.py`, `backend/services/activity.py`

---

### P4. Follow-Up Process Captures Aggregates, Not Individuals (Low Impact)

**Problem:** Event outcomes tracking uses single integer fields: `registration_count`, `attendance_count`, `warm_leads` (`backend/models/coordination_schemas.py`). These are just numbers -- there's no connection to actual attendee records.

**Business Risk:** Can't track individual attendee journeys from registration through class attendance to becoming a client. Can't measure which classes convert best at an individual level.

**Recommendation:** For Phase 3 scope, add an `attendees` collection linked to projects with basic contact info and conversion status. For now, this is acceptable for MVP.

---

### P5. No Recurring Project Concept (Low Impact)

**Problem:** Recurring schedules exist and generate series of calendar entries. But there's no equivalent for coordination projects. A monthly office hours series at the same partner requires creating a new project each month manually.

**Business Risk:** Coordination overhead scales linearly with recurring engagements instead of benefiting from templates.

**Recommendation:** When a recurring schedule is created linked to a partner, offer to auto-generate coordination projects for each occurrence using the same template.

---

## Part 2: UI/UX Issues

### U1. Two Kanban Boards With Overlapping Mental Models (High Impact)

**Problem:** The sidebar exposes "Status Board" (`/kanban`, `KanbanBoard.tsx`) for schedule status (Upcoming/In Progress/Completed) AND "Projects" (`/coordination/board`, `ProjectBoard.tsx`) for coordination phases (Planning/Promotion/Delivery/Follow-Up). Both use a kanban metaphor with drag-and-drop but represent fundamentally different things.

**User Impact:** Confusion about which board to use. Schedulers and coordinators may be the same person -- they need to see the relationship between "this class is confirmed on the calendar" and "partner promotion is underway for this class."

**Recommendation:** Either (a) merge the two boards into a unified view where schedule status and project phase are both visible on the same card, or (b) clearly differentiate them with distinct visual language and cross-link: clicking a project card shows its schedule status, and vice versa.

**Files:** `frontend/src/components/KanbanBoard.tsx`, `frontend/src/components/coordination/ProjectBoard.tsx`, `frontend/src/components/Sidebar.tsx`

---

### U2. Navigation Density and IA Overload (High Impact)

**Problem:** The sidebar has 4 sections with 12+ nav items (`Sidebar.tsx` lines 13-49). The "Coordination" section alone has 4 items. Combined with the Insights page consolidating 4 sub-views behind tabs, the information architecture tries to serve too many workflows in one navigation tree.

**User Impact:** New users face a steep learning curve. The relationship between Calendar, Status Board, Coordination Dashboard, and Coordination Projects isn't obvious from labels alone.

**Recommendation:**
- Rename "Status Board" to something that distinguishes it from the Projects board (e.g., "Schedule Pipeline" or just remove it if the calendar view with filters serves the same purpose)
- Consider collapsing Coordination into a single entry with sub-navigation inside the page (tabs or secondary nav)
- Add tooltips or brief descriptions to sidebar items on hover (not just icon + label)

**Files:** `frontend/src/components/Sidebar.tsx`

---

### U3. No Breadcrumbs in Deep Navigation (Medium Impact)

**Problem:** Deep routes like `/coordination/projects/:id` or `/employees/:id` have no breadcrumb trail. A breadcrumb UI component exists (`frontend/src/components/ui/breadcrumb.tsx`, `page-breadcrumb.tsx`) but isn't used in any page.

**User Impact:** Users navigating from Projects Board -> Project Detail -> back have to rely on browser back button. Context of where they are in the hierarchy is lost.

**Recommendation:** Add breadcrumbs to all detail pages: `Coordination > Projects > [Project Name]`, `Manage > Employees > [Employee Name]`, etc. The components already exist.

**Files:** `frontend/src/components/ui/breadcrumb.tsx`, `frontend/src/components/ui/page-breadcrumb.tsx`, `frontend/src/components/coordination/ProjectDetail.tsx`, `frontend/src/components/EmployeeProfile.tsx`, `frontend/src/components/LocationProfile.tsx`, `frontend/src/components/ClassProfile.tsx`

---

### U4. ScheduleForm is a Dense Single Dialog (Medium Impact)

**Problem:** `ScheduleForm.tsx` packs employee multi-select, class selection, location picker, date/time, recurrence options, travel chain preview, and conflict warnings into a single 520px-wide dialog. For multi-employee scheduling with custom recurrence, this overflows the modal and relies on scrolling.

**User Impact:** Form feels cramped. Users can miss critical information (conflicts, travel chain) if they don't scroll. The recurrence section adds significant vertical height.

**Recommendation:** Consider a stepped wizard approach for complex schedules: Step 1 (Who + What: employees + class), Step 2 (Where + When: location + time), Step 3 (Recurrence), Step 4 (Review conflicts + confirm). Simple single-event scheduling could skip steps or collapse them.

**Files:** `frontend/src/components/ScheduleForm.tsx`, `frontend/src/components/schedule-form/`

---

### U5. Coordination Module Has No Mobile Adaptation (Medium Impact)

**Problem:** `MobileCalendar.tsx` provides a swipeable mobile experience for the calendar. But the coordination module (`ProjectBoard.tsx`, `ProjectDetail.tsx`, `PartnerManager.tsx`, `CommunityDashboard.tsx`) has no mobile-specific views. Kanban columns with drag-and-drop are unusable on narrow screens.

**User Impact:** Coordinators and managers checking project status on mobile see a broken or cramped desktop layout. Partner portal (`PortalDashboard.tsx`) also has limited mobile optimization.

**Recommendation:** For coordination pages, add a mobile-optimized view: replace horizontal kanban columns with a stacked/accordion layout by phase. For the partner portal, ensure task lists and document views are touch-friendly with full-width cards.

**Files:** `frontend/src/components/coordination/ProjectBoard.tsx`, `frontend/src/components/coordination/ProjectDetail.tsx`, `frontend/src/components/portal/PortalDashboard.tsx`

---

### U6. No Onboarding or Empty-State Guidance (Medium Impact)

**Problem:** New users land on `/calendar` with either "No schedule data loaded" (amber warning, `CalendarView.tsx` line 198) or an empty calendar grid. There's no tour, no "getting started" flow, no contextual help.

**User Impact:** New schedulers don't know to first create locations, then employees, then classes, before they can create schedules. The dependency chain is invisible.

**Recommendation:** Add an empty-state component on the calendar that guides users: "Before scheduling, set up your [Locations], [Employees], and [Classes]." Each link navigates to the respective manager. Consider a first-login checklist in the sidebar.

**Files:** `frontend/src/components/CalendarView.tsx`, `frontend/src/pages/DashboardPage.tsx`

---

### U7. Partner Portal UX Friction Points (Medium Impact)

**Problem:** Multiple friction points in the partner portal:
1. **Magic link = no bookmarking**: Partners can't save the portal URL because tokens expire (7 days). They must request a new link each time.
2. **No task completion confirmation**: Clicking a task checkbox immediately marks it complete -- no undo, no "are you sure?" (`PortalDashboard.tsx`)
3. **No message threading**: Messages are a flat list with no ability to reply to specific items
4. **Sequential API loading**: Tasks for all projects are loaded one-by-one in a loop (`PortalDashboard.tsx` lines 61-69), causing slow load times for partners with multiple projects

**User Impact:** Partners find the portal unreliable (link expired), unforgiving (accidental task completion), and slow (serial API calls).

**Recommendation:**
1. After magic link verification, set a session cookie so the portal is bookmarkable for the session duration
2. Add a confirmation toast with "Undo" for task completion
3. Use `Promise.all` for parallel project data fetching
4. Threading can wait for Phase 3

**Files:** `frontend/src/components/portal/PortalDashboard.tsx`, `backend/routers/partner_portal.py`

---

### U8. Drive Time Blocks Lack Interactivity (Low Impact)

**Problem:** Drive time blocks on the calendar are rendered as gray dashed rectangles (`CalendarWeek.tsx`). They show duration but don't reveal which locations are being traveled between, the route, or the calculated distance. There's no click or hover behavior.

**User Impact:** Schedulers see drive time as dead space rather than actionable information. They can't verify if the drive time estimate is reasonable without leaving the calendar.

**Recommendation:** Add a hover tooltip showing: origin -> destination, estimated drive time, and distance. Clicking could open the route in Google Maps.

**Files:** `frontend/src/components/CalendarWeek.tsx`, `frontend/src/components/CalendarDay.tsx`

---

### U9. Notifications Lack Deep Links (Low Impact)

**Problem:** `NotificationsPanel.tsx` displays notification text but doesn't link to the relevant entity (schedule, project, partner). Users see "Schedule conflict detected" but must manually navigate to find it.

**Recommendation:** Add `entity_type` and `entity_id` to notifications and render them as clickable links that navigate to the relevant page.

**Files:** `frontend/src/components/NotificationsPanel.tsx`, `backend/routers/system.py`

---

## Part 3: Prioritized Recommendations

### Tier 1 -- High Impact, Moderate Effort (Do First)

| # | Recommendation | Impact | Effort | Personas |
|---|----------------|--------|--------|----------|
| 1 | **Schedule-Project linkage prompts** (P1) | High | Medium | Schedulers, Coordinators |
| 2 | **Differentiate/unify the two kanban boards** (U1) | High | Medium | All internal |
| 3 | **Add breadcrumbs using existing components** (U3) | Medium | Low | All internal |
| 4 | **Empty-state onboarding guidance** (U6) | Medium | Low | New users |
| 5 | **Fix portal sequential loading with Promise.all** (U7.3) | Medium | Low | Partners |

### Tier 2 -- High Impact, Higher Effort (Plan Next)

| # | Recommendation | Impact | Effort | Personas |
|---|----------------|--------|--------|----------|
| 6 | **Partner status transition gates** (P2) | Medium | Medium | Coordinators |
| 7 | **ScheduleForm wizard for complex cases** (U4) | Medium | Medium | Schedulers |
| 8 | **Mobile views for coordination module** (U5) | Medium | High | Coordinators, Managers |
| 9 | **Portal session cookies post magic-link** (U7.1) | Medium | Medium | Partners |

### Tier 3 -- Lower Priority (Backlog)

| # | Recommendation | Impact | Effort | Personas |
|---|----------------|--------|--------|----------|
| 10 | **Conflict override audit trail** (P3) | Medium | Low | Admins |
| 11 | **Sidebar IA refinement** (U2) | Medium | Low | All internal |
| 12 | **Drive time block tooltips** (U8) | Low | Low | Schedulers |
| 13 | **Notification deep links** (U9) | Low | Low | All internal |
| 14 | **Task completion undo in portal** (U7.2) | Low | Low | Partners |
| 15 | **Recurring project auto-generation** (P5) | Low | Medium | Coordinators |

---

## Verification

To validate these findings:
1. **Process gaps**: Review with actual schedulers and coordinators to confirm which manual steps cause the most pain
2. **UI/UX issues**: Conduct task-based usability testing with each persona (scheduler creates a class with partner coordination end-to-end, partner completes portal tasks on mobile)
3. **Prioritization**: Align with product owner on Tier 1 items for next sprint; Tier 2 for quarter planning
4. **Technical**: Run the app locally (`docker-compose up`) and walk through the full schedule-to-delivery flow to see the disconnects firsthand

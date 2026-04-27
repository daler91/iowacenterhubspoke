# UX & Accessibility Review — Iowa Center Hub & Spoke

## Context

This is a senior UX/accessibility audit of the Iowa Center Hub & Spoke scheduling platform frontend (React 19 + TypeScript + Tailwind + Radix UI, located at `/home/user/iowacenterhubspoke/frontend/src`). The app is an internal scheduling tool with calendar/kanban/map views, CRUD managers for employees/classes/locations/users, bulk operations, CSV import/export, and analytics dashboards.

Scope: usability, user flow, loading/error/empty states, responsive design, keyboard & screen-reader accessibility, and WCAG 2.1 AA compliance. Findings are written as an audit report — no code changes are proposed beyond recommended fixes per item.

## Severity Summary

| Severity | Count | Theme |
|---|---|---|
| CRITICAL | 8 | Keyboard/SR inaccessible interactive elements, silent error swallowing, missing destructive-action confirmations |
| WARNING | 18 | Contrast, touch targets, empty/loading gaps, missing aria-live, dialog mobile widths |
| SUGGESTION | 14 | Typography, reduced-motion, form polish, copy, consistency |

---

## CRITICAL Findings

### [CRITICAL] — Map markers are clickable `<div>`s, not buttons
**User Impact:** Keyboard and screen-reader users cannot interact with any spoke or hub marker on the map — they are invisible in the tab order and not announced as interactive.
**Location:** `frontend/src/components/MapView.tsx:22` (SpokeMarker), `frontend/src/components/MapView.tsx:121` (Hub marker)
**Current Behavior:** `<div className="relative group cursor-pointer" onClick={...}>` is used for the click target. No `role`, no `tabIndex`, no keyboard handler, no focus ring. The hover tooltip (lines 31–50) is also hover-only and cannot be revealed by keyboard.
**Recommended Fix:** Replace the outer `<div>` with a `<button type="button">` (or render the tooltip inside an `AdvancedMarker` with proper click handling via the maps library's built-in accessibility wrappers). Add `aria-label={`${loc.city_name}, ${locSchedules.length} classes today`}`. Make the tooltip `focus-within` reveal as well as `group-hover`.
**WCAG Reference:** 2.1.1 Keyboard (A), 4.1.2 Name, Role, Value (A)

### [CRITICAL] — No global error boundary wraps lazy-loaded shell components
**User Impact:** A runtime failure inside `ScheduleForm`, `NotificationsPanel`, or `StatModal` (all mounted outside the route outlet) collapses the whole app to a generic "Something went wrong" screen, even though the route-level boundary exists.
**Location:** `frontend/src/App.tsx:150-159`, `frontend/src/components/ErrorBoundary.tsx`
**Current Behavior:** `RouteBoundary` wraps the outlet so route errors clear on navigation, but cross-route shell components escape to the top-level boundary and take the whole UI down.
**Recommended Fix:** Wrap each shell-level lazy component in its own small `<ErrorBoundary fallback={<ToastError />}>` so a crashed notifications panel (for example) closes itself and surfaces a toast rather than unmounting the dashboard.
**WCAG Reference:** n/a (resilience/UX)

### [CRITICAL] — Silent error swallowing in notifications and conflict preview
**User Impact:** Users can see stale notifications or schedule over real conflicts without any indication that the background fetch failed.
**Location:** `frontend/src/components/NotificationsPanel.tsx:142-145`; `frontend/src/components/ScheduleForm.tsx:151-152`
**Current Behavior:** `catch` blocks swallow network/server errors. No toast, no icon state change, no re-try affordance. The bell continues to render old data; the schedule form continues to show "no conflicts."
**Recommended Fix:** Track a `fetchError` state, render a subtle warning inline ("Couldn't check conflicts — retry") with a retry button, and mark the bell with a small error badge when inbox fetches fail.
**WCAG Reference:** 3.3.1 Error Identification (A)

### [CRITICAL] — Destructive delete actions lack visible confirmation content
**User Impact:** If the `AlertDialog` body is empty or generic, users can accidentally delete an employee with active schedules, a location in use, or an admin user.
**Location:** `frontend/src/components/EmployeeManager.tsx:194-200`, `LocationManager.tsx`, `ClassManager.tsx`, `UserManager.tsx:194-200`, `BulkActionBar.tsx:34-46`
**Current Behavior:** Delete handlers reference a confirm dialog but the dialog content (title/description) is either absent or not specific (no mention of the item name, dependencies, or cascade effects).
**Recommended Fix:** Standardize a `<ConfirmDeleteDialog name={x.name} dependencies={[...]} />` that names the item, lists affected related entities ("Alice has 5 upcoming classes"), and uses a red destructive button. Add a typed confirmation ("type DELETE") for admin-account removal.
**WCAG Reference:** 3.3.4 Error Prevention (AA)

### [CRITICAL] — No `aria-live` region for toast notifications and activity feed
**User Impact:** Screen-reader users receive no audible feedback when a schedule is saved, an error occurs, or a new activity appears.
**Location:** `frontend/src/components/ActivityFeed.tsx:99`; `sonner` toaster mount point in `App.tsx`
**Current Behavior:** Toasts render but are not wrapped in an `aria-live="polite"` region; the activity feed list has no `aria-live` on its scroll container.
**Recommended Fix:** Add `aria-live="polite" aria-atomic="false"` to the toast container and the activity list wrapper. Use `aria-live="assertive"` only for critical errors.
**WCAG Reference:** 4.1.3 Status Messages (AA)

### [CRITICAL] — Calendar view gives no feedback when filters yield no results
**User Impact:** A user who filters by an employee who has no schedules sees an empty grid and cannot tell whether data failed to load, the filter excluded everything, or there are genuinely no schedules.
**Location:** `frontend/src/components/CalendarView.tsx` (no empty-state branch near line 250+)
**Current Behavior:** Week/month/day grids render their empty cells silently. The fetch-error path from `useDashboardData` is not surfaced here either (line 50 pulls context but does not read `fetchErrors`).
**Recommended Fix:** Add a centered empty-state ("No schedules match your filters — clear filters") when filtered results are zero, distinct from a load-failure banner ("Couldn't load schedules — retry") when `fetchErrors.schedules` is set.
**WCAG Reference:** 3.3.1 Error Identification (A)

### [CRITICAL] — Drive-time auto-overwrite discards user input without confirmation
**User Impact:** A user editing a location can lose a manually corrected drive-time value the instant they change the address — the API-calculated value silently overwrites theirs.
**Location:** `frontend/src/components/LocationManager.tsx:125-150`
**Current Behavior:** The place-select handler auto-fills city, lat/lng, and drive-time without checking whether the field was manually edited since the last auto-fill.
**Recommended Fix:** Track a `driveTimeTouched` flag; when `true`, prompt "Replace your drive-time value with the calculated 42 min?" before overwriting, or simply preserve the manual entry and show an "Auto-calculate" button next to it.
**WCAG Reference:** 3.3.4 Error Prevention (AA)

### [CRITICAL] — Calendar time-slot blocks are clickable but have no focus state
**User Impact:** Keyboard users can Tab into schedule blocks but have no visible indicator showing which one they are on — they cannot navigate the schedule reliably.
**Location:** `frontend/src/App.css:21-37` (`.schedule-block`), `CalendarWeek.tsx:57+`
**Current Behavior:** `.schedule-block { cursor: pointer; }` with hover transforms but no `:focus-visible` style. Individual slots in `CalendarWeek` are not focusable (tabIndex is on the section, not the slot).
**Recommended Fix:** Add `&:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }` and make each schedule block a real `<button>` with `tabIndex={0}` and Enter/Space handlers.
**WCAG Reference:** 2.4.7 Focus Visible (AA), 2.1.1 Keyboard (A)

---

## WARNING Findings

### [WARNING] — Muted-foreground and slate-500 text fails AA contrast
**User Impact:** Low-vision users and anyone in bright environments struggle to read secondary labels, metadata, and dates throughout the app.
**Location:** `frontend/src/index.css:20` (`--muted-foreground: 215 15% 45%`); widespread `text-slate-500` usage, e.g. `MapView.tsx:103`, `Sidebar.tsx:74,121`
**Current Behavior:** `#64748b` (slate-500) on white is ~3.5:1; HSL 215/15/45 is borderline ~4.5:1. Fails when rendered on off-white cards.
**Recommended Fix:** Raise `--muted-foreground` to at least `215 20% 35%` (≈ `#475569` / slate-600) and replace `text-slate-500` with `text-slate-600` for body text; keep slate-500 only for ≥18pt text.
**WCAG Reference:** 1.4.3 Contrast (AA) — 4.5:1 for normal text, 3:1 for large

### [WARNING] — Icon-only buttons fall below 44×44 px touch target on mobile
**User Impact:** Tapping the edit/delete/view icons in the manager tables is error-prone on phones — adjacent buttons get hit instead.
**Location:** `frontend/src/components/ui/button.tsx:28-31` (`sm: h-8`); `ClassManager.tsx:65-97`, `LocationManager.tsx:69-102`, `EmployeeManager.tsx:90-98`, `UserManager.tsx:77-78`
**Current Behavior:** `size="sm"` gives 32 px height; spacing between icon buttons is `gap-1` (4 px).
**Recommended Fix:** Add a dedicated `size="icon-mobile"` variant that renders `h-11 w-11` on `<md` and keeps `h-8` on desktop, or simply use `h-10` everywhere with `p-2`. Bump gap to `gap-2`.
**WCAG Reference:** 2.5.5 Target Size (AAA, recommended for AA in practice)

### [WARNING] — Dialog components have no `max-w` cap below `sm` breakpoint
**User Impact:** On small phones (<640 px), dialogs render full-bleed with no margin, making them feel like entire screens and causing text to crash into the viewport edges.
**Location:** `StatModal.tsx:36`, `ScheduleForm.tsx:173`, `CustomRecurrenceDialog.tsx:100`, `ImportCsvDialog.tsx:167`, `ExportCsvDialog.tsx`, `RelocateConflictDialog.tsx`
**Current Behavior:** Only `sm:max-w-[520px]`, etc. No constraint on mobile — dialogs inherit `100vw`.
**Recommended Fix:** Add `max-w-[calc(100vw-2rem)] mx-4` to the base class of `DialogContent` so small-screen dialogs retain 1 rem margin.
**WCAG Reference:** 1.4.10 Reflow (AA)

### [WARNING] — NotificationsPanel dropdown is wider than mobile viewport
**User Impact:** On phones under 380 px wide (common), the panel overflows the viewport and clips unread items.
**Location:** `frontend/src/components/NotificationsPanel.tsx:285`
**Current Behavior:** Fixed `w-[380px]` with no responsive variant.
**Recommended Fix:** `w-[min(380px,calc(100vw-1rem))]` or convert to a full-screen sheet on `<sm` using a Radix Sheet/Drawer.
**WCAG Reference:** 1.4.10 Reflow (AA)

### [WARNING] — WeeklyReport table forces horizontal scroll on phones
**User Impact:** Mobile users must scroll sideways through the weekly report table, making columns hard to compare.
**Location:** `frontend/src/components/WeeklyReport.tsx:205,214`
**Current Behavior:** Grid table is `min-w-[600px]` inside an `overflow-x-auto` wrapper.
**Recommended Fix:** Below `md`, stack rows as cards with the column name as the row label. Keep the grid only from `md` up.
**WCAG Reference:** 1.4.10 Reflow (AA)

### [WARNING] — Empty notifications panel shows blank dropdown
**User Impact:** Users can't tell if the fetch failed or if there are simply no notifications — a blank dropdown feels broken.
**Location:** `frontend/src/components/NotificationsPanel.tsx:170-240`
**Current Behavior:** When both lists are empty, the panel body renders nothing.
**Recommended Fix:** Render a friendly empty state (`<BellOff />` + "You're all caught up."). Differentiate from error state with a retry button.
**WCAG Reference:** n/a (UX)

### [WARNING] — Manager lists show no skeleton while loading
**User Impact:** Pages flash empty before data populates, giving the impression the list is empty and causing users to click "Add" unnecessarily.
**Location:** `EmployeeManager.tsx`, `ClassManager.tsx`, `LocationManager.tsx`, `UserManager.tsx`, `KanbanBoard.tsx:205-421`
**Current Behavior:** Empty-state copy only shows when list is literally `[]`; during load the list is `undefined` and nothing renders.
**Recommended Fix:** Render 3–5 skeleton rows while data is `undefined`; switch to the empty-state component only once the query resolves with zero items.
**WCAG Reference:** n/a (perceived performance/UX)

### [WARNING] — PDF export stalls with no loading feedback
**User Impact:** First-time export pauses the UI while ~350 KB of html2canvas + jspdf load; users repeatedly click thinking the button is broken.
**Location:** `frontend/src/components/CalendarView.tsx:126-137`
**Current Behavior:** Chunks are pre-warmed in an idle callback, but the click handler has no pending state.
**Recommended Fix:** Set `exporting` state on click, disable the button, show "Preparing PDF…" with a spinner, restore on resolve/reject.
**WCAG Reference:** n/a (feedback)

### [WARNING] — Drive-time calculation failure does not block save
**User Impact:** Location form silently falls back to a 15-minute default, and users save a location with the wrong drive time without knowing the API call failed.
**Location:** `frontend/src/components/LocationManager.tsx:141-146`
**Current Behavior:** Warning toast fires but Save remains enabled; no inline field-level error.
**Recommended Fix:** Show an inline `aria-describedby` error on the drive-time field, disable Save until the user acknowledges or manually enters a value.
**WCAG Reference:** 3.3.1 Error Identification (A)

### [WARNING] — Generic error copy hides actionable backend details
**User Impact:** When the API returns a specific conflict (e.g. "Employee still assigned to 3 schedules"), `describeApiError()` may mask it with "Something broke on our end — please try again," leaving users unable to resolve the real problem.
**Location:** `frontend/src/lib/error-messages.ts`; `EmployeeManager.tsx:187-189`
**Current Behavior:** All 5xx and many 4xx responses are mapped to a single friendly string.
**Recommended Fix:** Preserve the backend `detail` string when it is user-safe (validated by a whitelist of error codes from `backend/routers/*`). Keep the friendly fallback only for truly opaque 500s.
**WCAG Reference:** 3.3.3 Error Suggestion (AA)

### [WARNING] — Form validation on step advance uses a toast, not a field highlight
**User Impact:** Users see a toast ("Select at least one employee") that disappears after a few seconds and leaves no visual trail showing which step/field needs attention.
**Location:** `frontend/src/components/ScheduleForm.tsx:74-124,100-112`
**Current Behavior:** Toast plus a `setTimeout` focus attempt; if the focus fails (DOM not ready), nothing indicates the offending field.
**Recommended Fix:** Disable the "Next" button while the step is invalid and render inline field errors with `aria-invalid` + `aria-describedby`. Keep the toast only as an assistive announcement.
**WCAG Reference:** 3.3.1 Error Identification (A), 3.3.3 Error Suggestion (AA)

### [WARNING] — ScheduleForm loses in-progress input on accidental close
**User Impact:** A user filling out step 2 of the wizard who accidentally clicks outside the dialog loses all entered data when they reopen it.
**Location:** `frontend/src/components/ScheduleForm.tsx:142`
**Current Behavior:** Form resets whenever `open` changes.
**Recommended Fix:** Either (a) warn before discarding non-empty state, or (b) persist a draft in component state / `sessionStorage` and restore on re-open.
**WCAG Reference:** 3.3.4 Error Prevention (AA)

### [WARNING] — Required fields are not marked `aria-required` or visually indicated
**User Impact:** Screen-reader users don't know which fields are required before submitting; sighted users guess.
**Location:** `frontend/src/components/schedule-form/LocationTimeSelectors.tsx:48,89,91,102-108`; `EmployeeClassSelectors.tsx:27`
**Current Behavior:** HTML `required` is used on some inputs but no `aria-required`, and labels lack an asterisk or "(required)" marker.
**Recommended Fix:** Add `aria-required="true"` on required fields and a visible `*` on their labels, plus a legend noting that `*` indicates required.
**WCAG Reference:** 3.3.2 Labels or Instructions (A)

### [WARNING] — `prefers-reduced-motion` ignored across custom animations
**User Impact:** Users with vestibular sensitivities see forced slide/fade/zoom animations on dialogs, the activity feed, the notifications panel, and the Kanban board.
**Location:** `frontend/src/App.css:115-122` (`@keyframes slideIn`), usage in `CalendarView.tsx:252`, `NotificationsPanel.tsx:285`, `KanbanBoard.tsx:108`; `tailwind.config.js:118-121`
**Current Behavior:** Animations run unconditionally.
**Recommended Fix:** Wrap custom keyframes in `@media (prefers-reduced-motion: no-preference)` and add a global `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }` rule.
**WCAG Reference:** 2.3.3 Animation from Interactions (AAA, but common AA practice)

### [WARNING] — Bulk-partial-failure in UserManager hides broken sub-fetches
**User Impact:** When one of sessions/lockouts/invitations times out, users see blank sections without knowing a fetch failed — they may assume there are no locked accounts when in fact the data never loaded.
**Location:** `frontend/src/components/UserManager.tsx:141-175`
**Current Behavior:** `Promise.all` catches failures silently per fetch.
**Recommended Fix:** Use `Promise.allSettled`, track per-section errors, and render an inline "Could not load lockouts — retry" strip within the affected card.
**WCAG Reference:** 3.3.1 Error Identification (A)

### [WARNING] — Icon-only sidebar toggle and logo lack navigable semantics
**User Impact:** Keyboard users see an "expand/collapse" arrow whose purpose is only communicated through `title`; the logo is a `<div>` and not a link back to the dashboard.
**Location:** `frontend/src/components/Sidebar.tsx:204-213,266-278`
**Current Behavior:** Logo is non-interactive; toggle button uses `title` and a conditional `aria-label`.
**Recommended Fix:** Make the logo a `<Link to="/">` with visible `aria-label="Go to dashboard"`. Ensure the toggle consistently has `aria-label` and `aria-expanded`.
**WCAG Reference:** 4.1.2 Name, Role, Value (A)

### [WARNING] — InsightsPage tab re-render flashes skeleton on revisit
**User Impact:** Switching back to the Workload/Analytics tabs after first visit shows a chart rebuild flash, making the UI feel unstable.
**Location:** `frontend/src/components/InsightsPage.tsx:27-86`
**Current Behavior:** Radix `TabsContent` unmounts inactive tabs, forcing full re-render.
**Recommended Fix:** Pass `forceMount` to `TabsContent` and use `hidden` / `data-state` CSS to toggle visibility while preserving component state.
**WCAG Reference:** n/a (UX polish)

### [WARNING] — Decorative color swatches in Kanban lack `aria-hidden`
**User Impact:** Screen readers announce every class-color dot as a meaningless element, cluttering the board's reading order.
**Location:** `frontend/src/components/KanbanBoard.tsx:371`
**Current Behavior:** `<div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: ...}} />` with no `aria-hidden`.
**Recommended Fix:** Add `aria-hidden="true"`; the class name is already textual beside it.
**WCAG Reference:** 1.1.1 Non-text Content (A)

---

## SUGGESTION Findings

### [SUGGESTION] — Calendar month-cell `min-h-[100px]` is cramped on mobile
**User Impact:** On portrait phones, a 7×5 grid of 100 px cells pushes the entire month below the fold; swipe/scroll is necessary to even see week 3.
**Location:** `frontend/src/components/CalendarMonth.tsx:19`
**Recommended Fix:** `min-h-[72px] sm:min-h-[100px]` and drop `text-[10px]` pills in favour of a single-dot-per-day indicator with a count below `sm`.

### [SUGGESTION] — Map marker tooltip `min-w-[220px]` overflows small phones
**User Impact:** The hover popover is cut off on the right edge on phones below ~360 px.
**Location:** `frontend/src/components/MapView.tsx:32,126`
**Recommended Fix:** `min-w-0 w-[min(220px,calc(100vw-2rem))]` and place the popover using Radix `Popover` for collision detection.

### [SUGGESTION] — KanbanBoard badge truncation has no tooltip
**User Impact:** Long employee names truncate to ellipsis inside a `max-w-[180px]` badge with no way to see the full name without clicking into the card.
**Location:** `frontend/src/components/KanbanBoard.tsx:125`
**Recommended Fix:** Wrap the label in a Radix `Tooltip` that shows the full name on hover and focus.

### [SUGGESTION] — Typography is fixed across breakpoints
**User Impact:** Body text feels small on large monitors and `text-[10px]` pills are too small on phones.
**Location:** Throughout; `CalendarMonth.tsx`, `StatModal.tsx`, `KanbanBoard.tsx`
**Recommended Fix:** Establish a responsive type scale (e.g. `text-sm md:text-base` for body, minimum `text-xs` for pills) and replace hard-coded `text-[10px]` with tokens.

### [SUGGESTION] — Sidebar relies on `title` for collapsed-state tooltips
**User Impact:** `title` tooltips only appear on mouse hover, not on keyboard focus — keyboard users navigating the collapsed sidebar get no name cue.
**Location:** `frontend/src/components/Sidebar.tsx:60-81`
**Recommended Fix:** Use Radix `Tooltip` (keyboard-accessible) keyed to `collapsed` state.

### [SUGGESTION] — Focus ring colour is indigo-on-indigo in primary-button state
**User Impact:** The ring is hard to see when focus lands on a primary-colored element because `--ring` maps to `--primary`.
**Location:** `frontend/src/index.css:27,38`; `frontend/src/components/ui/button.tsx:12`
**Recommended Fix:** Set `--ring` to a high-contrast complementary hue (e.g. amber or white on primary buttons) or use `ring-offset-2` with the page background for separation.

### [SUGGESTION] — Empty Kanban board lacks an onboarding CTA
**User Impact:** First-time users arrive at three empty columns with no "Create your first schedule" prompt.
**Location:** `frontend/src/components/KanbanBoard.tsx:392-399`
**Recommended Fix:** When all three columns are empty, render a centered card with an illustration and "Create your first schedule" button that opens `ScheduleForm`.

### [SUGGESTION] — ConsentBanner position can cover BulkActionBar on small viewports
**User Impact:** On mobile, both fixed bars stack at the bottom; the consent banner can hide bulk actions until dismissed.
**Location:** `ConsentBanner.tsx:33`, `BulkActionBar.tsx:110`
**Recommended Fix:** Stack them with deterministic `z-index` and `bottom` offsets, or hide the bulk-action bar while consent is unresolved.

### [SUGGESTION] — AttachmentPreviewDialog uses filename as alt text
**User Impact:** Screen-reader users hear "screenshot-2025-04-03-14-22-01.png" instead of a meaningful description.
**Location:** `frontend/src/components/coordination/AttachmentPreviewDialog.tsx`
**Recommended Fix:** Accept and render an author-provided caption; fall back to "Attachment: {filename}" only when no caption is available.
**WCAG Reference:** 1.1.1 Non-text Content (A)

### [SUGGESTION] — Global skip-to-content link is missing
**User Impact:** Keyboard users must tab through the entire sidebar on every page load before reaching main content.
**Location:** `frontend/src/App.tsx`, `frontend/src/pages/DashboardPage.tsx`
**Recommended Fix:** Add a visually-hidden-until-focus `<a href="#main-content">Skip to content</a>` as the first focusable element, and `id="main-content"` on the main outlet.
**WCAG Reference:** 2.4.1 Bypass Blocks (A)

### [SUGGESTION] — No language attribute set on `<html>`
**User Impact:** Screen readers may use the wrong pronunciation dictionary.
**Location:** `frontend/index.html`
**Recommended Fix:** Add `lang="en"` to the `<html>` element.
**WCAG Reference:** 3.1.1 Language of Page (A)

### [SUGGESTION] — StatModal scroll region lacks a focusable indicator
**User Impact:** Users may not realize the modal body scrolls when content overflows.
**Location:** `frontend/src/components/StatModal.tsx:48`
**Recommended Fix:** Add `tabIndex={0}` and `role="region"` with an `aria-label` to the scroll container, plus a subtle fade-out gradient at the bottom to hint at more content.

### [SUGGESTION] — Hamburger button is 40 px, one pixel short of recommended minimum
**User Impact:** Marginally smaller than Apple HIG's 44 px minimum; fine on most thumbs but a trivial win to fix.
**Location:** `frontend/src/pages/DashboardPage.tsx:180`
**Recommended Fix:** `w-11 h-11` (44 px).

### [SUGGESTION] — No keyboard shortcut discovery
**User Impact:** Power users (schedulers) would benefit from shortcuts (e.g. `n` for new schedule, `/` for search) but none are documented.
**Location:** Global
**Recommended Fix:** Add a `?`-triggered shortcut cheatsheet modal listing common actions, and implement the shortcuts via a small `useHotkey` hook.

---

## Recommended Remediation Order

1. **Safety first (CRITICAL):** destructive-confirmation content, drive-time overwrite guard, map-marker keyboard access, calendar-slot focus + keyboard, silent error swallowing.
2. **Perception & orientation (CRITICAL + WARNING):** aria-live for toasts/activity, skeletons in managers + kanban, empty-state for filtered calendar, notifications empty/error states, skip-to-content link, `<html lang>`.
3. **Contrast & target size (WARNING):** raise `--muted-foreground`, replace `text-slate-500`, bump icon-button sm to 40–44 px, add reduced-motion global rule.
4. **Responsive polish (WARNING + SUGGESTION):** dialog mobile `max-w`, notifications dropdown width, WeeklyReport table → cards below `md`, calendar cell min-height.
5. **Form UX (WARNING):** inline validation + `aria-required`, preserve draft on accidental close, clearer API error passthrough.
6. **Nice-to-have (SUGGESTION):** keyboard shortcut cheatsheet, tooltips replacing `title`, onboarding CTA on empty Kanban.

## Verification

To verify any subset of these fixes end-to-end:

- **Automated accessibility:** the repo already ships `@axe-core/playwright` (see `frontend/package.json` devDependencies) and a `test:e2e` Playwright script. Add a Playwright spec that imports `AxeBuilder` from `@axe-core/playwright` and runs `await new AxeBuilder({ page }).analyze()` on each main route (`/login`, `/`, `/calendar`, `/kanban`, `/map`, `/employees`, `/classes`, `/locations`, `/users`, `/reports`, `/insights`). Execute via `cd frontend && npm run test:e2e`. Fail the build on any "serious" or "critical" violations. For a quick one-off scan against a running dev server, use `npx @axe-core/cli http://localhost:5173/<route>` (installs the `axe` binary from `@axe-core/cli`).
- **Keyboard pass:** Tab through each route with no mouse. Verify focus is always visible, reachable for every interactive element, and that `Esc` closes every dialog/popover.
- **Screen-reader pass:** VoiceOver (macOS) or NVDA (Windows) smoke test: create a schedule, delete it, receive a notification. Confirm each action announces.
- **Responsive pass:** test at 360×640 (small phone), 768×1024 (tablet), 1440×900 (laptop). Confirm no horizontal scrolling on phone, dialogs have margin, sidebar becomes a drawer.
- **Contrast:** run the Lighthouse "Accessibility" audit and the axe-core contrast checker; confirm all text ≥ 4.5:1 (≥ 3:1 for ≥18pt).
- **Reduced motion:** toggle OS setting on and reload; confirm animations are suppressed.
- **Manual flows:** (1) filter calendar to an employee with no schedules → see empty-state; (2) disconnect network, open notifications → see retry banner; (3) open ScheduleForm wizard, fill step 1, close and reopen → see preserved draft; (4) change a location's address → see confirmation before drive-time overwrite.

## Critical Files Referenced

- `frontend/src/App.tsx` — error boundary, skip link, `<html lang>`
- `frontend/src/App.css`, `frontend/src/index.css`, `frontend/tailwind.config.js` — contrast, focus ring, reduced motion
- `frontend/src/components/ui/button.tsx`, `ui/dialog.tsx` — size variants, mobile max-w
- `frontend/src/components/MapView.tsx` — marker keyboard access
- `frontend/src/components/CalendarView.tsx`, `CalendarWeek.tsx`, `CalendarMonth.tsx`, `MobileCalendar.tsx` — empty states, focus indicators, cell sizing
- `frontend/src/components/ScheduleForm.tsx`, `schedule-form/*` — required/ARIA, draft preservation
- `frontend/src/components/NotificationsPanel.tsx` — empty/error states, mobile width, aria-live
- `frontend/src/components/ActivityFeed.tsx` — aria-live
- `frontend/src/components/EmployeeManager.tsx`, `ClassManager.tsx`, `LocationManager.tsx`, `UserManager.tsx`, `BulkActionBar.tsx` — confirmation dialogs, skeletons
- `frontend/src/components/WeeklyReport.tsx` — responsive table
- `frontend/src/components/Sidebar.tsx` — logo link, tooltips
- `frontend/src/lib/error-messages.ts` — API error passthrough
- `frontend/index.html` — `lang` attribute






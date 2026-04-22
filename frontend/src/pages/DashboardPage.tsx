import { useState, useEffect, Suspense, useMemo, useCallback, lazy } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useDashboardData, type ScheduleWindow } from '../hooks/useDashboardData';
import { useScheduleModal } from '../hooks/useScheduleModal';
import { useStatModal } from '../hooks/useStatModal';
import { cn } from '../lib/utils';
import Sidebar from '../components/Sidebar';
import ErrorBoundary from '../components/ErrorBoundary';
import { format, addDays, subDays } from 'date-fns';

// A crash inside one of the lazy shell panels (ScheduleForm,
// NotificationsPanel, StatModal) should NOT take the dashboard down —
// each panel is wrapped in its own tiny boundary that renders null on
// error. The route-level RouteBoundary still handles main-outlet errors.
const shellFallback = () => null;

// ±60-day window used by the Calendar route's initial schedule fetch.
// Matches the `_WORKLOAD_DEFAULT_LOOKBACK_DAYS` convention in
// `backend/routers/reports.py` and covers the vast majority of calendar
// navigations without a follow-up refetch. Calendar nav beyond this
// range calls `setScheduleWindow` to widen dynamically.
const CALENDAR_DEFAULT_WINDOW_DAYS = 60;

function defaultCalendarWindow(): ScheduleWindow {
  const today = new Date();
  return {
    dateFrom: format(subDays(today, CALENDAR_DEFAULT_WINDOW_DAYS), 'yyyy-MM-dd'),
    dateTo: format(addDays(today, CALENDAR_DEFAULT_WINDOW_DAYS), 'yyyy-MM-dd'),
  };
}

// These three panels only matter once the user interacts — the schedule form
// opens from a button, the stat modal opens from a dashboard tile, and the
// notifications dropdown opens from the bell. Splitting them out of the main
// shell bundle makes the initial authenticated route boot with less JS.
// We still prewarm the chunks in an idle callback below so the first open
// doesn't pay the network cost.
const ScheduleForm = lazy(() => import('../components/ScheduleForm'));
const StatModal = lazy(() => import('../components/StatModal'));
const NotificationsPanel = lazy(() => import('../components/NotificationsPanel'));

export default function DashboardPage() {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const {
    scheduleFormOpen,
    setScheduleFormOpen,
    editingSchedule,
    handleNewSchedule,
    handleEditSchedule
  } = useScheduleModal();

  // Gate the heavier fetches by route + active Insights tab so Calendar /
  // Kanban / Map don't pay for data only /insights consumes, and so the
  // Summary / Analytics tabs don't force /activities or /workload to load
  // when they don't consume either. Defaults to 'summary' when no tab query
  // param is present (matches InsightsPage).
  const onInsights = location.pathname.startsWith('/insights');
  // Treat `/` like `/calendar` because the root index route redirects
  // to `/calendar` (see App.tsx). Without this, the first render after
  // a fresh login lands at `/` and would pass `scheduleWindow = null`,
  // triggering an unbounded schedules fetch — the exact slowness this
  // PR is trying to remove.
  const onCalendar =
    location.pathname === '/' || location.pathname.startsWith('/calendar');
  const insightsTab = onInsights
    ? new URLSearchParams(location.search).get('tab') || 'summary'
    : null;
  const needActivity = onInsights && insightsTab === 'activity';
  const needWorkload = onInsights && insightsTab === 'workload';

  // Base window is computed once at mount and held stable across
  // renders so the SWR key doesn't shift on every re-render.
  const defaultWindow = useMemo(defaultCalendarWindow, []);

  // The user can widen the window by navigating the calendar; that
  // widening is tracked in state and applied on top of the base.
  // `null` means "no user-driven widening — use the base when on
  // /calendar, otherwise pass no window".
  const [widenedWindow, setWidenedWindow] = useState<ScheduleWindow | null>(null);

  // Derive the effective window *synchronously* from the path so
  // navigation calendar <-> kanban/map/profiles flips the fetch scope
  // on the first render (not after a follow-up effect). Previously
  // this used useEffect, which left Kanban/Map briefly rendering with
  // the calendar-scoped dataset on the first render after navigation.
  const scheduleWindow: ScheduleWindow | null = onCalendar
    ? (widenedWindow ?? defaultWindow)
    : null;

  const {
    locations, employees, classes, schedules, stats, activities, workloadData, loadingState,
    fetchLocations, fetchEmployees, fetchSchedules, fetchActivities, fetchWorkload,
    handleClassRefresh, handleScheduleSaved, fetchErrors
  } = useDashboardData({ needActivity, needWorkload, scheduleWindow });

  const {
    statModalOpen,
    setStatModalOpen,
    statModalType,
    statModalData,
    statModalTitle,
    handleStatClick
  } = useStatModal({ schedules, employees, locations, classes });

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  // Prewarm the lazy shell chunks once the main shell is idle. Mirrors the
  // html2canvas/jspdf prewarm in CalendarView: dynamic imports dedupe with
  // React.lazy's own loader, so opening the bell or a modal hits cache.
  useEffect(() => {
    const prewarm = () => {
      void import('../components/ScheduleForm');
      void import('../components/StatModal');
      void import('../components/NotificationsPanel');
    };
    if (typeof globalThis.requestIdleCallback === 'function') {
      const id = globalThis.requestIdleCallback(prewarm, { timeout: 5000 });
      return () => globalThis.cancelIdleCallback?.(id);
    }
    const id = setTimeout(prewarm, 2000);
    return () => clearTimeout(id);
  }, []);

  // Stable identity for the window setter so CalendarView's useEffect
  // deps stay honest. CalendarView reads the current effective window
  // via outlet context and passes the widened concrete bounds here.
  const updateScheduleWindow = useCallback(
    (next: ScheduleWindow | null) => {
      setWidenedWindow(next);
    },
    []
  );

  const contextValue = useMemo(() => ({
    locations, employees, classes, schedules, stats, activities, workloadData, loadingState,
    fetchLocations, fetchEmployees, fetchSchedules, fetchActivities, fetchWorkload,
    handleClassRefresh, handleScheduleSaved, fetchErrors,
    scheduleWindow,
    setScheduleWindow: updateScheduleWindow,
    onEditSchedule: handleEditSchedule,
    onNewSchedule: handleNewSchedule,
    onStatClick: handleStatClick
  }), [
    locations, employees, classes, schedules, stats, activities, workloadData,
    fetchLocations, fetchEmployees, fetchSchedules, fetchActivities, fetchWorkload,
    handleClassRefresh, handleScheduleSaved, fetchErrors, loadingState,
    scheduleWindow, updateScheduleWindow, handleEditSchedule, handleNewSchedule, handleStatClick
  ]);

  return (
    <div className="flex h-screen bg-[#F9FAFB] dark:bg-gray-950 overflow-hidden" data-testid="dashboard-page">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-white focus:dark:bg-gray-900 focus:text-indigo-600 focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:ring-2 focus:ring-indigo-500"
        data-testid="skip-to-content"
      >
        Skip to main content
      </a>
      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <div
        id="app-sidebar"
        className={cn(
          "fixed top-0 left-0 h-full md:relative z-50 md:z-auto transition-transform duration-300 md:translate-x-0",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onNewSchedule={handleNewSchedule}
        />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar with hamburger + notifications */}
        <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 shrink-0" data-testid="top-bar">
          <button
            type="button"
            aria-label={mobileSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileSidebarOpen}
            aria-controls="app-sidebar"
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
            data-testid="mobile-menu-btn"
          >
            <svg className="w-5 h-5 text-slate-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path className="text-slate-600 dark:text-muted-foreground" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="ml-auto">
            {/* Reserve the bell's footprint so the header doesn't jump when
                the lazy chunk resolves. */}
            <ErrorBoundary fallback={shellFallback}>
              <Suspense fallback={<div className="w-10 h-10" aria-hidden="true" />}>
                <NotificationsPanel />
              </Suspense>
            </ErrorBoundary>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {/* Per-route ErrorBoundary is wired in App.tsx via RouteBoundary so
              an error on one page stays scoped to that page and clears on
              navigation. */}
          <Suspense fallback={
            <output
              className="flex items-center justify-center h-64"
              aria-label="Loading page"
            >
              <span className="w-8 h-8 border-2 border-hub border-t-transparent rounded-full animate-spin" />
            </output>
          }>
            <Outlet context={contextValue} />
          </Suspense>
        </main>
      </div>

      {/* Schedule Form Modal — only mount once the user opens it, so the
          lazy chunk stays deferred until actually needed. */}
      {scheduleFormOpen && (
        <ErrorBoundary fallback={shellFallback}>
          <Suspense fallback={null}>
            <ScheduleForm
              open={scheduleFormOpen}
              onOpenChange={setScheduleFormOpen}
              locations={locations}
              employees={employees}
              classes={classes}
              editSchedule={editingSchedule}
              onSaved={handleScheduleSaved}
              onClassCreated={handleClassRefresh}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Stat Modals — same pattern, mount on open. */}
      {statModalOpen && (
        <ErrorBoundary fallback={shellFallback}>
          <Suspense fallback={null}>
            <StatModal
              isOpen={statModalOpen}
              onClose={() => setStatModalOpen(false)}
              title={statModalTitle}
              type={statModalType}
              data={statModalData}
              classes={classes}
              employees={employees}
              locations={locations}
            />
          </Suspense>
        </ErrorBoundary>
      )}

    </div>
  );
}

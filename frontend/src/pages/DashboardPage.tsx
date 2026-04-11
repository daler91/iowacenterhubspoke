import { useState, useEffect, Suspense, useMemo } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useDashboardData } from '../hooks/useDashboardData';
import { useScheduleModal } from '../hooks/useScheduleModal';
import { useStatModal } from '../hooks/useStatModal';
import { cn } from '../lib/utils';
import Sidebar from '../components/Sidebar';
import ScheduleForm from '../components/ScheduleForm';
import StatModal from '../components/StatModal';
import NotificationsPanel from '../components/NotificationsPanel';

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

  const {
    locations, employees, classes, schedules, stats, activities, workloadData,
    fetchLocations, fetchEmployees, fetchSchedules, fetchActivities, fetchWorkload,
    handleClassRefresh, handleScheduleSaved, fetchErrors
  } = useDashboardData();

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

  const contextValue = useMemo(() => ({
    locations, employees, classes, schedules, stats, activities, workloadData,
    fetchLocations, fetchEmployees, fetchSchedules, fetchActivities, fetchWorkload,
    handleClassRefresh, handleScheduleSaved, fetchErrors,
    onEditSchedule: handleEditSchedule,
    onStatClick: handleStatClick
  }), [
    locations, employees, classes, schedules, stats, activities, workloadData,
    fetchLocations, fetchEmployees, fetchSchedules, fetchActivities, fetchWorkload,
    handleClassRefresh, handleScheduleSaved, fetchErrors, handleEditSchedule, handleStatClick
  ]);

  return (
    <div className="flex h-screen bg-[#F9FAFB] dark:bg-gray-950 overflow-hidden" data-testid="dashboard-page">
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
            <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path className="text-slate-600 dark:text-muted-foreground" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="ml-auto">
            <NotificationsPanel />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
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

      {/* Schedule Form Modal */}
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

      {/* Stat Modals */}
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

    </div>
  );
}

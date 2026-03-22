import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import { useDashboardData } from '../hooks/useDashboardData';
import { cn } from '../lib/utils';
import Sidebar from '../components/Sidebar';
import ScheduleForm from '../components/ScheduleForm';
import StatModal from '../components/StatModal';
import NotificationsPanel from '../components/NotificationsPanel';

export default function DashboardPage() {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);

  const [statModalOpen, setStatModalOpen] = useState(false);
  const [statModalType, setStatModalType] = useState('today');
  const [statModalData, setStatModalData] = useState([]);
  const [statModalTitle, setStatModalTitle] = useState('');

  const {
    locations, employees, classes, schedules, stats, activities, workloadData,
    fetchLocations, fetchEmployees, fetchSchedules, fetchActivities, fetchWorkload,
    handleClassRefresh, handleScheduleSaved
  } = useDashboardData();

  const handleNewSchedule = () => {
    setEditingSchedule(null);
    setScheduleFormOpen(true);
  };

  const handleEditSchedule = (schedule) => {
    setEditingSchedule(schedule);
    setScheduleFormOpen(true);
  };

  const handleStatClick = (type) => {
    setStatModalType(type);

    if (type === 'today') {
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      const todaySchedules = schedules.filter(s => s.date === todayStr);
      setStatModalData(todaySchedules);
      setStatModalTitle('Today\'s Schedule');
    } else if (type === 'scheduled') {
      const futureSchedules = schedules.filter(s => new Date(s.date) >= new Date(new Date().setHours(0,0,0,0)));
      futureSchedules.sort((a, b) => new Date(a.date) - new Date(b.date));
      setStatModalData(futureSchedules);
      setStatModalTitle('All Scheduled Classes');
    } else if (type === 'team') {
      setStatModalData(employees);
      setStatModalTitle('Team Members');
    } else if (type === 'locations') {
      setStatModalData(locations);
      setStatModalTitle('All Locations');
    }

    setStatModalOpen(true);
  };

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const contextValue = {
    locations, employees, classes, schedules, stats, activities, workloadData,
    fetchLocations, fetchEmployees, fetchSchedules, fetchActivities, fetchWorkload,
    handleClassRefresh, handleScheduleSaved,
    onEditSchedule: handleEditSchedule,
    onStatClick: handleStatClick
  };

  return (
    <div className="flex h-screen bg-[#F9FAFB] overflow-hidden" data-testid="dashboard-page">
      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <div className={cn(
        "fixed top-0 left-0 h-full md:relative z-50 md:z-auto transition-transform duration-300 md:translate-x-0",
        mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onNewSchedule={handleNewSchedule}
        />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar with hamburger + notifications */}
        <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-gray-100 bg-white shrink-0" data-testid="top-bar">
          <button
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100"
            onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
            data-testid="mobile-menu-btn"
          >
            <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <NotificationsPanel />
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet context={contextValue} />
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

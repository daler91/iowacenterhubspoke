import { useState, useEffect, useCallback, useRef } from 'react';
import { format, addWeeks, subWeeks, addDays, subDays, addMonths, subMonths } from 'date-fns';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  ChevronLeft, ChevronRight, Calendar as CalIcon,
  Users, MapPin, Clock, TrendingUp, FileDown
} from 'lucide-react';
import { toast } from 'sonner';
import { locationsAPI, employeesAPI, schedulesAPI, dashboardAPI, activityAPI, workloadAPI } from '../lib/api';
import { cn } from '../lib/utils';
import Sidebar from '../components/Sidebar';
import CalendarWeek from '../components/CalendarWeek';
import CalendarDay from '../components/CalendarDay';
import CalendarMonth from '../components/CalendarMonth';
import ScheduleForm from '../components/ScheduleForm';
import LocationManager from '../components/LocationManager';
import EmployeeManager from '../components/EmployeeManager';
import MapView from '../components/MapView';
import WorkloadDashboard from '../components/WorkloadDashboard';
import KanbanBoard from '../components/KanbanBoard';
import ActivityFeed from '../components/ActivityFeed';
import EmployeeProfile from '../components/EmployeeProfile';
import NotificationsPanel from '../components/NotificationsPanel';
import WeeklyReport from '../components/WeeklyReport';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export default function DashboardPage() {
  const [activeView, setActiveView] = useState('dashboard');
  const [calendarView, setCalendarView] = useState('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);

  const [locations, setLocations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [stats, setStats] = useState({});
  const [activities, setActivities] = useState([]);
  const [workloadData, setWorkloadData] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [filterLocation, setFilterLocation] = useState('all');

  const calendarRef = useRef(null);

  const filteredSchedules = (schedules || []).filter(s => {
    if (filterEmployee !== 'all' && s.employee_id !== filterEmployee) return false;
    if (filterLocation !== 'all' && s.location_id !== filterLocation) return false;
    return true;
  });

  const fetchLocations = useCallback(async () => {
    try {
      const res = await locationsAPI.getAll();
      setLocations(res.data);
    } catch (err) { console.error('Failed to fetch locations', err); }
  }, []);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await employeesAPI.getAll();
      setEmployees(res.data);
    } catch (err) { console.error('Failed to fetch employees', err); }
  }, []);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await schedulesAPI.getAll();
      setSchedules(res.data);
    } catch (err) { console.error('Failed to fetch schedules', err); }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await dashboardAPI.getStats();
      setStats(res.data);
    } catch (err) { console.error('Failed to fetch stats', err); }
  }, []);

  const fetchActivities = useCallback(async () => {
    try {
      const res = await activityAPI.getAll(50);
      setActivities(res.data);
    } catch (err) { console.error('Failed to fetch activities', err); }
  }, []);

  const fetchWorkload = useCallback(async () => {
    try {
      const res = await workloadAPI.getAll();
      setWorkloadData(res.data);
    } catch (err) { console.error('Failed to fetch workload', err); }
  }, []);

  useEffect(() => {
    fetchLocations();
    fetchEmployees();
    fetchSchedules();
    fetchStats();
    fetchActivities();
    fetchWorkload();
  }, [fetchLocations, fetchEmployees, fetchSchedules, fetchStats, fetchActivities, fetchWorkload]);

  const handleNewSchedule = () => {
    setEditingSchedule(null);
    setScheduleFormOpen(true);
    if (activeView !== 'calendar' && activeView !== 'dashboard') {
      setActiveView('calendar');
    }
  };

  const handleEditSchedule = (schedule) => {
    setEditingSchedule(schedule);
    setScheduleFormOpen(true);
  };

  const handleScheduleSaved = () => {
    fetchSchedules();
    fetchStats();
    fetchActivities();
    fetchWorkload();
  };

  const navigateDate = (direction) => {
    if (calendarView === 'week') {
      setCurrentDate(prev => direction === 'next' ? addWeeks(prev, 1) : subWeeks(prev, 1));
    } else if (calendarView === 'day') {
      setCurrentDate(prev => direction === 'next' ? addDays(prev, 1) : subDays(prev, 1));
    } else {
      setCurrentDate(prev => direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1));
    }
  };

  const exportPDF = async () => {
    if (!calendarRef.current) return;
    toast.info('Generating PDF...');
    try {
      const canvas = await html2canvas(calendarRef.current, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('landscape', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`schedule-${format(currentDate, 'yyyy-MM-dd')}.pdf`);
      toast.success('PDF exported successfully');
    } catch (err) {
      toast.error('Failed to export PDF');
    }
  };

  const handleMonthDateClick = (date) => {
    setCurrentDate(date);
    setCalendarView('day');
  };

  const handleRelocate = async (scheduleId, newDate, newStart, newEnd) => {
    try {
      await schedulesAPI.relocate(scheduleId, { date: newDate, start_time: newStart, end_time: newEnd });
      toast.success('Schedule moved');
      fetchSchedules();
      fetchActivities();
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('Conflict at the new time slot');
      } else {
        toast.error('Failed to move schedule');
      }
    }
  };

  const renderDashboard = () => (
    <div className="space-y-6 animate-slide-in" data-testid="dashboard-overview">
      <div>
        <h2 className="text-3xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Dashboard
        </h2>
        <p className="text-slate-500 mt-1">Overview of your scheduling hub</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center">
              <CalIcon className="w-5 h-5 text-indigo-600" />
            </div>
            <Badge className="bg-indigo-100 text-indigo-700 border-0 text-[10px]">Today</Badge>
          </div>
          <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-today">
            {stats.today_schedules || 0}
          </p>
          <p className="text-xs text-slate-500 mt-1">Classes today</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-teal-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-total-schedules">
            {stats.total_schedules || 0}
          </p>
          <p className="text-xs text-slate-500 mt-1">Total schedules</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-violet-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-employees">
            {stats.total_employees || 0}
          </p>
          <p className="text-xs text-slate-500 mt-1">Active employees</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
              <MapPin className="w-5 h-5 text-amber-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-locations">
            {stats.total_locations || 0}
          </p>
          <p className="text-xs text-slate-500 mt-1">Spoke locations</p>
        </div>
      </div>

      {/* Quick calendar */}
      <div ref={calendarRef}>
        <CalendarWeek
          currentDate={currentDate}
          schedules={schedules}
          onEditSchedule={handleEditSchedule}
        />
      </div>
    </div>
  );

  const renderCalendar = () => (
    <div className="space-y-4 animate-slide-in" data-testid="calendar-view">
      {/* Calendar controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            data-testid="calendar-prev"
            onClick={() => navigateDate('prev')}
            className="border-gray-200"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <h2 className="text-xl font-bold text-slate-800 min-w-[200px] text-center" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {calendarView === 'month'
              ? format(currentDate, 'MMMM yyyy')
              : calendarView === 'day'
              ? format(currentDate, 'MMMM d, yyyy')
              : `Week of ${format(currentDate, 'MMM d, yyyy')}`}
          </h2>
          <Button
            variant="outline"
            size="sm"
            data-testid="calendar-next"
            onClick={() => navigateDate('next')}
            className="border-gray-200"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="calendar-today"
            onClick={() => setCurrentDate(new Date())}
            className="border-gray-200 text-sm"
          >
            Today
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Tabs value={calendarView} onValueChange={setCalendarView}>
            <TabsList className="bg-gray-100">
              <TabsTrigger value="day" data-testid="view-day" className="text-xs">Day</TabsTrigger>
              <TabsTrigger value="week" data-testid="view-week" className="text-xs">Week</TabsTrigger>
              <TabsTrigger value="month" data-testid="view-month" className="text-xs">Month</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="sm"
            data-testid="export-pdf-btn"
            onClick={exportPDF}
            className="border-gray-200"
          >
            <FileDown className="w-4 h-4 mr-1" />
            PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Filter:</span>
        <Select value={filterEmployee} onValueChange={setFilterEmployee}>
          <SelectTrigger className="w-[180px] h-9 text-xs bg-white" data-testid="filter-employee">
            <SelectValue placeholder="All employees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Employees</SelectItem>
            {(employees || []).map(emp => (
              <SelectItem key={emp.id} value={emp.id}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: emp.color }} />
                  {emp.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterLocation} onValueChange={setFilterLocation}>
          <SelectTrigger className="w-[180px] h-9 text-xs bg-white" data-testid="filter-location">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {(locations || []).map(loc => (
              <SelectItem key={loc.id} value={loc.id}>{loc.city_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(filterEmployee !== 'all' || filterLocation !== 'all') && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterEmployee('all'); setFilterLocation('all'); }} className="text-xs text-slate-400" data-testid="clear-filters">
            Clear filters
          </Button>
        )}
      </div>

      {/* Calendar body */}
      <div ref={calendarRef}>
        {calendarView === 'week' && (
          <CalendarWeek
            currentDate={currentDate}
            schedules={filteredSchedules}
            onEditSchedule={handleEditSchedule}
            onRelocate={handleRelocate}
          />
        )}
        {calendarView === 'day' && (
          <CalendarDay
            currentDate={currentDate}
            schedules={filteredSchedules}
            onEditSchedule={handleEditSchedule}
          />
        )}
        {calendarView === 'month' && (
          <CalendarMonth
            currentDate={currentDate}
            schedules={filteredSchedules}
            onDateClick={handleMonthDateClick}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-2">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-indigo-600" />
          <span className="text-xs text-slate-500">Class Time</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gray-200 border border-dashed border-gray-300" />
          <span className="text-xs text-slate-500">Drive Time</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-amber-100 border border-amber-300" />
          <span className="text-xs text-slate-500">Town-to-Town Warning</span>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeView) {
      case 'dashboard':
        return renderDashboard();
      case 'calendar':
        return renderCalendar();
      case 'kanban':
        return <KanbanBoard schedules={schedules} onEditSchedule={handleEditSchedule} onRefresh={() => { fetchSchedules(); fetchActivities(); fetchWorkload(); }} />;
      case 'workload':
        return <WorkloadDashboard workloadData={workloadData} employees={employees} />;
      case 'report':
        return <WeeklyReport />;
      case 'activity':
        return <ActivityFeed activities={activities} />;
      case 'map':
        return <MapView locations={locations} schedules={schedules} />;
      case 'locations':
        return <LocationManager locations={locations} onRefresh={() => { fetchLocations(); fetchActivities(); }} />;
      case 'employees':
        if (selectedEmployeeId) {
          return <EmployeeProfile employeeId={selectedEmployeeId} onBack={() => setSelectedEmployeeId(null)} />;
        }
        return <EmployeeManager employees={employees} onRefresh={() => { fetchEmployees(); fetchActivities(); fetchWorkload(); }} onViewProfile={(id) => setSelectedEmployeeId(id)} />;
      default:
        return renderDashboard();
    }
  };

  return (
    <div className="flex h-screen bg-[#F9FAFB] overflow-hidden" data-testid="dashboard-page">
      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <div className={cn(
        "fixed top-0 left-0 h-full md:relative z-50 md:z-auto transition-transform duration-300 md:translate-x-0",
        mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <Sidebar
          activeView={activeView}
          onViewChange={(view) => { setActiveView(view); setSelectedEmployeeId(null); setMobileSidebarOpen(false); }}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onNewSchedule={() => { handleNewSchedule(); setMobileSidebarOpen(false); }}
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
          {renderContent()}
        </main>
      </div>

      {/* Schedule Form Modal */}
      <ScheduleForm
        open={scheduleFormOpen}
        onOpenChange={setScheduleFormOpen}
        locations={locations}
        employees={employees}
        editSchedule={editingSchedule}
        onSaved={handleScheduleSaved}
      />
    </div>
  );
}

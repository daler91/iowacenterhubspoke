import re

with open('frontend/src/pages/DashboardPage.jsx', 'r') as f:
    content = f.read()

# Add imports
imports = """import jsPDF from 'jspdf';
import StatModal from '../components/StatModal';
"""
content = content.replace("import jsPDF from 'jspdf';", imports)

# Add state variables
state_vars = """  const [editingSchedule, setEditingSchedule] = useState(null);

  const [statModalOpen, setStatModalOpen] = useState(false);
  const [statModalType, setStatModalType] = useState('today');
  const [statModalData, setStatModalData] = useState([]);
  const [statModalTitle, setStatModalTitle] = useState('');
"""
content = content.replace("  const [editingSchedule, setEditingSchedule] = useState(null);", state_vars)

# Add handler functions
handlers = """  const handleRelocate = async (scheduleId, newDate, newStart, newEnd) => {
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

  const handleStatClick = (type) => {
    setStatModalType(type);

    if (type === 'today') {
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      const todaySchedules = schedules.filter(s => s.date === todayStr);
      setStatModalData(todaySchedules);
      setStatModalTitle('Today\\'s Schedule');
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
"""
content = content.replace("  const handleRelocate = async (scheduleId, newDate, newStart, newEnd) => {\n    try {\n      await schedulesAPI.relocate(scheduleId, { date: newDate, start_time: newStart, end_time: newEnd });\n      toast.success('Schedule moved');\n      fetchSchedules();\n      fetchActivities();\n    } catch (err) {\n      if (err.response?.status === 409) {\n        toast.error('Conflict at the new time slot');\n      } else {\n        toast.error('Failed to move schedule');\n      }\n    }\n  };", handlers)

# Update renderCalendarStats to be clickable
old_stats = """  const renderCalendarStats = () => (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3" data-testid="calendar-stats-strip">
      <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Today</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-today">
              {stats.today_schedules || 0}
            </p>
          </div>
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
            <CalIcon className="w-5 h-5 text-indigo-600" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Scheduled</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-total-schedules">
              {stats.total_schedules || 0}
            </p>
          </div>
          <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-teal-600" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Team</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-employees">
              {stats.total_employees || 0}
            </p>
          </div>
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5 text-violet-600" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Locations</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-locations">
              {stats.total_locations || 0}
            </p>
          </div>
          <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
            <MapPin className="w-5 h-5 text-amber-600" />
          </div>
        </div>
      </div>
    </div>
  );"""

new_stats = """  const renderCalendarStats = () => (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3" data-testid="calendar-stats-strip">
      <div
        className="bg-white rounded-2xl border border-gray-100 px-4 py-3 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all"
        onClick={() => handleStatClick('today')}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Today</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-today">
              {stats.today_schedules || 0}
            </p>
          </div>
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
            <CalIcon className="w-5 h-5 text-indigo-600" />
          </div>
        </div>
      </div>

      <div
        className="bg-white rounded-2xl border border-gray-100 px-4 py-3 cursor-pointer hover:border-teal-300 hover:shadow-sm transition-all"
        onClick={() => handleStatClick('scheduled')}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Scheduled</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-total-schedules">
              {stats.total_schedules || 0}
            </p>
          </div>
          <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-teal-600" />
          </div>
        </div>
      </div>

      <div
        className="bg-white rounded-2xl border border-gray-100 px-4 py-3 cursor-pointer hover:border-violet-300 hover:shadow-sm transition-all"
        onClick={() => handleStatClick('team')}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Team</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-employees">
              {stats.total_employees || 0}
            </p>
          </div>
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5 text-violet-600" />
          </div>
        </div>
      </div>

      <div
        className="bg-white rounded-2xl border border-gray-100 px-4 py-3 cursor-pointer hover:border-amber-300 hover:shadow-sm transition-all"
        onClick={() => handleStatClick('locations')}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Locations</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-locations">
              {stats.total_locations || 0}
            </p>
          </div>
          <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
            <MapPin className="w-5 h-5 text-amber-600" />
          </div>
        </div>
      </div>
    </div>
  );"""

content = content.replace(old_stats, new_stats)

# Add StatModal component render
modal_render = """      <ScheduleForm
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
"""
content = content.replace("""      <ScheduleForm
        open={scheduleFormOpen}
        onOpenChange={setScheduleFormOpen}
        locations={locations}
        employees={employees}
        classes={classes}
        editSchedule={editingSchedule}
        onSaved={handleScheduleSaved}
        onClassCreated={handleClassRefresh}
      />""", modal_render)

with open('frontend/src/pages/DashboardPage.jsx', 'w') as f:
    f.write(content)
print("Updated DashboardPage.jsx successfully.")

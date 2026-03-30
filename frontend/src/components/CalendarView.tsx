import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import { format, parseISO, addWeeks, subWeeks, addDays, subDays, addMonths, subMonths, isValid } from 'date-fns';
import { useAuth } from '../lib/auth';
import { toast } from 'sonner';
import { schedulesAPI } from '../lib/api';
import StatsStrip from './StatsStrip';
import ScheduleFilters from './ScheduleFilters';
import CalendarToolbar from './CalendarToolbar';
import RelocateConflictDialog from './RelocateConflictDialog';
import CalendarWeek from './CalendarWeek';
import CalendarDay from './CalendarDay';
import MobileCalendar from './MobileCalendar';
import { useMediaQuery } from '../hooks/useMediaQuery';
import CalendarMonth from './CalendarMonth';
import ErrorBoundary from './ErrorBoundary';
import BulkActionBar from './BulkActionBar';
import ExportCsvDialog from './ExportCsvDialog';
import ImportCsvDialog from './ImportCsvDialog';
import useSelectionMode from '../hooks/useSelectionMode';

export default function CalendarView() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const {
    locations,
    classes,
    employees,
    schedules,
    stats: rawStats,
    fetchSchedules,
    fetchActivities,
    onEditSchedule,
    onStatClick,
    fetchErrors,
  } = useOutletContext<any>();

  const stats = rawStats ?? {};
  const [searchParams, setSearchParams] = useSearchParams();
  const calendarRef = useRef<HTMLDivElement>(null);

  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [relocateConflictData, setRelocateConflictData] = useState<any>(null);

  const {
    selectionMode,
    selectedIds,
    selectedCount,
    toggleSelectionMode,
    toggleItem,
    deselectAll,
    isSelected,
    clearSelection,
  } = useSelectionMode();

  // URL State
  const calendarView = searchParams.get('view') || 'week';
  const exportDaysOffset = { month: 30, week: 7 }[calendarView as string] || 1;
  const dateStr = searchParams.get('date');
  const currentDate = dateStr && isValid(parseISO(dateStr)) ? parseISO(dateStr) : new Date();
  const filterEmployee = searchParams.get('employee') || 'all';
  const filterLocation = searchParams.get('location') || 'all';

  useEffect(() => {
    clearSelection();
  }, [calendarView, dateStr, clearSelection]);

  const updateParams = useCallback((newParams: Record<string, string | null>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      Object.entries(newParams).forEach(([key, value]) => {
        if (value === null || value === 'all') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      });
      return next;
    });
  }, [setSearchParams]);

  const setCalendarView = (view: string) => updateParams({ view });
  const setCurrentDate = (date: Date) => updateParams({ date: format(date, 'yyyy-MM-dd') });
  const setFilterEmployee = (id: string) => updateParams({ employee: id });
  const setFilterLocation = (id: string) => updateParams({ location: id });

  const filteredSchedules = useMemo(() =>
    (schedules || []).filter((s: any) => {
      if (filterEmployee !== 'all' && !s.employee_ids?.includes(filterEmployee)) return false;
      if (filterLocation !== 'all' && s.location_id !== filterLocation) return false;
      return true;
    }),
    [schedules, filterEmployee, filterLocation]
  );

  const navigateDate = (direction: 'prev' | 'next') => {
    let nextDate;
    if (calendarView === 'week') {
      nextDate = direction === 'next' ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1);
    } else if (calendarView === 'day') {
      nextDate = direction === 'next' ? addDays(currentDate, 1) : subDays(currentDate, 1);
    } else {
      nextDate = direction === 'next' ? addMonths(currentDate, 1) : subMonths(currentDate, 1);
    }
    setCurrentDate(nextDate);
  };

  const exportPDF = async () => {
    if (!calendarRef.current) return;
    toast.info('Generating PDF...');
    try {
      const [html2canvas, { jsPDF }] = await Promise.all([
        import('html2canvas').then(m => m.default),
        import('jspdf')
      ]);
      const canvas = await html2canvas(calendarRef.current, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('landscape', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`schedule-${format(currentDate, 'yyyy-MM-dd')}.pdf`);
      toast.success('PDF exported successfully');
    } catch (err) {
      console.error(err);
      toast.error('Failed to export PDF');
    }
  };

  const handleMonthDateClick = (date: Date) => {
    updateParams({ date: format(date, 'yyyy-MM-dd'), view: 'day' });
  };

  const handleRelocate = async (scheduleId: string, newDate: string, newStart: string, newEnd: string, force = false) => {
    fetchSchedules(
      (current: any) => (current || []).map((s: any) =>
        s.id === scheduleId
          ? { ...s, date: newDate, start_time: newStart, end_time: newEnd }
          : s
      ),
      { revalidate: false }
    );

    try {
      await schedulesAPI.relocate(scheduleId, { date: newDate, start_time: newStart, end_time: newEnd, force });
      toast.success('Schedule moved');
      fetchSchedules();
      fetchActivities();
      setRelocateConflictData(null);
    } catch (err: any) {
      fetchSchedules();
      if (err.response?.status === 409) {
        setRelocateConflictData({
          scheduleId,
          newDate,
          newStart,
          newEnd,
          conflicts: err.response.data.detail?.conflicts || []
        });
      } else {
        toast.error('Failed to move schedule');
      }
    }
  };

  const handleForceRelocate = () => {
    if (!relocateConflictData) return;
    const { scheduleId, newDate, newStart, newEnd } = relocateConflictData;
    handleRelocate(scheduleId, newDate, newStart, newEnd, true);
  };

  const handleBulkComplete = () => {
    clearSelection();
    fetchSchedules();
    fetchActivities();
  };

  return (
    <div className="space-y-5 animate-slide-in" data-testid="calendar-view">
      <div className="space-y-2" data-testid="calendar-home-header">
        <h2 className="text-3xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Scheduling Calendar
        </h2>
        <p className="text-slate-500">Your main planning view — focused on classes, travel time, and weekly flow.</p>
        {(schedules || []).length === 0 && (
          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2" data-testid="schedule-debug">
            No schedule data loaded. Total in context: {(schedules || []).length} | Filtered: {filteredSchedules.length}
          </p>
        )}
        {(schedules || []).length > 0 && filteredSchedules.length > 0 && (
          <p className="text-xs text-slate-400" data-testid="schedule-count">
            {filteredSchedules.length} schedules loaded — showing {calendarView} view
          </p>
        )}
      </div>

      <StatsStrip stats={stats} onStatClick={onStatClick} />

      <CalendarToolbar
        isMobile={isMobile}
        calendarView={calendarView}
        currentDate={currentDate}
        isAdmin={isAdmin}
        selectionMode={selectionMode}
        onNavigate={navigateDate}
        onToday={() => setCurrentDate(new Date())}
        onViewChange={setCalendarView}
        onToggleSelection={toggleSelectionMode}
        onExportCsv={() => setExportOpen(true)}
        onImportCsv={() => setImportOpen(true)}
        onExportPdf={exportPDF}
        onPrint={() => globalThis.print()}
      />

      <ScheduleFilters
        filterEmployee={filterEmployee}
        setFilterEmployee={setFilterEmployee}
        filterLocation={filterLocation}
        setFilterLocation={setFilterLocation}
        employees={employees}
        locations={locations}
      />

      {fetchErrors?.schedules && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between" data-testid="schedule-fetch-error">
          <p className="text-sm text-red-700">Failed to load schedules: {fetchErrors.schedules}. Data may be outdated.</p>
          <button onClick={() => fetchSchedules()} className="text-sm font-medium text-red-700 hover:text-red-800 underline">Retry</button>
        </div>
      )}

      <div ref={calendarRef}>
        <ErrorBoundary key={calendarView}>
          {isMobile ? (
            <MobileCalendar
              currentDate={currentDate}
              setCurrentDate={setCurrentDate}
              schedules={filteredSchedules}
              onEditSchedule={onEditSchedule}
              selectionMode={selectionMode}
              isSelected={isSelected}
              toggleItem={toggleItem}
            />
          ) : (
            <>
              {calendarView === 'week' && (
                <CalendarWeek
                  currentDate={currentDate}
                  schedules={filteredSchedules}
                  onEditSchedule={onEditSchedule}
                  onRelocate={handleRelocate}
                  selectionMode={selectionMode}
                  isSelected={isSelected}
                  toggleItem={toggleItem}
                />
              )}
              {calendarView === 'day' && (
                <CalendarDay
                  currentDate={currentDate}
                  schedules={filteredSchedules}
                  onEditSchedule={onEditSchedule}
                  onRelocate={handleRelocate}
                  selectionMode={selectionMode}
                  isSelected={isSelected}
                  toggleItem={toggleItem}
                />
              )}
              {calendarView === 'month' && (
                <CalendarMonth
                  currentDate={currentDate}
                  schedules={filteredSchedules}
                  onDateClick={handleMonthDateClick}
                />
              )}
            </>
          )}
        </ErrorBoundary>
      </div>

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

      {selectedCount > 0 && (
        <BulkActionBar
          selectedCount={selectedCount}
          selectedIds={selectedIds}
          onComplete={handleBulkComplete}
          onDeselectAll={deselectAll}
          employees={employees}
          locations={locations}
          classes={classes}
        />
      )}

      {exportOpen && (
        <ExportCsvDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          currentFilters={{
            start_date: format(currentDate, 'yyyy-MM-dd'),
            end_date: format(addDays(currentDate, exportDaysOffset), 'yyyy-MM-dd'),
            location_id: searchParams.get('location') || undefined,
            employee_id: searchParams.get('employee') || undefined,
          }}
        />
      )}

      {importOpen && (
        <ImportCsvDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImportSuccess={() => {
            fetchSchedules();
            fetchActivities?.();
          }}
        />
      )}

      <RelocateConflictDialog
        data={relocateConflictData}
        onClose={() => setRelocateConflictData(null)}
        onForce={handleForceRelocate}
      />
    </div>
  );
}

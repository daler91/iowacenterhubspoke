import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import { format, parseISO, addWeeks, subWeeks, addDays, subDays, addMonths, subMonths, isValid } from 'date-fns';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Button } from './ui/button';

import { ChevronLeft, ChevronRight, FileDown, ListChecks, Download, Upload } from 'lucide-react';
import ExportCsvDialog from './ExportCsvDialog';
import ImportCsvDialog from './ImportCsvDialog';
import { useAuth } from '../lib/auth';

import { toast } from 'sonner';
import { schedulesAPI } from '../lib/api';
import StatsStrip from './StatsStrip';
import ScheduleFilters from './ScheduleFilters';
import CalendarWeek from './CalendarWeek';
import CalendarDay from './CalendarDay';
import MobileCalendar from './MobileCalendar';
import { useMediaQuery } from '../hooks/useMediaQuery';
import CalendarMonth from './CalendarMonth';
import ErrorBoundary from './ErrorBoundary';
import BulkActionBar from './BulkActionBar';
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
  } = useOutletContext();

  const stats = rawStats ?? {};
  const [searchParams, setSearchParams] = useSearchParams();
  const calendarRef = useRef(null);

  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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
  const exportDaysOffset = { month: 30, week: 7 }[calendarView] || 1;
  const dateStr = searchParams.get('date');
  const currentDate = dateStr && isValid(parseISO(dateStr)) ? parseISO(dateStr) : new Date();
  const filterEmployee = searchParams.get('employee') || 'all';
  const filterLocation = searchParams.get('location') || 'all';

  // Clear selection when navigating dates or switching views
  useEffect(() => {
    clearSelection();
  }, [calendarView, dateStr, clearSelection]);

  const updateParams = useCallback((newParams) => {
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

  const setCalendarView = (view) => updateParams({ view });
  const setCurrentDate = (date) => updateParams({ date: format(date, 'yyyy-MM-dd') });
  const setFilterEmployee = (id) => updateParams({ employee: id });
  const setFilterLocation = (id) => updateParams({ location: id });

  const filteredSchedules = (schedules || []).filter(s => {
    if (filterEmployee !== 'all' && s.employee_id !== filterEmployee) return false;
    if (filterLocation !== 'all' && s.location_id !== filterLocation) return false;
    return true;
  });

  const navigateDate = (direction) => {
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
      // Dynamic imports for code splitting
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

  const handleMonthDateClick = (date) => {
    updateParams({ date: format(date, 'yyyy-MM-dd'), view: 'day' });
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
      </div>

      <StatsStrip stats={stats} onStatClick={onStatClick} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        {!isMobile && (
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
              {(() => {
                if (calendarView === 'month') return format(currentDate, 'MMMM yyyy');
                if (calendarView === 'day') return format(currentDate, 'MMMM d, yyyy');
                return `Week of ${format(currentDate, 'MMM d, yyyy')}`;
              })()}
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
        )}

        <div className="flex items-center gap-3">
          {calendarView !== 'month' && (
            <Button
              variant={selectionMode ? 'default' : 'outline'}
              size="sm"
              data-testid="calendar-select-mode"
              onClick={toggleSelectionMode}
              className={selectionMode ? '' : 'border-gray-200'}
            >
              <ListChecks className="w-4 h-4 mr-1" />
              Select
            </Button>
          )}
          {!isMobile && (
            <Tabs value={calendarView} onValueChange={setCalendarView}>
              <TabsList className="bg-gray-100">
                <TabsTrigger value="day" data-testid="view-day" className="text-xs">Day</TabsTrigger>
                <TabsTrigger value="week" data-testid="view-week" className="text-xs">Week</TabsTrigger>
                <TabsTrigger value="month" data-testid="view-month" className="text-xs">Month</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportOpen(true)}
                className="border-gray-200"
                disabled={selectionMode}
              >
                <Download className="w-4 h-4 mr-1" />
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
                className="border-gray-200"
                disabled={selectionMode}
              >
                <Upload className="w-4 h-4 mr-1" />
                Import CSV
              </Button>
            </>
          )}
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

      <ScheduleFilters
        filterEmployee={filterEmployee}
        setFilterEmployee={setFilterEmployee}
        filterLocation={filterLocation}
        setFilterLocation={setFilterLocation}
        employees={employees}
        locations={locations}
      />

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
    </div>
  );
}

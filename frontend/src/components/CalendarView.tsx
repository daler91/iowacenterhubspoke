import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import { useSearchParams, useOutletContext, Link } from 'react-router-dom';
import {
  format, parseISO, addWeeks, subWeeks, addDays, subDays, addMonths, subMonths,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, isValid,
} from 'date-fns';
import { useAuth } from '../lib/auth';
import { toast } from 'sonner';
import { MapPin, Users, BookOpen } from 'lucide-react';
import { schedulesAPI, normalizeApiError } from '../lib/api';
import { cn } from '../lib/utils';
import StatsStrip from './StatsStrip';
import ScheduleFilters from './ScheduleFilters';
import CalendarToolbar from './CalendarToolbar';
import { PageHeader } from './ui/page-header';
import CalendarWeek from './CalendarWeek';
import CalendarDay from './CalendarDay';
import MobileCalendar from './MobileCalendar';
import { useIsMobile } from '../hooks/useMediaQuery';
import CalendarMonth from './CalendarMonth';
import ErrorBoundary from './ErrorBoundary';
import BulkActionBar from './BulkActionBar';
import useSelectionMode from '../hooks/useSelectionMode';
import type { CalendarOutletContext, Schedule } from '../lib/types';

const RelocateConflictDialog = lazy(() => import('./RelocateConflictDialog'));
const ExportCsvDialog = lazy(() => import('./ExportCsvDialog'));
const ImportCsvDialog = lazy(() => import('./ImportCsvDialog'));

// Inclusive [start, end] of the currently-visible range for each view.
// Extracted so the widen-window effect below doesn't nest ternaries.
function viewBoundsFor(view: string, anchor: Date): [Date, Date] {
  if (view === 'month') return [startOfWeek(startOfMonth(anchor)), endOfWeek(endOfMonth(anchor))];
  if (view === 'week') return [startOfWeek(anchor), endOfWeek(anchor)];
  return [anchor, anchor];
}

export default function CalendarView() {
  const isMobile = useIsMobile();
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
    scheduleWindow,
    setScheduleWindow,
  } = useOutletContext<CalendarOutletContext>();

  const stats = rawStats ?? {};
  const [searchParams, setSearchParams] = useSearchParams();
  const calendarRef = useRef<HTMLDivElement>(null);

  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [relocateConflictData, setRelocateConflictData] = useState<{
    scheduleId: string;
    newDate: string;
    newStart: string;
    newEnd: string;
    conflicts: Array<Record<string, unknown>>;
  } | null>(null);

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
  const filterClass = searchParams.get('class') || 'all';

  useEffect(() => {
    clearSelection();
  }, [calendarView, dateStr, clearSelection]);

  // `currentDate` is re-parsed from search params every render, so use a
  // stable ISO string when building effect deps to avoid re-running on
  // every render.
  const currentDateIso = format(currentDate, 'yyyy-MM-dd');

  // Widen the schedule fetch window when the user navigates to a date
  // that falls outside the currently-fetched range. DashboardPage seeds
  // the window to ±60 days around today on Calendar mount; this effect
  // extends the range to at least cover the visible view. Shrinking is
  // deliberately avoided — SWR cache entries for narrower ranges stay
  // warm, and widening-only keeps nav snappy.
  const currentFrom = scheduleWindow?.dateFrom;
  const currentTo = scheduleWindow?.dateTo;
  useEffect(() => {
    if (!setScheduleWindow) return;
    const anchor = parseISO(currentDateIso);
    const [viewStart, viewEnd] = viewBoundsFor(calendarView, anchor);
    // Pad by two weeks so nearby nav clicks hit cache.
    const paddedFrom = format(subDays(viewStart, 14), 'yyyy-MM-dd');
    const paddedTo = format(addDays(viewEnd, 14), 'yyyy-MM-dd');
    const nextFrom = !currentFrom || paddedFrom < currentFrom ? paddedFrom : currentFrom;
    const nextTo = !currentTo || paddedTo > currentTo ? paddedTo : currentTo;
    if (nextFrom !== currentFrom || nextTo !== currentTo) {
      setScheduleWindow({ dateFrom: nextFrom, dateTo: nextTo });
    }
  }, [calendarView, currentDateIso, currentFrom, currentTo, setScheduleWindow]);

  // Pre-warm the PDF export chunk during an idle slot after the calendar
  // mounts. html2canvas + jspdf together are ~350KB gzipped; fetching them
  // on the first Export PDF click otherwise stalls the UI for 300–500ms.
  // The dynamic imports in exportPDF() below dedupe against this prefetch.
  useEffect(() => {
    const prewarm = () => {
      void import('html2canvas');
      void import('jspdf');
    };
    if (typeof globalThis.requestIdleCallback === 'function') {
      const id = globalThis.requestIdleCallback(prewarm, { timeout: 5000 });
      return () => globalThis.cancelIdleCallback?.(id);
    }
    const id = setTimeout(prewarm, 2000);
    return () => clearTimeout(id);
  }, []);

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
  const setFilterClass = (id: string) => updateParams({ class: id });

  const filteredSchedules = useMemo(() =>
    (schedules || []).filter((s: Schedule) => {
      if (filterEmployee !== 'all' && !s.employee_ids?.includes(filterEmployee)) return false;
      if (filterLocation !== 'all' && s.location_id !== filterLocation) return false;
      if (filterClass !== 'all' && s.class_id !== filterClass) return false;
      return true;
    }),
    [schedules, filterEmployee, filterLocation, filterClass]
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
    } catch {
      toast.error('Failed to export PDF');
    }
  };

  const handleMonthDateClick = (date: Date) => {
    updateParams({ date: format(date, 'yyyy-MM-dd'), view: 'day' });
  };

  const handleRelocate = async (scheduleId: string, newDate: string, newStart: string, newEnd: string, force = false, overrideReason?: string) => {
    fetchSchedules(
      (current: Schedule[] | null) => (current || []).map((s: Schedule) =>
        s.id === scheduleId
          ? { ...s, date: newDate, start_time: newStart, end_time: newEnd }
          : s
      ),
      { revalidate: false }
    );

    try {
      await schedulesAPI.relocate(scheduleId, { date: newDate, start_time: newStart, end_time: newEnd, force, ...(overrideReason && { override_reason: overrideReason }) });
      toast.success('Schedule moved');
      fetchSchedules();
      fetchActivities();
      setRelocateConflictData(null);
    } catch (err: unknown) {
      fetchSchedules();
      const normalized = normalizeApiError(err, 'Failed to move schedule');
      if (normalized.status === 409) {
        setRelocateConflictData({
          scheduleId,
          newDate,
          newStart,
          newEnd,
          conflicts: normalized.conflicts,
        });
      } else {
        toast.error('Failed to move schedule');
      }
    }
  };

  const handleForceRelocate = (reason: string) => {
    if (!relocateConflictData) return;
    const { scheduleId, newDate, newStart, newEnd } = relocateConflictData;
    handleRelocate(scheduleId, newDate, newStart, newEnd, true, reason);
  };

  const handleBulkComplete = () => {
    clearSelection();
    fetchSchedules();
    fetchActivities();
  };

  return (
    <div className="space-y-5 animate-slide-in" data-testid="calendar-view">
      <div data-testid="calendar-home-header">
        <PageHeader
          breadcrumbs={[{ label: 'Planning' }, { label: 'Calendar' }]}
          title="Scheduling Calendar"
          subtitle="Your main planning view — focused on classes, travel time, and weekly flow."
        />
        {(schedules || []).length === 0 && (
          <div className="bg-white dark:bg-card border border-border rounded-lg p-6 space-y-4" data-testid="empty-state-guide">
            <h3 className="text-lg font-semibold text-foreground">Get started with scheduling</h3>
            <p className="text-sm text-foreground/80 dark:text-muted-foreground">Before you can schedule classes, make sure you have the basics set up:</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Link to="/locations" className={cn(
                'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                (locations || []).length > 0
                  ? 'border-spoke/30 bg-spoke-soft dark:border-spoke/30'
                  : 'border-warn-soft bg-warn-soft/20 dark:border-warn-soft hover:bg-warn-soft dark:hover:bg-warn-soft/40'
              )}>
                <MapPin className={cn('w-5 h-5 shrink-0', (locations || []).length > 0 ? 'text-spoke-strong' : 'text-warn-strong')} />
                <div>
                  <p className="text-sm font-medium text-foreground">Locations</p>
                  <p className="text-xs text-foreground/80 dark:text-muted-foreground">{(locations || []).length > 0 ? `${locations.length} added` : 'Add your hub & spoke cities'}</p>
                </div>
              </Link>
              <Link to="/employees" className={cn(
                'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                (employees || []).length > 0
                  ? 'border-spoke/30 bg-spoke-soft dark:border-spoke/30'
                  : 'border-warn-soft bg-warn-soft/20 dark:border-warn-soft hover:bg-warn-soft dark:hover:bg-warn-soft/40'
              )}>
                <Users className={cn('w-5 h-5 shrink-0', (employees || []).length > 0 ? 'text-spoke-strong' : 'text-warn-strong')} />
                <div>
                  <p className="text-sm font-medium text-foreground">Employees</p>
                  <p className="text-xs text-foreground/80 dark:text-muted-foreground">{(employees || []).length > 0 ? `${employees.length} added` : 'Add your instructors'}</p>
                </div>
              </Link>
              <Link to="/classes" className={cn(
                'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                (classes || []).length > 0
                  ? 'border-spoke/30 bg-spoke-soft dark:border-spoke/30'
                  : 'border-warn-soft bg-warn-soft/20 dark:border-warn-soft hover:bg-warn-soft dark:hover:bg-warn-soft/40'
              )}>
                <BookOpen className={cn('w-5 h-5 shrink-0', (classes || []).length > 0 ? 'text-spoke-strong' : 'text-warn-strong')} />
                <div>
                  <p className="text-sm font-medium text-foreground">Classes</p>
                  <p className="text-xs text-foreground/80 dark:text-muted-foreground">{(classes || []).length > 0 ? `${classes.length} added` : 'Define your class types'}</p>
                </div>
              </Link>
            </div>
            {(locations || []).length > 0 && (employees || []).length > 0 && (classes || []).length > 0 && (
              <p className="text-sm text-hub-strong font-medium">
                All set! Click "New Schedule" in the sidebar to create your first class assignment.
              </p>
            )}
          </div>
        )}
        {(schedules || []).length > 0 && filteredSchedules.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="schedule-count">
            {filteredSchedules.length} of {rawStats?.total_schedules ?? (schedules || []).length} schedules in view — showing {calendarView} view
          </p>
        )}
        {(schedules || []).length > 0 && filteredSchedules.length === 0 && (
          <output
            data-testid="calendar-filtered-empty"
            className="bg-white dark:bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-4 w-full"
          >
            <p className="text-sm text-foreground/80 dark:text-muted-foreground">
              No schedules match the current filters.
            </p>
            {(filterEmployee !== 'all' || filterLocation !== 'all' || filterClass !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  // Only drop the filter params — `view` and `date` drive
                  // the visible calendar position, keep them intact.
                  setSearchParams(prev => {
                    const next = new URLSearchParams(prev);
                    next.delete('employee');
                    next.delete('location');
                    next.delete('class');
                    return next;
                  });
                }}
                className="text-sm font-medium text-hub hover:text-hub-strong"
                data-testid="calendar-clear-filters"
              >
                Clear filters
              </button>
            )}
          </output>
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
        filterClass={filterClass}
        setFilterClass={setFilterClass}
        employees={employees}
        locations={locations}
        classes={classes}
      />

      {fetchErrors?.schedules && (
        <div className="bg-danger-soft border border-danger/30 rounded-lg p-3 flex items-center justify-between" data-testid="schedule-fetch-error" role="alert">
          <p className="text-sm text-danger-strong">Failed to load schedules: {fetchErrors.schedules}. Data may be outdated.</p>
          <button type="button" onClick={() => fetchSchedules()} className="text-sm font-medium text-danger-strong hover:underline">Retry</button>
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
          <div className="w-4 h-4 rounded bg-hub" />
          <span className="text-xs text-foreground/80 dark:text-muted-foreground">Class Time</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-muted border border-dashed border-border" />
          <span className="text-xs text-foreground/80 dark:text-muted-foreground">Drive Time</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-warn-soft border border-warn-soft" />
          <span className="text-xs text-foreground/80 dark:text-muted-foreground">Town-to-Town Warning</span>
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
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {importOpen && (
        <Suspense fallback={null}>
          <ImportCsvDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            onImportSuccess={() => {
              fetchSchedules();
              fetchActivities?.();
            }}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <RelocateConflictDialog
          data={relocateConflictData}
          onClose={() => setRelocateConflictData(null)}
          onForce={handleForceRelocate}
        />
      </Suspense>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { format, startOfWeek, endOfWeek, subWeeks, addWeeks } from 'date-fns';
import { reportsAPI } from '../lib/api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { SkeletonChart } from './ui/skeleton';
import { FileDown, ChevronLeft, ChevronRight, Clock, Car, MapPin, BookOpen, Users, Printer } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_CLASSES = {
  completed: 'bg-spoke-soft text-spoke',
  in_progress: 'bg-warn-soft text-warn',
};

import { useOutletContext } from 'react-router-dom';
import { EntityLink } from './ui/entity-link';

interface WeeklyReportProps {
  classes?: unknown[];
}

export default function WeeklyReport(props: Readonly<WeeklyReportProps>) {
  const outlet = useOutletContext<Record<string, unknown>>() ?? {};
  const classes = props.classes ?? outlet.classes;
  const [weekDate, setWeekDate] = useState(new Date());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState('all');
  const reportRef = useRef(null);

  const weekStart = startOfWeek(weekDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekDate, { weekStartsOn: 1 });
  const dateFrom = format(weekStart, 'yyyy-MM-dd');
  const dateTo = format(weekEnd, 'yyyy-MM-dd');

  useEffect(() => {
    setLoading(true);
    setError(false);
    reportsAPI.weeklySummary({
      date_from: dateFrom,
      date_to: dateTo,
      class_id: selectedClassId === 'all' ? undefined : selectedClassId,
    })
      .then((res) => { setReport(res.data); setError(false); })
      .catch(() => { setReport(null); setError(true); toast.error('Failed to load report'); })
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, selectedClassId]);

  const exportPDF = async () => {
    if (!reportRef.current) return;
    toast.info('Generating PDF...');
    try {
      const [html2canvas, { jsPDF }] = await Promise.all([
        import('html2canvas').then(m => m.default),
        import('jspdf')
      ]);

      const canvas = await html2canvas(reportRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('portrait', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, Math.min(pdfHeight, pdf.internal.pageSize.getHeight()));
      pdf.save(`weekly-summary-${format(weekStart, 'yyyy-MM-dd')}.pdf`);
      toast.success('PDF exported');
    } catch (err) {
      console.error(err);
      toast.error('Export failed');
    }
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="weekly-report">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground font-display">Weekly Summary</h2>
          <p className="text-sm text-foreground/80 dark:text-muted-foreground mt-1" data-testid="weekly-report-subtitle">Report for the week, grouped by class and employee.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setWeekDate((date) => subWeeks(date, 1))} data-testid="report-prev" aria-label="Previous week">
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </Button>
          <span className="text-sm font-medium text-foreground min-w-[180px] text-center">
            {format(weekStart, 'MMM d')} — {format(weekEnd, 'MMM d, yyyy')}
          </span>
          <Button variant="outline" size="sm" onClick={() => setWeekDate((date) => addWeeks(date, 1))} data-testid="report-next" aria-label="Next week">
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF} data-testid="report-export-pdf">
            <FileDown className="w-4 h-4 mr-1" /> Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => globalThis.print()} className="no-print" data-testid="report-print">
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      <div className="max-w-[280px] space-y-2">
        <Label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground" htmlFor="report-class-filter">Filter by Class</Label>
        <Select value={selectedClassId} onValueChange={setSelectedClassId}>
          <SelectTrigger id="report-class-filter" className="bg-white dark:bg-card" data-testid="report-class-filter">
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {(classes || []).map((classItem) => (
              <SelectItem key={classItem.id} value={classItem.id}>{classItem.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && (
        <div data-testid="weekly-report-loading-state">
          <SkeletonChart />
        </div>
      )}

      {error && !loading && (
        <div className="text-center py-12 text-foreground/80 dark:text-muted-foreground">
          <p className="text-sm">Failed to load report. Please try again.</p>
        </div>
      )}

      {report && !loading && !error && (
        <div ref={reportRef} className="space-y-6 bg-white dark:bg-card rounded-lg border border-border p-6">
          <div className="border-b border-border pb-4 mb-2">
            <h3 className="text-lg font-bold text-foreground font-display">
              Weekly Summary: {format(weekStart, 'MMM d')} — {format(weekEnd, 'MMM d, yyyy')}
            </h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-hub-soft rounded-lg p-4 text-center">
              <BookOpen className="w-5 h-5 text-hub mx-auto mb-1" aria-hidden="true" />
              <p className="text-2xl font-bold text-hub-strong font-display">{report.totals.classes}</p>
              <p className="text-xs text-hub-strong">Total Classes</p>
            </div>
            <div className="bg-spoke-soft rounded-lg p-4 text-center">
              <Clock className="w-5 h-5 text-spoke mx-auto mb-1" aria-hidden="true" />
              <p className="text-2xl font-bold text-spoke font-display">{report.totals.class_hours}h</p>
              <p className="text-xs text-spoke">Class Hours</p>
            </div>
            <div className="bg-warn-soft rounded-lg p-4 text-center">
              <Car className="w-5 h-5 text-warn mx-auto mb-1" aria-hidden="true" />
              <p className="text-2xl font-bold text-warn font-display">{report.totals.drive_hours}h</p>
              <p className="text-xs text-warn">Drive Hours</p>
            </div>
            <div className="bg-violet-50 rounded-lg p-4 text-center">
              <Users className="w-5 h-5 text-violet-600 mx-auto mb-1" aria-hidden="true" />
              <p className="text-2xl font-bold text-violet-700 font-display">{report.totals.employees_active}</p>
              <p className="text-xs text-violet-700">Active Employees</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" data-testid="report-class-totals">
            {(report.class_totals || []).map((classItem) => (
              <Badge
                key={classItem.class_id || classItem.class_name}
                className="border-0 text-xs"
                style={{ backgroundColor: `${classItem.class_color}20`, color: classItem.class_color }}
                data-testid={`report-class-chip-${classItem.class_id || classItem.class_name}`}
              >
                {classItem.class_name}: {classItem.classes}
              </Badge>
            ))}
          </div>

          {(report.employees || []).map((emp) => (
            <div key={emp.employee_name} className="border border-border rounded-lg p-4" data-testid={`report-employee-${emp.employee_name}`}>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: emp.employee_color }}>
                    {emp.employee_name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <EntityLink type="employee" id={emp.employee_id} className="font-semibold text-foreground">{emp.employee_name}</EntityLink>
                    <p className="text-xs text-muted-foreground">{emp.days_worked} day{emp.days_worked === 1 ? '' : 's'} worked</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge className="bg-hub-soft text-hub-strong border-0 text-[10px]">{emp.classes} classes</Badge>
                  <Badge className="bg-spoke-soft text-spoke border-0 text-[10px]">{emp.class_hours}h class</Badge>
                  <Badge className="bg-warn-soft text-warn border-0 text-[10px]">{emp.drive_hours}h drive</Badge>
                  <Badge className="bg-spoke-soft text-spoke border-0 text-[10px]">{emp.completed} done</Badge>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mb-3" data-testid={`report-employee-class-breakdown-${emp.employee_name}`}>
                {(emp.class_breakdown || []).map((classItem) => (
                  <Badge
                    key={classItem.class_id || classItem.class_name}
                    className="border-0 text-[10px]"
                    style={{ backgroundColor: `${classItem.class_color}20`, color: classItem.class_color }}
                  >
                    {classItem.class_name}: {classItem.classes}
                  </Badge>
                ))}
              </div>

              {/* Responsive layout: below md, each schedule renders as a
                  stacked card with inline labels. From md up, the grid
                  header + row pattern matches the previous design. */}
              <div className="bg-muted/50 dark:bg-muted/50 rounded-lg overflow-hidden">
                <div className="hidden md:grid grid-cols-6 gap-px bg-muted text-[11px] font-semibold text-foreground/80 dark:text-muted-foreground uppercase tracking-wider">
                  <div className="bg-muted/50 dark:bg-muted px-3 py-2">Date</div>
                  <div className="bg-muted/50 dark:bg-muted px-3 py-2">Class</div>
                  <div className="bg-muted/50 dark:bg-muted px-3 py-2">Location</div>
                  <div className="bg-muted/50 dark:bg-muted px-3 py-2">Time</div>
                  <div className="bg-muted/50 dark:bg-muted px-3 py-2">Drive</div>
                  <div className="bg-muted/50 dark:bg-muted px-3 py-2">Status</div>
                </div>
                {(emp.schedule_details || []).map((scheduleDetail) => (
                  <div
                    key={`${scheduleDetail.date}-${scheduleDetail.class_name}-${scheduleDetail.location}`}
                    className="block border-b border-border last:border-b-0 bg-white dark:bg-card md:bg-transparent dark:md:bg-transparent md:border-0 md:grid md:grid-cols-6 md:gap-px md:bg-muted dark:md:bg-muted text-xs p-3 md:p-0 space-y-1 md:space-y-0"
                  >
                    <div className="md:bg-card dark:md:bg-card md:px-3 md:py-2 text-foreground flex items-baseline gap-2 md:block">
                      <span className="md:hidden text-[10px] font-semibold uppercase text-muted-foreground">Date</span>
                      <span>{scheduleDetail.date}</span>
                    </div>
                    <div className="md:bg-card dark:md:bg-card md:px-3 md:py-2 flex items-baseline gap-2 md:block">
                      <span className="md:hidden text-[10px] font-semibold uppercase text-muted-foreground">Class</span>
                      <Badge className="border-0 text-[10px]" style={{ backgroundColor: `${scheduleDetail.class_color}20`, color: scheduleDetail.class_color }}>
                        {scheduleDetail.class_name}
                      </Badge>
                    </div>
                    <div className="md:bg-card dark:md:bg-card md:px-3 md:py-2 text-foreground flex items-baseline gap-2 md:items-center md:gap-1">
                      <span className="md:hidden text-[10px] font-semibold uppercase text-muted-foreground">Location</span>
                      <MapPin className="w-3 h-3 text-muted-foreground hidden md:inline" aria-hidden="true" />
                      <EntityLink type="location" id={scheduleDetail.location_id} className="text-foreground">{scheduleDetail.location}</EntityLink>
                    </div>
                    <div className="md:bg-card dark:md:bg-card md:px-3 md:py-2 text-foreground flex items-baseline gap-2 md:block">
                      <span className="md:hidden text-[10px] font-semibold uppercase text-muted-foreground">Time</span>
                      <span>{scheduleDetail.time}</span>
                    </div>
                    <div className="md:bg-card dark:md:bg-card md:px-3 md:py-2 text-foreground/80 dark:text-muted-foreground flex items-baseline gap-2 md:block">
                      <span className="md:hidden text-[10px] font-semibold uppercase text-muted-foreground">Drive</span>
                      <span>{scheduleDetail.drive_minutes}m x2</span>
                    </div>
                    <div className="md:bg-card dark:md:bg-card md:px-3 md:py-2 flex items-baseline gap-2 md:block">
                      <span className="md:hidden text-[10px] font-semibold uppercase text-muted-foreground">Status</span>
                      <Badge className={`border-0 text-[10px] ${STATUS_CLASSES[scheduleDetail.status] || 'bg-hub-soft text-hub-strong'}`}>{scheduleDetail.status.replace('_', ' ')}</Badge>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-4 mt-3 text-xs text-foreground/80 dark:text-muted-foreground">
                <span>Locations: {(emp.locations_visited || []).join(', ')}</span>
              </div>
            </div>
          ))}

          {(!report.employees || report.employees.length === 0) && (
            <div className="text-center py-12 text-muted-foreground" data-testid="weekly-report-empty-state">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No classes scheduled for this week</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


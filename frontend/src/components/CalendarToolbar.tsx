import { format } from 'date-fns';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight, FileDown, ListChecks, Download, Upload, Printer } from 'lucide-react';

interface CalendarToolbarProps {
  isMobile: boolean;
  calendarView: string;
  currentDate: Date;
  isAdmin: boolean;
  selectionMode: boolean;
  onNavigate: (direction: 'prev' | 'next') => void;
  onToday: () => void;
  onViewChange: (view: string) => void;
  onToggleSelection: () => void;
  onExportCsv: () => void;
  onImportCsv: () => void;
  onExportPdf: () => void;
  onPrint: () => void;
}

export default function CalendarToolbar({
  isMobile,
  calendarView,
  currentDate,
  isAdmin,
  selectionMode,
  onNavigate,
  onToday,
  onViewChange,
  onToggleSelection,
  onExportCsv,
  onImportCsv,
  onExportPdf,
  onPrint,
}: Readonly<CalendarToolbarProps>) {
  const dateLabel = (() => {
    if (calendarView === 'month') return format(currentDate, 'MMMM yyyy');
    if (calendarView === 'day') return format(currentDate, 'MMMM d, yyyy');
    return `Week of ${format(currentDate, 'MMM d, yyyy')}`;
  })();

  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      {!isMobile && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            data-testid="calendar-prev"
            onClick={() => onNavigate('prev')}
            className="border-gray-200"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <h2 className="text-xl font-bold text-slate-800 min-w-[200px] text-center" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {dateLabel}
          </h2>
          <Button
            variant="outline"
            size="sm"
            data-testid="calendar-next"
            onClick={() => onNavigate('next')}
            className="border-gray-200"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="calendar-today"
            onClick={onToday}
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
            onClick={onToggleSelection}
            className={selectionMode ? '' : 'border-gray-200'}
          >
            <ListChecks className="w-4 h-4 mr-1" />
            Select
          </Button>
        )}
        {!isMobile && (
          <Tabs value={calendarView} onValueChange={onViewChange}>
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
              onClick={onExportCsv}
              className="border-gray-200"
              disabled={selectionMode}
            >
              <Download className="w-4 h-4 mr-1" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onImportCsv}
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
          onClick={onExportPdf}
          className="border-gray-200"
        >
          <FileDown className="w-4 h-4 mr-1" />
          PDF
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="print-btn"
          onClick={onPrint}
          className="border-gray-200 no-print"
        >
          <Printer className="w-4 h-4 mr-1" />
          Print
        </Button>
      </div>
    </div>
  );
}

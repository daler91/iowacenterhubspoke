import { format } from 'date-fns';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
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
            aria-label="Previous period"
            className="border-border"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </Button>
          <h2 className="text-xl font-bold text-foreground min-w-[200px] text-center">
            {dateLabel}
          </h2>
          <Button
            variant="outline"
            size="sm"
            data-testid="calendar-next"
            onClick={() => onNavigate('next')}
            aria-label="Next period"
            className="border-border"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="calendar-today"
            onClick={onToday}
            className="border-border text-sm"
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
            className={selectionMode ? '' : 'border-border'}
          >
            <ListChecks className="w-4 h-4 mr-1" />
            Select
          </Button>
        )}
        {!isMobile && (
          <ToggleGroup
            type="single"
            value={calendarView}
            onValueChange={v => v && onViewChange(v)}
            aria-label="Calendar view"
            className="bg-muted rounded-lg p-0.5"
          >
            <ToggleGroupItem value="day" data-testid="view-day" className="text-xs px-3 py-1 h-7 data-[state=on]:bg-white dark:data-[state=on]:bg-muted data-[state=on]:shadow">Day</ToggleGroupItem>
            <ToggleGroupItem value="week" data-testid="view-week" className="text-xs px-3 py-1 h-7 data-[state=on]:bg-white dark:data-[state=on]:bg-muted data-[state=on]:shadow">Week</ToggleGroupItem>
            <ToggleGroupItem value="month" data-testid="view-month" className="text-xs px-3 py-1 h-7 data-[state=on]:bg-white dark:data-[state=on]:bg-muted data-[state=on]:shadow">Month</ToggleGroupItem>
          </ToggleGroup>
        )}
        {isAdmin && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onExportCsv}
              className="border-border"
              disabled={selectionMode}
            >
              <Download className="w-4 h-4 mr-1" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onImportCsv}
              className="border-border"
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
          className="border-border"
        >
          <FileDown className="w-4 h-4 mr-1" />
          PDF
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="print-btn"
          onClick={onPrint}
          className="border-border no-print"
        >
          <Printer className="w-4 h-4 mr-1" />
          Print
        </Button>
      </div>
    </div>
  );
}

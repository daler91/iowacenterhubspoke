const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;

interface CalendarDateParts {
  year: number;
  monthIndex: number;
  day: number;
  key: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isValidCalendarDate(year: number, monthIndex: number, day: number): boolean {
  const date = new Date(year, monthIndex, day);
  return (
    date.getFullYear() === year
    && date.getMonth() === monthIndex
    && date.getDate() === day
  );
}

function parseCalendarDateParts(value: string | null | undefined): CalendarDateParts | null {
  if (!value) return null;

  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);

  if (!isValidCalendarDate(year, monthIndex, day)) return null;

  return {
    year,
    monthIndex,
    day,
    key: `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`,
  };
}

export function getCalendarDateKey(value: string | null | undefined): string | null {
  return parseCalendarDateParts(value)?.key ?? null;
}

export function getLocalCalendarDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isPastCalendarDate(value: string | null | undefined, today: Date = new Date()): boolean {
  const calendarDateKey = getCalendarDateKey(value);
  if (!calendarDateKey) return false;
  return calendarDateKey < getLocalCalendarDateKey(today);
}

export function formatCalendarDate(
  value: string | null | undefined,
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return '';

  const calendarDate = parseCalendarDateParts(value);
  if (calendarDate) {
    return new Date(calendarDate.year, calendarDate.monthIndex, calendarDate.day)
      .toLocaleDateString(locales, options);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(locales, options);
}

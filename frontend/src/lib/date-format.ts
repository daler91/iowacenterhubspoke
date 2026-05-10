const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;

function isValidCalendarDate(year: number, monthIndex: number, day: number): boolean {
  const date = new Date(year, monthIndex, day);
  return (
    date.getFullYear() === year
    && date.getMonth() === monthIndex
    && date.getDate() === day
  );
}

export function formatCalendarDate(
  value: string | null | undefined,
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return '';

  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (match) {
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);

    if (isValidCalendarDate(year, monthIndex, day)) {
      return new Date(year, monthIndex, day).toLocaleDateString(locales, options);
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(locales, options);
}

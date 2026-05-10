import {
  formatCalendarDate,
  getCalendarDateKey,
  getLocalCalendarDateKey,
  isPastCalendarDate,
} from './date-format';

describe('formatCalendarDate', () => {
  it('formats a UTC-midnight ISO datetime without shifting the calendar day', () => {
    expect(formatCalendarDate('2026-05-21T00:00:00.000Z', 'en-US')).toBe('5/21/2026');
  });

  it('formats a UTC-midnight task due date without shifting the calendar day', () => {
    expect(formatCalendarDate('2026-05-01T00:00:00.000Z', 'en-US')).toBe('5/1/2026');
  });

  it('formats an ISO date-only value as the same calendar day', () => {
    expect(formatCalendarDate('2026-05-21', 'en-US')).toBe('5/21/2026');
  });

  it('builds calendar date keys without UTC conversion', () => {
    expect(getCalendarDateKey('2026-05-01T00:00:00.000Z')).toBe('2026-05-01');
    expect(getCalendarDateKey('2026-05-01')).toBe('2026-05-01');
    expect(getLocalCalendarDateKey(new Date(2026, 4, 1, 23, 59))).toBe('2026-05-01');
  });

  it('treats a due date as past only after its calendar day', () => {
    expect(isPastCalendarDate('2026-05-01T00:00:00.000Z', new Date(2026, 4, 1, 12))).toBe(false);
    expect(isPastCalendarDate('2026-05-01T00:00:00.000Z', new Date(2026, 4, 2, 12))).toBe(true);
  });

  it('does not throw for missing or malformed values', () => {
    expect(formatCalendarDate(null)).toBe('');
    expect(formatCalendarDate(undefined)).toBe('');
    expect(formatCalendarDate('not-a-date')).toBe('not-a-date');
    expect(formatCalendarDate('2026-05-21oops')).toBe('2026-05-21oops');
    expect(getCalendarDateKey('not-a-date')).toBeNull();
    expect(isPastCalendarDate('not-a-date', new Date(2026, 4, 2, 12))).toBe(false);
  });
});

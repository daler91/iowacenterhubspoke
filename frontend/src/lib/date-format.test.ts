import { formatCalendarDate } from './date-format';

describe('formatCalendarDate', () => {
  it('formats a UTC-midnight ISO datetime without shifting the calendar day', () => {
    expect(formatCalendarDate('2026-05-21T00:00:00.000Z', 'en-US')).toBe('5/21/2026');
  });

  it('formats an ISO date-only value as the same calendar day', () => {
    expect(formatCalendarDate('2026-05-21', 'en-US')).toBe('5/21/2026');
  });

  it('does not throw for missing or malformed values', () => {
    expect(formatCalendarDate(null)).toBe('');
    expect(formatCalendarDate(undefined)).toBe('');
    expect(formatCalendarDate('not-a-date')).toBe('not-a-date');
    expect(formatCalendarDate('2026-05-21oops')).toBe('2026-05-21oops');
  });
});

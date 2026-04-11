/**
 * Unit tests for the pure layout helpers in ``components/calendar/layout``.
 *
 * The overlap algorithm used to be duplicated between ``CalendarWeek.tsx``
 * and ``CalendarDay.tsx`` with zero test coverage. These tests pin down the
 * contract so future refactors can't silently shift column assignments.
 */

import {
  computeOverlapLayout,
  createScaleHelpers,
  formatHourLabel,
  minutesToTimeStr,
  timeToMinutes,
} from './layout';

describe('formatHourLabel', () => {
  it.each([
    [0, '12 AM'],
    [1, '1 AM'],
    [11, '11 AM'],
    [12, '12 PM'],
    [13, '1 PM'],
    [23, '11 PM'],
  ])('%i → %s', (hour, expected) => {
    expect(formatHourLabel(hour)).toBe(expected);
  });
});

describe('timeToMinutes / minutesToTimeStr', () => {
  it('parses HH:MM into minutes since midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('inverts back to zero-padded HH:MM', () => {
    expect(minutesToTimeStr(0)).toBe('00:00');
    expect(minutesToTimeStr(570)).toBe('09:30');
    expect(minutesToTimeStr(1439)).toBe('23:59');
  });

  it('roundtrips', () => {
    for (const s of ['00:00', '06:15', '09:45', '12:00', '17:30', '23:59']) {
      expect(minutesToTimeStr(timeToMinutes(s))).toBe(s);
    }
  });
});

describe('createScaleHelpers', () => {
  it('places the START_HOUR at pixel 0', () => {
    // START_HOUR is 6am per CALENDAR constants.
    const { minutesToTop } = createScaleHelpers(60);
    expect(minutesToTop(6 * 60)).toBe(0);
  });

  it('converts hours to the configured pixel scale', () => {
    const { minutesToTop } = createScaleHelpers(60);
    expect(minutesToTop(7 * 60)).toBe(60);
    expect(minutesToTop(12 * 60)).toBe(6 * 60);
  });

  it('snaps drag y-offsets to the nearest 30-minute slot', () => {
    // PX_PER_HOUR = 60, so 30 minutes = 30 pixels.
    const { snapYToMinutes } = createScaleHelpers(60);
    expect(snapYToMinutes(0)).toBe(6 * 60);
    expect(snapYToMinutes(10)).toBe(6 * 60); // rounds down to 6:00
    expect(snapYToMinutes(20)).toBe(6 * 60 + 30); // rounds up to 6:30
    expect(snapYToMinutes(60)).toBe(7 * 60); // exactly 7:00
  });

  it('clamps negative drag positions to midnight (the Math.max floor)', () => {
    // The function's floor is literally ``Math.max(0, ...)``, so any drag
    // far enough above the calendar grid just pins to 0 minutes since
    // midnight. Pins this behavior so a future refactor doesn't silently
    // change it to a different floor (e.g. START_HOUR * 60).
    const { snapYToMinutes } = createScaleHelpers(60);
    expect(snapYToMinutes(-500)).toBe(0);
  });
});

describe('computeOverlapLayout', () => {
  it('returns a single-column layout for an empty list', () => {
    expect(computeOverlapLayout([])).toEqual({});
  });

  it('returns a single-column layout for a single item', () => {
    const result = computeOverlapLayout([
      { id: 'a', start_time: '09:00', end_time: '10:00' },
    ]);
    expect(result).toEqual({ a: { column: 0, totalColumns: 1 } });
  });

  it('places non-overlapping items all in column 0', () => {
    const result = computeOverlapLayout([
      { id: 'a', start_time: '09:00', end_time: '10:00' },
      { id: 'b', start_time: '11:00', end_time: '12:00' },
      { id: 'c', start_time: '13:00', end_time: '14:00' },
    ]);
    expect(result.a).toEqual({ column: 0, totalColumns: 1 });
    expect(result.b).toEqual({ column: 0, totalColumns: 1 });
    expect(result.c).toEqual({ column: 0, totalColumns: 1 });
  });

  it('splits two overlapping items across two columns', () => {
    const result = computeOverlapLayout([
      { id: 'a', start_time: '09:00', end_time: '10:30' },
      { id: 'b', start_time: '09:30', end_time: '11:00' },
    ]);
    expect(result.a.column).toBe(0);
    expect(result.b.column).toBe(1);
    expect(result.a.totalColumns).toBe(2);
    expect(result.b.totalColumns).toBe(2);
  });

  it('reuses a column once its last item has ended', () => {
    // 09:00-10:00 ends before 10:00-11:00 begins; both can live in column 0.
    const result = computeOverlapLayout([
      { id: 'a', start_time: '09:00', end_time: '10:00' },
      { id: 'b', start_time: '10:00', end_time: '11:00' },
    ]);
    expect(result.a.column).toBe(0);
    expect(result.b.column).toBe(0);
    expect(result.a.totalColumns).toBe(1);
    expect(result.b.totalColumns).toBe(1);
  });

  it('computes totalColumns for three mutually-overlapping items', () => {
    const result = computeOverlapLayout([
      { id: 'a', start_time: '09:00', end_time: '12:00' },
      { id: 'b', start_time: '09:30', end_time: '11:30' },
      { id: 'c', start_time: '10:00', end_time: '11:00' },
    ]);
    for (const id of ['a', 'b', 'c']) {
      expect(result[id].totalColumns).toBe(3);
    }
    // Columns are 0, 1, 2 (order depends on the packing algorithm; just
    // assert all three are distinct).
    const cols = new Set([result.a.column, result.b.column, result.c.column]);
    expect(cols.size).toBe(3);
  });

  it('tolerates an item whose start equals another item\'s end (no overlap)', () => {
    // 09:00-10:00 and 10:00-11:00 touch but do not overlap — they should
    // share column 0 because the first ends before the second starts.
    const result = computeOverlapLayout([
      { id: 'a', start_time: '09:00', end_time: '10:00' },
      { id: 'b', start_time: '10:00', end_time: '11:00' },
    ]);
    expect(result.a.column).toBe(0);
    expect(result.b.column).toBe(0);
    expect(result.a.totalColumns).toBe(1);
  });
});

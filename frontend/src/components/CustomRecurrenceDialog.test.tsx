import { createDefaultCustomRecurrence } from './CustomRecurrenceDialog';

describe('createDefaultCustomRecurrence', () => {
  it('should create default recurrence for a Sunday (2023-10-01)', () => {
    const dateStr = '2023-10-01';
    const result = createDefaultCustomRecurrence(dateStr);

    expect(result).toEqual({
      interval: '1',
      frequency: 'week',
      weekdays: [0], // Sunday
      end_mode: 'never',
      end_date: '',
      occurrences: '12',
    });
  });

  it('should create default recurrence for a Monday (2023-10-02)', () => {
    const dateStr = '2023-10-02';
    const result = createDefaultCustomRecurrence(dateStr);

    expect(result).toEqual({
      interval: '1',
      frequency: 'week',
      weekdays: [1], // Monday
      end_mode: 'never',
      end_date: '',
      occurrences: '12',
    });
  });

  it('should handle different dates correctly', () => {
    expect(createDefaultCustomRecurrence('2023-10-03').weekdays).toEqual([2]); // Tuesday
    expect(createDefaultCustomRecurrence('2023-10-04').weekdays).toEqual([3]); // Wednesday
    expect(createDefaultCustomRecurrence('2023-10-05').weekdays).toEqual([4]); // Thursday
    expect(createDefaultCustomRecurrence('2023-10-06').weekdays).toEqual([5]); // Friday
    expect(createDefaultCustomRecurrence('2023-10-07').weekdays).toEqual([6]); // Saturday
  });
});

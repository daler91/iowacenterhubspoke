import { buildSchedulePayload } from './useScheduleForm';

describe('buildSchedulePayload', () => {
  const baseForm = {
    employee_ids: ['emp-1'],
    class_id: 'class-1',
    location_id: 'loc-1',
    date: '2026-01-01',
    start_time: '09:00',
    end_time: '10:00',
    notes: '',
    drive_to_override_minutes: null,
    drive_from_override_minutes: null,
    recurrence: 'none',
    recurrence_end_mode: 'never',
    recurrence_end_date: '',
    recurrence_occurrences: '',
  };

  const customRecurrence = {
    interval: '1', frequency: 'week', weekdays: [1], end_mode: 'never', end_date: '', occurrences: '',
  };

  it('builds single payload when recurrence is none', () => {
    const payload = buildSchedulePayload({ ...baseForm }, customRecurrence);
    expect(payload.recurrence).toBeNull();
    expect(payload.custom_recurrence).toBeNull();
  });

  it('builds recurring payload for custom recurrence', () => {
    const payload = buildSchedulePayload({ ...baseForm, recurrence: 'custom' }, { ...customRecurrence, end_mode: 'after_occurrences', occurrences: '3' });
    expect(payload.recurrence).toBe('custom');
    expect(payload.recurrence_occurrences).toBe(3);
    expect(payload.custom_recurrence).toEqual(expect.objectContaining({ frequency: 'week', occurrences: 3 }));
  });
});

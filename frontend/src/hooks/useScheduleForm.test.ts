import { renderHook, act } from '@testing-library/react';
import { useScheduleForm } from './useScheduleForm';
import { schedulesAPI } from '../lib/api';
import { toast } from 'sonner';

jest.mock('../lib/api', () => ({
  schedulesAPI: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    checkConflicts: jest.fn(),
  },
}));

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
  },
}));

describe('useScheduleForm Error Handling', () => {
  const mockOnSaved = jest.fn();
  const mockOnOpenChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validFormState = {
    employee_ids: ['emp-1'],
    location_id: 'loc-1',
    date: '2025-01-01',
    start_time: '09:00',
    end_time: '10:00',
    class_id: 'class-1',
    recurrence: 'none',
  };

  it('handles 409 error with outlook conflicts only', async () => {
    const errorResponse = {
      response: {
        status: 409,
        data: {
          detail: {
            outlook_conflicts: [{ message: 'Busy in Outlook' }],
            conflicts: [],
          },
        },
      },
    };
    schedulesAPI.create.mockRejectedValueOnce(errorResponse);

    const { result } = renderHook(() =>
      useScheduleForm({ open: true, editSchedule: null, onSaved: mockOnSaved, onOpenChange: mockOnOpenChange })
    );

    act(() => {
      result.current.setForm((prev) => ({ ...prev, ...validFormState }));
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: jest.fn() });
    });

    expect(result.current.outlookOverride).toBe(true);
    expect(toast.warning).toHaveBeenCalledWith(
      'Employee has Outlook conflicts. Click "Schedule anyway" to override.',
      { duration: 6000 }
    );
    expect(result.current.loading).toBe(false);
  });

  it('handles 409 error with internal conflicts', async () => {
    const errorResponse = {
      response: {
        status: 409,
        data: {
          detail: {
            message: 'Schedule conflict detected',
            outlook_conflicts: [],
            conflicts: [{ location: 'Studio A', time: '09:00-10:00' }],
          },
        },
      },
    };
    schedulesAPI.create.mockRejectedValueOnce(errorResponse);

    const { result } = renderHook(() =>
      useScheduleForm({ open: true, editSchedule: null, onSaved: mockOnSaved, onOpenChange: mockOnOpenChange })
    );

    act(() => {
      result.current.setForm((prev) => ({ ...prev, ...validFormState }));
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: jest.fn() });
    });

    expect(result.current.outlookOverride).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      'Schedule conflict detected: Studio A (09:00-10:00)',
      { duration: 8000 }
    );
    expect(result.current.loading).toBe(false);
  });

  it('handles generic error on create', async () => {
    const errorResponse = {
      response: {
        status: 500,
        data: {
          detail: 'Internal Server Error',
        },
      },
    };
    schedulesAPI.create.mockRejectedValueOnce(errorResponse);

    const { result } = renderHook(() =>
      useScheduleForm({ open: true, editSchedule: null, onSaved: mockOnSaved, onOpenChange: mockOnOpenChange })
    );

    act(() => {
      result.current.setForm((prev) => ({ ...prev, ...validFormState }));
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: jest.fn() });
    });

    expect(toast.error).toHaveBeenCalledWith('Internal Server Error');
    expect(result.current.loading).toBe(false);
  });
});

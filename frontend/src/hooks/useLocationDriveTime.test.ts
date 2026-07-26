import { act, renderHook } from '@testing-library/react';
import { useLocationDriveTime } from './useLocationDriveTime';
import { locationsAPI } from '../lib/api';
import { toast } from 'sonner';

jest.mock('../lib/api', () => ({
  locationsAPI: { getDriveTimeFromHub: jest.fn() },
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useLocationDriveTime', () => {
  it('fills drive time from the hub lookup', async () => {
    const setForm = jest.fn();
    (locationsAPI.getDriveTimeFromHub as jest.Mock).mockResolvedValue({
      data: { drive_time_minutes: 38 },
    });

    const { result } = renderHook(() => useLocationDriveTime(setForm));

    await act(async () => {
      await expect(result.current.autoFillDriveTime(41.5868, -93.654)).resolves.toBe(true);
    });

    expect(locationsAPI.getDriveTimeFromHub).toHaveBeenCalledWith(41.5868, -93.654);
    expect(setForm).toHaveBeenCalledWith(expect.any(Function));
    const updater = setForm.mock.calls[0][0];
    expect(updater({ address: '', city_name: '', drive_time_minutes: '', latitude: '', longitude: '' }))
      .toEqual({ address: '', city_name: '', drive_time_minutes: '38', latitude: '', longitude: '' });
    expect(result.current.driveTimeError).toBeNull();
  });

  it('keeps manual drive time required when the lookup fails', async () => {
    const setForm = jest.fn();
    (locationsAPI.getDriveTimeFromHub as jest.Mock).mockRejectedValue({
      response: { status: 503, data: {} },
    });

    const { result } = renderHook(() => useLocationDriveTime(setForm));

    await act(async () => {
      await expect(result.current.autoFillDriveTime(41.5868, -93.654)).resolves.toBe(false);
    });

    expect(setForm).not.toHaveBeenCalled();
    expect(result.current.driveTimeError).toBe('The service is temporarily unavailable. Please try again shortly.');
    expect(toast.warning).toHaveBeenCalledWith('The service is temporarily unavailable. Please try again shortly.');
  });
});

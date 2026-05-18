import { act, renderHook } from '@testing-library/react';
import { useLocationDriveTime, useUserAdminActions } from './hooks';
import { managerFeatureApi } from './api';
import { toast } from 'sonner';

jest.mock('./api', () => ({
  managerFeatureApi: {
    users: { approve: jest.fn(), reject: jest.fn(), updateRole: jest.fn(), delete: jest.fn() },
    locations: { getDriveTimeFromHub: jest.fn() },
  },
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useUserAdminActions', () => {
  it('approves user then refreshes', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    (managerFeatureApi.users.approve as jest.Mock).mockResolvedValue({});
    const { result } = renderHook(() => useUserAdminActions(refresh));
    await act(async () => { await result.current.approve('u1'); });
    expect(managerFeatureApi.users.approve).toHaveBeenCalledWith('u1');
    expect(refresh).toHaveBeenCalled();
  });
});

describe('useLocationDriveTime', () => {
  it('fills drive time from the hub lookup', async () => {
    const setForm = jest.fn();
    (managerFeatureApi.locations.getDriveTimeFromHub as jest.Mock).mockResolvedValue({
      data: { drive_time_minutes: 38 },
    });

    const { result } = renderHook(() => useLocationDriveTime(setForm));

    await act(async () => {
      await expect(result.current.autoFillDriveTime(41.5868, -93.654)).resolves.toBe(true);
    });

    expect(managerFeatureApi.locations.getDriveTimeFromHub).toHaveBeenCalledWith(41.5868, -93.654);
    expect(setForm).toHaveBeenCalledWith(expect.any(Function));
    const updater = setForm.mock.calls[0][0];
    expect(updater({ address: '', city_name: '', drive_time_minutes: '', latitude: '', longitude: '' }))
      .toEqual({ address: '', city_name: '', drive_time_minutes: '38', latitude: '', longitude: '' });
    expect(result.current.driveTimeError).toBeNull();
  });

  it('keeps manual drive time required when the lookup fails', async () => {
    const setForm = jest.fn();
    (managerFeatureApi.locations.getDriveTimeFromHub as jest.Mock).mockRejectedValue({
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

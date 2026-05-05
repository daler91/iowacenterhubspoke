import { act, renderHook } from '@testing-library/react';
import { useUserAdminActions } from './hooks';
import { managerFeatureApi } from './api';

jest.mock('./api', () => ({
  managerFeatureApi: {
    users: { approve: jest.fn(), reject: jest.fn(), updateRole: jest.fn(), delete: jest.fn() },
    locations: { getDriveTimeFromHub: jest.fn() },
  },
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

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

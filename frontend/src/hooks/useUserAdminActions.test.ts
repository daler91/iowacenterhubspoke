import { act, renderHook } from '@testing-library/react';
import { useUserAdminActions } from './useUserAdminActions';
import { usersAPI } from '../lib/api';

jest.mock('../lib/api', () => ({
  usersAPI: { approve: jest.fn(), reject: jest.fn(), updateRole: jest.fn(), delete: jest.fn() },
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useUserAdminActions', () => {
  it('approves user then refreshes', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    (usersAPI.approve as jest.Mock).mockResolvedValue({});
    const { result } = renderHook(() => useUserAdminActions(refresh));
    await act(async () => { await result.current.approve('u1'); });
    expect(usersAPI.approve).toHaveBeenCalledWith('u1');
    expect(refresh).toHaveBeenCalled();
  });

  it('does not refresh when the action fails', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    (usersAPI.delete as jest.Mock).mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useUserAdminActions(refresh));
    await act(async () => { await result.current.remove('u1'); });
    expect(refresh).not.toHaveBeenCalled();
  });
});

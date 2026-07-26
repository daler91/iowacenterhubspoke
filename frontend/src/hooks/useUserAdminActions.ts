import { useCallback } from 'react';
import { toast } from 'sonner';
import { usersAPI } from '../lib/api';
import { extractErrorMessage } from '../lib/types';

/**
 * Admin actions on a user row (approve/reject/role/delete), each wrapped in
 * the same toast-on-success, toast-on-failure, refresh-after shape so
 * UserManager doesn't repeat it four times.
 */
export function useUserAdminActions(refreshUsers: () => Promise<unknown> | void) {
  const runAction = useCallback(async (action: () => Promise<unknown>, success: string, fallback: string) => {
    try {
      await action();
      toast.success(success);
      await refreshUsers();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, fallback));
    }
  }, [refreshUsers]);

  return {
    approve: (userId: string) => runAction(() => usersAPI.approve(userId), 'User approved', 'Failed to approve user'),
    reject: (userId: string) => runAction(() => usersAPI.reject(userId), 'User rejected', 'Failed to reject user'),
    updateRole: (userId: string, role: string) => runAction(() => usersAPI.updateRole(userId, role), `Role updated to ${role}`, 'Failed to update role'),
    remove: (userId: string) => runAction(() => usersAPI.delete(userId), 'User deleted', 'Failed to delete user'),
  };
}

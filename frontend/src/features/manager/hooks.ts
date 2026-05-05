import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { managerFeatureApi } from './api';
import { extractErrorMessage } from '../../lib/types';
import { describeApiError } from '../../lib/error-messages';
import type { LocationFormState } from './types';

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
    approve: (userId: string) => runAction(() => managerFeatureApi.users.approve(userId), 'User approved', 'Failed to approve user'),
    reject: (userId: string) => runAction(() => managerFeatureApi.users.reject(userId), 'User rejected', 'Failed to reject user'),
    updateRole: (userId: string, role: string) => runAction(() => managerFeatureApi.users.updateRole(userId, role), `Role updated to ${role}`, 'Failed to update role'),
    remove: (userId: string) => runAction(() => managerFeatureApi.users.delete(userId), 'User deleted', 'Failed to delete user'),
  };
}

export function useLocationDriveTime(setForm: Dispatch<SetStateAction<LocationFormState>>) {
  const [calculatingDrive, setCalculatingDrive] = useState(false);

  const autoFillDriveTime = useCallback(async (latitude: number, longitude: number) => {
    setCalculatingDrive(true);
    try {
      const res = await managerFeatureApi.locations.getDriveTimeFromHub(latitude, longitude);
      setForm(prev => ({ ...prev, drive_time_minutes: String(res.data.drive_time_minutes) }));
    } catch (err) {
      const fallbackMinutes = '15';
      setForm(prev => ({ ...prev, drive_time_minutes: fallbackMinutes }));
      toast.warning(describeApiError(err, `Drive time auto-calc failed. Using ${fallbackMinutes} min estimate.`));
    } finally {
      setCalculatingDrive(false);
    }
  }, [setForm]);

  return { calculatingDrive, autoFillDriveTime };
}

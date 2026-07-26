import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { locationsAPI } from '../lib/api';
import { describeApiError } from '../lib/error-messages';

export type LocationFormState = {
  address: string;
  city_name: string;
  drive_time_minutes: string;
  latitude: string;
  longitude: string;
};

/**
 * Fills the drive-time field from the hub for a given lat/lng, surfacing a
 * recoverable error rather than blocking the form — the user can always type
 * the value by hand if the Maps lookup fails.
 */
export function useLocationDriveTime(setForm: Dispatch<SetStateAction<LocationFormState>>) {
  const [calculatingDrive, setCalculatingDrive] = useState(false);
  const [driveTimeError, setDriveTimeError] = useState<string | null>(null);

  const autoFillDriveTime = useCallback(async (latitude: number, longitude: number) => {
    setCalculatingDrive(true);
    setDriveTimeError(null);
    try {
      const res = await locationsAPI.getDriveTimeFromHub(latitude, longitude);
      setForm(prev => ({ ...prev, drive_time_minutes: String(res.data.drive_time_minutes) }));
      return true;
    } catch (err) {
      const message = describeApiError(err, "Couldn't calculate drive time. Enter it manually.");
      setDriveTimeError(message);
      toast.warning(message);
      return false;
    } finally {
      setCalculatingDrive(false);
    }
  }, [setForm]);

  const clearDriveTimeError = useCallback(() => setDriveTimeError(null), []);

  return {
    calculatingDrive,
    autoFillDriveTime,
    driveTimeError,
    clearDriveTimeError,
  };
}

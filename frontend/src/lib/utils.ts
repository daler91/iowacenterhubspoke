import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DriveChainEntry {
  driveBeforeMin: number;
  driveAfterMin: number;
  driveBeforeLabel: string | null;
  driveAfterLabel: string | null;
  driveBeforeStyle: string | null;
  driveAfterStyle: string | null;
}

interface DaySchedule {
  id: string;
  employee_id: string;
  location_id: string;
  location_name?: string;
  start_time: string;
  end_time: string;
  drive_time_minutes?: number;
  drive_to_override_minutes?: number | null;
  drive_from_override_minutes?: number | null;
  town_to_town_drive_minutes?: number | null;
  [key: string]: unknown;
}

/**
 * Compute drive-block chain info for a day's schedules.
 *
 * When an employee has multiple classes on the same day, they are chained:
 *   First  -> hub drive before, city-to-city (or 0 if same location) after
 *   Middle -> no drive before, city-to-city (or 0 if same location) after
 *   Last   -> no drive before, hub drive after
 *
 * Single class per employee gets normal hub before + hub after.
 *
 * Returns: { scheduleId -> { driveBeforeMin, driveAfterMin, driveBeforeLabel, driveAfterLabel, driveBeforeStyle, driveAfterStyle } }
 */
export function computeDriveChain(daySchedules: DaySchedule[]): Record<string, DriveChainEntry> {
  const timeToMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  // Group by employee
  const byEmployee: Record<string, DaySchedule[]> = {};
  for (const s of daySchedules) {
    if (!byEmployee[s.employee_id]) byEmployee[s.employee_id] = [];
    byEmployee[s.employee_id].push(s);
  }

  const chain: Record<string, DriveChainEntry> = {};

  for (const empSchedules of Object.values(byEmployee)) {
    const sorted = [...empSchedules].sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));

    if (sorted.length === 1) {
      // Single class - normal hub round trip
      const s = sorted[0];
      const hubDrive = s.drive_time_minutes || 0;
      const driveTo = s.drive_to_override_minutes || hubDrive;
      const driveFrom = s.drive_from_override_minutes || hubDrive;
      chain[s.id] = {
        driveBeforeMin: driveTo,
        driveAfterMin: driveFrom,
        driveBeforeLabel: `Drive from Hub - ${driveTo} min`,
        driveAfterLabel: `Return to Hub - ${driveFrom} min`,
        driveBeforeStyle: 'hub',
        driveAfterStyle: 'hub',
      };
      continue;
    }

    // Multiple classes for same employee - chain them
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const isFirst = i === 0;
      const isLast = i === sorted.length - 1;
      const hubDrive = s.drive_time_minutes || 0;

      // Drive TO this class (hub for first, or from previous class)
      const driveBefore = isFirst ? (s.drive_to_override_minutes || hubDrive) : 0;
      const driveBeforeLabel = isFirst ? `Drive from Hub - ${driveBefore} min` : null;

      // Determine drive time to next class
      let driveToNext = 0;
      let driveToNextLabel: string | null = null;
      let driveToNextStyle: string | null = null;
      if (!isLast) {
        const next = sorted[i + 1];
        if (s.location_id === next.location_id) {
          // Same location - no drive between classes
          driveToNext = 0;
        } else {
          // Different location - check overrides first, then fall back to town-to-town
          const calculated = s.town_to_town_drive_minutes || next.town_to_town_drive_minutes || 0;
          driveToNext = s.drive_from_override_minutes || next.drive_to_override_minutes || calculated;
          driveToNextLabel = `Drive to ${next.location_name || 'next location'} - ${driveToNext} min`;
          driveToNextStyle = 'town-to-town';
        }
      }

      // Drive FROM this class (hub for last)
      const driveAfter = isLast ? (s.drive_from_override_minutes || hubDrive) : driveToNext;
      const driveAfterLabel = isLast
        ? `Return to Hub - ${driveAfter} min`
        : driveToNextLabel;

      chain[s.id] = {
        driveBeforeMin: driveBefore,
        driveAfterMin: driveAfter,
        driveBeforeLabel,
        driveAfterLabel,
        driveBeforeStyle: isFirst ? 'hub' : null,
        driveAfterStyle: isLast ? 'hub' : driveToNextStyle,
      };
    }
  }

  return chain;
}

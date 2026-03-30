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
  employee_ids: string[];
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
function buildSingleClassEntry(s: DaySchedule): DriveChainEntry {
  const hubDrive = s.drive_time_minutes || 0;
  const driveTo = s.drive_to_override_minutes || hubDrive;
  const driveFrom = s.drive_from_override_minutes || hubDrive;
  return {
    driveBeforeMin: driveTo,
    driveAfterMin: driveFrom,
    driveBeforeLabel: `Drive from Hub - ${driveTo} min`,
    driveAfterLabel: `Return to Hub - ${driveFrom} min`,
    driveBeforeStyle: 'hub',
    driveAfterStyle: 'hub',
  };
}

function resolveDriveToNext(s: DaySchedule, next: DaySchedule): { minutes: number; label: string | null; style: string | null } {
  if (s.location_id === next.location_id) {
    return { minutes: 0, label: null, style: null };
  }
  const calculated = s.town_to_town_drive_minutes || next.town_to_town_drive_minutes || 0;
  const minutes = s.drive_from_override_minutes || next.drive_to_override_minutes || calculated;
  return {
    minutes,
    label: `Drive to ${next.location_name || 'next location'} - ${minutes} min`,
    style: 'town-to-town',
  };
}

function buildChainEntry(sorted: DaySchedule[], i: number): DriveChainEntry {
  const s = sorted[i];
  const isFirst = i === 0;
  const isLast = i === sorted.length - 1;
  const hubDrive = s.drive_time_minutes || 0;

  const driveBefore = isFirst ? (s.drive_to_override_minutes || hubDrive) : 0;
  const driveBeforeLabel = isFirst ? `Drive from Hub - ${driveBefore} min` : null;

  const nextDrive = isLast ? { minutes: 0, label: null, style: null } : resolveDriveToNext(s, sorted[i + 1]);

  const driveAfter = isLast ? (s.drive_from_override_minutes || hubDrive) : nextDrive.minutes;
  const driveAfterLabel = isLast ? `Return to Hub - ${driveAfter} min` : nextDrive.label;

  return {
    driveBeforeMin: driveBefore,
    driveAfterMin: driveAfter,
    driveBeforeLabel,
    driveAfterLabel,
    driveBeforeStyle: isFirst ? 'hub' : null,
    driveAfterStyle: isLast ? 'hub' : nextDrive.style,
  };
}

export function computeDriveChain(daySchedules: DaySchedule[]): Record<string, DriveChainEntry> {
  const timeToMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  // Group by employee — a schedule with multiple employees is added to each employee's group
  const byEmployee: Record<string, DaySchedule[]> = {};
  for (const s of daySchedules) {
    const empIds = s.employee_ids && s.employee_ids.length > 0 ? s.employee_ids : ['__unassigned__'];
    for (const empId of empIds) {
      if (!byEmployee[empId]) byEmployee[empId] = [];
      byEmployee[empId].push(s);
    }
  }

  const chain: Record<string, DriveChainEntry> = {};

  for (const empSchedules of Object.values(byEmployee)) {
    const sorted = [...empSchedules].sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));

    if (sorted.length === 1) {
      chain[sorted[0].id] = buildSingleClassEntry(sorted[0]);
      continue;
    }

    for (let i = 0; i < sorted.length; i++) {
      chain[sorted[i].id] = buildChainEntry(sorted, i);
    }
  }

  return chain;
}

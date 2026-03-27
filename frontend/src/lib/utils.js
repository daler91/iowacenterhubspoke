import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Compute drive-block chain info for a day's schedules.
 *
 * When an employee has multiple classes on the same day, they are chained:
 *   First  → hub drive before, city-to-city (or 0 if same location) after
 *   Middle → no drive before, city-to-city (or 0 if same location) after
 *   Last   → no drive before, hub drive after
 *
 * Single class per employee gets normal hub before + hub after.
 *
 * Returns: { scheduleId → { driveBeforeMin, driveAfterMin, driveBeforeLabel, driveAfterLabel, driveBeforeStyle, driveAfterStyle } }
 */
export function computeDriveChain(daySchedules) {
  const timeToMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  // Group by employee
  const byEmployee = {};
  for (const s of daySchedules) {
    if (!byEmployee[s.employee_id]) byEmployee[s.employee_id] = [];
    byEmployee[s.employee_id].push(s);
  }

  const chain = {};

  for (const empSchedules of Object.values(byEmployee)) {
    const sorted = [...empSchedules].sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));

    if (sorted.length === 1) {
      // Single class - normal hub round trip
      const s = sorted[0];
      const hubDrive = s.drive_time_minutes || 0;
      chain[s.id] = {
        driveBeforeMin: hubDrive,
        driveAfterMin: hubDrive,
        driveBeforeLabel: `Drive from Hub - ${hubDrive} min`,
        driveAfterLabel: `Return to Hub - ${hubDrive} min`,
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

      // Determine drive time to next class
      let driveToNext = 0;
      let driveToNextLabel = null;
      let driveToNextStyle = null;
      if (!isLast) {
        const next = sorted[i + 1];
        if (s.location_id === next.location_id) {
          // Same location - no drive between classes
          driveToNext = 0;
        } else {
          // Different location - use town-to-town drive time
          driveToNext = s.town_to_town_drive_minutes || next.town_to_town_drive_minutes || 0;
          driveToNextLabel = `Drive to ${next.location_name || 'next location'} - ${driveToNext} min`;
          driveToNextStyle = 'town-to-town';
        }
      }

      chain[s.id] = {
        driveBeforeMin: isFirst ? hubDrive : 0,
        driveAfterMin: isLast ? hubDrive : driveToNext,
        driveBeforeLabel: isFirst ? `Drive from Hub - ${hubDrive} min` : null,
        driveAfterLabel: isLast
          ? `Return to Hub - ${hubDrive} min`
          : driveToNextLabel,
        driveBeforeStyle: isFirst ? 'hub' : null,
        driveAfterStyle: isLast ? 'hub' : driveToNextStyle,
      };
    }
  }

  return chain;
}

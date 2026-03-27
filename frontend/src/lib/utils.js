import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Compute drive-block chain info for a day's schedules.
 *
 * For same-employee, same-day schedules with town_to_town detected:
 *   First  → hub drive before, city-to-city drive after
 *   Middle → no drive before, city-to-city drive after
 *   Last   → no drive before, hub drive after
 *
 * Solo / non-town-to-town schedules get normal hub before + hub after.
 *
 * Returns a Map: scheduleId → { driveBeforeMin, driveAfterMin, driveBeforeLabel, driveAfterLabel, driveBeforeStyle, driveAfterStyle }
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
    const hasTT = sorted.length > 1 && sorted.some(s => s.town_to_town);

    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const hubDrive = s.drive_time_minutes || 0;

      if (!hasTT) {
        // Normal hub round-trip for each class
        chain[s.id] = {
          driveBeforeMin: hubDrive,
          driveAfterMin: hubDrive,
          driveBeforeLabel: `Drive from Hub - ${hubDrive} min`,
          driveAfterLabel: `Return to Hub - ${hubDrive} min`,
          driveBeforeStyle: 'hub',
          driveAfterStyle: 'hub',
        };
      } else {
        const isFirst = i === 0;
        const isLast = i === sorted.length - 1;
        const ttDrive = s.town_to_town_drive_minutes || 0;
        const nextLoc = !isLast ? sorted[i + 1].location_name : null;
        const prevLoc = !isFirst ? sorted[i - 1].location_name : null;

        chain[s.id] = {
          driveBeforeMin: isFirst ? hubDrive : 0,
          driveAfterMin: isLast ? hubDrive : ttDrive,
          driveBeforeLabel: isFirst ? `Drive from Hub - ${hubDrive} min` : null,
          driveAfterLabel: isLast
            ? `Return to Hub - ${hubDrive} min`
            : `Drive to ${nextLoc || 'next location'} - ${ttDrive} min`,
          driveBeforeStyle: isFirst ? 'hub' : null,
          driveAfterStyle: isLast ? 'hub' : 'town-to-town',
        };
      }
    }
  }

  return chain;
}

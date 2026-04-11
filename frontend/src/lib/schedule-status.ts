/**
 * Shared helper for rendering schedule status badges across profile
 * pages. Previously inlined in EmployeeProfile / LocationProfile /
 * ClassProfile with identical logic; extracting keeps the
 * indigo/amber/teal mapping in one place.
 */
export function getScheduleStatusStyle(status?: string): string {
  if (status === 'completed') return 'bg-spoke-soft text-spoke';
  if (status === 'in_progress') return 'bg-warn-soft text-warn';
  return 'bg-hub-soft text-hub';
}

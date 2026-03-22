import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const HOURS = Array.from({ length: 14 }, (_, i) => i + 6); // 6 AM to 7 PM

export function formatHourLabel(hour) {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

export function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTop(minutes, pixelsPerHour = 60) {
  const startMinutes = 6 * 60; // 6 AM
  return ((minutes - startMinutes) / 60) * pixelsPerHour;
}

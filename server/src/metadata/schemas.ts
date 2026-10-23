import { z } from 'zod';

/** A calendar day as `YYYY-MM-DD`, the form a `date` column and every client here use. */
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Date.UTC reads a year under 100 as 19xx, and no document here is from the first millennium. */
const EARLIEST_YEAR = 1000;

/**
 * Whether a string is a real day: `2025-02-30` has the shape and is not one.
 *
 * @param value - The string to check.
 * @returns true for `YYYY-MM-DD` naming a day that exists.
 */
export function isCalendarDay(value: string): boolean {
  const match = CALENDAR_DAY.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < EARLIEST_YEAR) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A calendar day sent by a client. */
export const calendarDaySchema = z
  .string()
  .trim()
  .refine(isCalendarDay, 'A date is written YYYY-MM-DD, and has to exist.');

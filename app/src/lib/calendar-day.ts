import { formatDate } from '@/lib/format';

// A document's date is a calendar day, `YYYY-MM-DD`, with no time and no zone. The date pickers
// hold a `Date`, which has both, so the two meet here and nowhere else. Every conversion is in
// local time: `new Date('2025-03-12')` is UTC midnight, which west of Greenwich is the 11th.

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The day a picker's `Date` falls on, where the reader is.
 *
 * @param date - A picker's value.
 * @returns `YYYY-MM-DD`.
 */
export function toCalendarDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A calendar day as a picker's `Date`: local midnight on it.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns The `Date`, or null for anything else.
 */
export function fromCalendarDay(day: string | null | undefined): Date | null {
  const match = CALENDAR_DAY.exec(day ?? '');
  if (match === null) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * A calendar day as the reader writes dates: `Mar 12, 2025`.
 *
 * @param day - `YYYY-MM-DD`, or nothing.
 * @returns The text, empty for nothing.
 */
export function formatCalendarDay(day: string | null | undefined): string {
  const date = fromCalendarDay(day);
  return date ? formatDate(date) : '';
}

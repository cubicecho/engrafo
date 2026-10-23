import type { DateOrder } from '../core/defaults.ts';

// The date on a document, read from its text the way Paperless reads it: every date-shaped run
// of characters, in the order they appear, and the first one that could be the document's own.
// A letter's date is in its head, a receipt's at its top or bottom with nothing dated before it,
// and a due date or an expiry, which is later than today, is skipped for being in the future.
//
// Pure: no clock and no environment. The step hands in today and the settings.

/** What decides which dates count. */
export interface DateParseOptions {
  /** How an all-numeric date with nothing to tell day and month apart is read. */
  order: DateOrder;
  /** Today, as `YYYY-MM-DD`. Later dates are not the document's. */
  today: string;
  /** Dates before this year are not the document's. */
  oldestYear: number;
  /** How many days past `today` still count, for a document written in a zone ahead of ours. */
  futureToleranceDays: number;
}

/** A date found in the text, before plausibility is asked. */
export interface FoundDate {
  /** Where in the text it starts, which is what "first" means. */
  index: number;
  /** As `YYYY-MM-DD`. */
  date: string;
}

const MONTHS_IN_YEAR = 12;
const MOST_DAYS_IN_MONTH = 31;
const YEARS_IN_CENTURY = 100;
const FOUR_DIGITS = 4;
/** `YYYY-MM-DD`'s length, the part of an ISO timestamp that is the day. */
const CALENDAR_DAY_LENGTH = 10;

// The names of each month in turn, January first: English, then German, as the receipts that
// motivated this are both. The alternation below is sorted longest first, so `sept` wins over
// `sep` and a match never stops short.
const MONTH_NAMES: ReadonlyArray<readonly string[]> = [
  ['january', 'januar', 'jänner', 'jan'],
  ['february', 'februar', 'feb'],
  ['march', 'märz', 'maerz', 'mär', 'mrz', 'mar'],
  ['april', 'apr'],
  ['may', 'mai'],
  ['june', 'juni', 'jun'],
  ['july', 'juli', 'jul'],
  ['august', 'aug'],
  ['september', 'sept', 'sep'],
  ['october', 'oktober', 'oct', 'okt'],
  ['november', 'nov'],
  ['december', 'dezember', 'dec', 'dez'],
];
const MONTH_BY_NAME = new Map(MONTH_NAMES.flatMap((names, index) => names.map((name) => [name, index + 1] as const)));
const MONTH = [...MONTH_BY_NAME.keys()].sort((a, b) => b.length - a.length).join('|');

// Year first, as ISO and its slash and dot cousins write it: 2025-03-12, 2025/03/12.
const YEAR_FIRST = /(?<!\d)(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?!\d)/g;
// Year last: 12.03.2025, 03/12/2025, 12-03-25. Not part of a longer run of digits and separators,
// so a version number or an account number is not read as one.
const YEAR_LAST = /(?<![\d.,/-])(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})(?!\d|[.,/-]\d)/g;
// 12 March 2025, 12th of March 2025, 12. März 2025, 12-Mar-2025.
const DAY_MONTH_NAME = new RegExp(
  `(?<![\\p{L}\\d])(\\d{1,2})(?:st|nd|rd|th)?\\.?[\\s-]*(?:of\\s+)?(${MONTH})\\.?(?![\\p{L}]),?[\\s-]*(\\d{4})(?!\\d)`,
  'giu',
);
// March 12, 2025 and Mar 12 2025.
const MONTH_NAME_DAY = new RegExp(
  `(?<![\\p{L}])(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`,
  'giu',
);

/** `YYYY-MM-DD` for a real calendar day, or null for 31 February. */
function calendarDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > MONTHS_IN_YEAR || day < 1 || day > MOST_DAYS_IN_MONTH) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, CALENDAR_DAY_LENGTH);
}

/** A two-digit year, in the century that does not put it in the future. */
function fullYear(digits: string, today: string): number {
  const year = Number(digits);
  if (digits.length === FOUR_DIGITS) {
    return year;
  }
  const thisYear = Number(today.slice(0, FOUR_DIGITS));
  const century = Math.floor(thisYear / YEARS_IN_CENTURY) * YEARS_IN_CENTURY;
  return century + year > thisYear ? century - YEARS_IN_CENTURY + year : century + year;
}

/**
 * A year-last numeric date's day and month. A part over 12 can only be the day, which settles
 * it whatever the order says; otherwise a dot means day first (no one writes 03.12.2025 month
 * first), and a slash or a dash takes the configured order. `YMD` has nothing to say about a
 * date whose year is last, so it reads one day first.
 */
function dayAndMonth(first: number, second: number, separator: string, order: DateOrder): [number, number] {
  if (first > MONTHS_IN_YEAR && second <= MONTHS_IN_YEAR) {
    return [first, second];
  }
  if (second > MONTHS_IN_YEAR && first <= MONTHS_IN_YEAR) {
    return [second, first];
  }
  const isMonthFirst = separator !== '.' && order === 'MDY';
  return isMonthFirst ? [second, first] : [first, second];
}

/**
 * Every date in the text, in the order they appear, valid as calendar days but not yet asked
 * whether they could be the document's.
 *
 * @param text - The document's text.
 * @param order - How an ambiguous all-numeric date is read.
 * @param today - Today as `YYYY-MM-DD`, which decides the century of a two-digit year.
 * @returns The dates, first in the text first.
 */
export function findDates(text: string, order: DateOrder, today: string): FoundDate[] {
  const found: FoundDate[] = [];
  const add = (index: number, date: string | null) => {
    if (date) {
      found.push({ index, date });
    }
  };

  for (const match of text.matchAll(YEAR_FIRST)) {
    add(match.index, calendarDate(Number(match[1]), Number(match[3]), Number(match[4])));
  }
  for (const match of text.matchAll(YEAR_LAST)) {
    const [, a = '', separator = '', b = '', c = ''] = match;
    if (order === 'YMD' && c.length === 2) {
      // 25/03/12 under YMD: the year is the first part.
      add(match.index, calendarDate(fullYear(a.padStart(2, '0'), today), Number(b), Number(c)));
      continue;
    }
    const [day, month] = dayAndMonth(Number(a), Number(b), separator, order);
    add(match.index, calendarDate(fullYear(c, today), month, day));
  }
  for (const match of text.matchAll(DAY_MONTH_NAME)) {
    const month = MONTH_BY_NAME.get((match[2] ?? '').toLowerCase()) ?? 0;
    add(match.index, calendarDate(Number(match[3]), month, Number(match[1])));
  }
  for (const match of text.matchAll(MONTH_NAME_DAY)) {
    const month = MONTH_BY_NAME.get((match[1] ?? '').toLowerCase()) ?? 0;
    add(match.index, calendarDate(Number(match[3]), month, Number(match[2])));
  }

  return found.sort((a, b) => a.index - b.index);
}

/** `YYYY-MM-DD` plus some days, in UTC, where a calendar day has no zone. */
function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, CALENDAR_DAY_LENGTH);
}

/**
 * The document's own date: the first in its text that is neither in the future nor too old.
 *
 * @param text - The document's text.
 * @param options - The order, today, and the bounds.
 * @returns The date as `YYYY-MM-DD`, or null when the text has none that could be it.
 */
export function findDocumentDate(text: string, options: DateParseOptions): string | null {
  const latest = addDays(options.today, options.futureToleranceDays);
  const earliest = `${String(options.oldestYear).padStart(FOUR_DIGITS, '0')}-01-01`;
  // ISO strings compare as dates.
  const plausible = findDates(text, options.order, options.today).find(
    ({ date }) => date >= earliest && date <= latest,
  );
  return plausible?.date ?? null;
}

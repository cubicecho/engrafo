import { describe, expect, it } from 'vitest';
import type { DateOrder } from '../../core/defaults.ts';
import { type DateParseOptions, findDates, findDocumentDate } from '../../metadata/document-date.ts';
import { isCalendarDay } from '../../metadata/schemas.ts';

const TODAY = '2026-10-23';
const OPTIONS: DateParseOptions = { order: 'DMY', today: TODAY, oldestYear: 1900, futureToleranceDays: 1 };
const date = (text: string, order: DateOrder = 'DMY') => findDocumentDate(text, { ...OPTIONS, order });

describe('findDocumentDate', () => {
  it('reads an ISO date', () => {
    expect(date('Statement generated 2025-03-12T10:14:00Z')).toBe('2025-03-12');
    expect(date('Printed 2025/3/9')).toBe('2025-03-09');
  });

  it('reads a dotted date day first, whatever the order', () => {
    expect(date('Datum: 12.03.2025')).toBe('2025-03-12');
    expect(date('Datum: 03.12.2025', 'MDY')).toBe('2025-12-03');
  });

  it('reads an ambiguous slashed date in the configured order', () => {
    expect(date('Date 03/04/2025', 'DMY')).toBe('2025-04-03');
    expect(date('Date 03/04/2025', 'MDY')).toBe('2025-03-04');
  });

  it('lets a part over 12 settle which is the day, against the order', () => {
    expect(date('Date 03/25/2025', 'DMY')).toBe('2025-03-25');
    expect(date('Date 25/03/2025', 'MDY')).toBe('2025-03-25');
  });

  it('reads a two-digit year in the century that keeps it out of the future', () => {
    expect(date('12/03/25')).toBe('2025-03-12');
    expect(date('Born 12.03.48')).toBe('1948-03-12');
  });

  it('reads a two-digit date year first under YMD', () => {
    expect(date('25/03/12', 'YMD')).toBe('2025-03-12');
    // A four-digit year at the end is not YMD's to read, so it falls back to day first.
    expect(date('12/03/2025', 'YMD')).toBe('2025-03-12');
  });

  it('reads month names in English, either way round', () => {
    expect(date('Dated 12 March 2025')).toBe('2025-03-12');
    expect(date('Dated 12th of March, 2025')).toBe('2025-03-12');
    expect(date('March 12, 2025')).toBe('2025-03-12');
    expect(date('Sept. 3 2024')).toBe('2024-09-03');
    expect(date('Issued 05-Jan-2024')).toBe('2024-01-05');
  });

  it('reads German month names', () => {
    expect(date('Berlin, den 3. März 2025')).toBe('2025-03-03');
  });

  it('takes the first plausible date, skipping one in the future', () => {
    const invoice = 'Invoice 4711\nDue: 2027-01-31\nInvoice date: 15.10.2026\nDelivered 01.10.2026';
    expect(date(invoice)).toBe('2026-10-15');
  });

  it('allows a day past today, for a zone ahead of the server', () => {
    expect(date('2026-10-24')).toBe('2026-10-24');
    expect(date('2026-10-25')).toBeNull();
  });

  it('skips a date older than the oldest year', () => {
    expect(date('Founded 01.01.1850. Letter of 02.02.2020')).toBe('2020-02-02');
  });

  it('skips a day that does not exist', () => {
    expect(date('30.02.2025 then 01.03.2025')).toBe('2025-03-01');
  });

  it('does not read amounts, times, versions or long numbers as dates', () => {
    expect(date('Total 12.50 EUR at 12:30')).toBeNull();
    expect(date('IBAN DE12.3456.7890.12 card 4111-1111-1111-1111')).toBeNull();
    expect(date('Order 12/2025, no day')).toBeNull();
  });

  it('finds nothing in text with no date', () => {
    expect(date('')).toBeNull();
    expect(date('Just some words, and May we meet again.')).toBeNull();
  });
});

describe('findDates', () => {
  it('lists every date in the order of the text, across the shapes', () => {
    const found = findDates('March 1, 2024 then 2024-02-01 then 01.01.2024', 'DMY', TODAY);
    expect(found.map((f) => f.date)).toEqual(['2024-03-01', '2024-02-01', '2024-01-01']);
  });
});

describe('isCalendarDay', () => {
  it('takes a real day and refuses the rest', () => {
    expect(isCalendarDay('2024-02-29')).toBe(true);
    expect(isCalendarDay('2025-02-29')).toBe(false);
    expect(isCalendarDay('2025-2-3')).toBe(false);
    expect(isCalendarDay('0099-01-01')).toBe(false);
  });
});

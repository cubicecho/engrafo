import { describe, expect, it } from 'vitest';
import { formatCalendarDay, fromCalendarDay, toCalendarDay } from './calendar-day';
import { currencyError, formatMoney, totalError } from './money';
import { exportFilename } from './receipts';

describe('calendar days', () => {
  it("round-trips a day through a picker's Date, in local time", () => {
    const date = fromCalendarDay('2025-03-12');
    expect(date?.getDate()).toBe(12);
    expect(date?.getHours()).toBe(0);
    expect(toCalendarDay(date as Date)).toBe('2025-03-12');
  });

  it('reads nothing as nothing', () => {
    expect(fromCalendarDay(null)).toBeNull();
    expect(fromCalendarDay('12.03.2025')).toBeNull();
    expect(formatCalendarDay(null)).toBe('');
  });
});

describe('money', () => {
  it('draws a total in its currency, and alone without one', () => {
    expect(formatMoney('12.50', 'EUR')).toContain('12.50');
    expect(formatMoney('12.50', null)).toBe('12.50');
    expect(formatMoney('12.50', 'XYZQ')).toBe('12.50 XYZQ');
  });

  it('takes an amount with a point or a comma, and an empty one', () => {
    expect(totalError('12,50')).toBeUndefined();
    expect(totalError('')).toBeUndefined();
    expect(totalError('12.50 EUR')).toBeDefined();
    expect(currencyError('eur')).toBeUndefined();
    expect(currencyError('euro')).toBeDefined();
  });
});

describe('exportFilename', () => {
  it('names the file for the range it covers', () => {
    expect(exportFilename({ from: '2026-01-01', to: '2026-03-31', folderId: null })).toBe(
      'receipts-2026-01-01-to-2026-03-31.csv',
    );
    expect(exportFilename({ from: '2026-01-01', to: null, folderId: null })).toBe('receipts-from-2026-01-01.csv');
    expect(exportFilename({ from: null, to: null, folderId: null })).toBe('receipts.csv');
  });
});

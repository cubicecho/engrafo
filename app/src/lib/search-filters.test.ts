import { describe, expect, it } from 'vitest';
import { NO_FILTERS, readSearchFilters, toSearchFilterInput, writeSearchFilters } from './search-filters';

describe('search filters in the query string', () => {
  it('round-trips every filter, leaving the other keys alone', () => {
    const filters = {
      folderId: 'f1',
      kind: 'IMAGE',
      from: '2026-01-01',
      to: '2026-03-31',
      receiptsOnly: true,
    } as const;
    const params = writeSearchFilters(new URLSearchParams('q=rent'), filters);
    expect(params.get('q')).toBe('rent');
    expect(readSearchFilters(params)).toEqual(filters);
  });

  it('drops a filter set back to nothing', () => {
    const params = writeSearchFilters(new URLSearchParams('q=rent&kind=PDF&receipts=1'), { ...NO_FILTERS });
    expect(params.toString()).toBe('q=rent');
  });

  it('reads a kind it does not know as no filter', () => {
    expect(readSearchFilters(new URLSearchParams('kind=SPREADSHEET')).kind).toBeNull();
  });
});

describe('toSearchFilterInput', () => {
  it('is null when nothing is narrowed, so the query asks for everything', () => {
    expect(toSearchFilterInput({ ...NO_FILTERS })).toBeNull();
  });

  it('sends a kind as a list and receipts only as hasReceipt', () => {
    expect(toSearchFilterInput({ ...NO_FILTERS, kind: 'PDF', receiptsOnly: true })).toEqual({
      folderId: null,
      kinds: ['PDF'],
      dateFrom: null,
      dateTo: null,
      hasReceipt: true,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { isShowingSavedSearch, savedFilters, savedSearchPath } from './saved-searches';
import { NO_FILTERS } from './search-filters';

describe('saved searches', () => {
  it('opens on the documents page with the text and filters in the query string', () => {
    const path = savedSearchPath({
      query: 'coffee',
      filters: { folderId: 'f1', kinds: ['PDF'], dateFrom: '2026-01-01', hasReceipt: true },
    });
    expect(path).toBe('/?q=coffee&folder=f1&kind=PDF&from=2026-01-01&receipts=1');
    expect(savedSearchPath({ query: null, filters: {} })).toBe('/');
  });

  it('reads JSON it does not expect as no filter', () => {
    expect(savedFilters(null)).toEqual(NO_FILTERS);
    expect(savedFilters([1, 2])).toEqual(NO_FILTERS);
    expect(savedFilters({ kinds: ['SPREADSHEET'], folderId: 7, hasReceipt: 'yes' })).toEqual(NO_FILTERS);
  });

  it('knows when the page is showing it, whatever else the query string holds', () => {
    const search = { query: 'rent', filters: { kinds: ['TEXT'] } };
    expect(isShowingSavedSearch(new URLSearchParams('q=rent&kind=TEXT&into=f2'), search)).toBe(true);
    expect(isShowingSavedSearch(new URLSearchParams('q=rent'), search)).toBe(false);
    expect(isShowingSavedSearch(new URLSearchParams('q=rent&kind=TEXT&receipts=1'), search)).toBe(false);
    expect(isShowingSavedSearch(new URLSearchParams('kind=TEXT'), search)).toBe(false);
  });
});

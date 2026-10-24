import { ROUTES } from '@/lib/routes';
import {
  KIND_OPTIONS,
  NO_FILTERS,
  readSearchFilters,
  SEARCH_PARAM,
  type SearchFilters,
  writeSearchFilters,
} from '@/lib/search-filters';

// A saved search is what the documents page keeps in its query string, stored under a name: the
// search text and the filters, the latter as the `DocumentSearchFilter` the page sent. Opening one
// is navigating to the documents page with that query string, so the page needs no idea of it.

/** A saved search as the sidebar reads it. `filters` is JSON, and is read without trusting its shape. */
export interface SavedSearchRow {
  id: string;
  name: string;
  query?: string | null | undefined;
  filters: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Array.isArray(value) === false;
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * The page's filters, from a saved search's stored JSON. A field the page cannot show, or one in a
 * shape it does not expect, is read as no filter rather than as an error, as the query string is.
 *
 * @param stored - The saved search's `filters`.
 */
export function savedFilters(stored: unknown): SearchFilters {
  if (isRecord(stored) === false) {
    return { ...NO_FILTERS };
  }
  const kinds = Array.isArray(stored.kinds) ? stored.kinds : [];
  const kind = KIND_OPTIONS.find((option) => option.value === kinds[0])?.value ?? null;
  return {
    folderId: stringOrNull(stored.folderId),
    kind,
    from: stringOrNull(stored.dateFrom),
    to: stringOrNull(stored.dateTo),
    receiptsOnly: stored.hasReceipt === true,
  };
}

/**
 * The documents page's query string for a saved search.
 *
 * @param search - The saved search.
 */
export function savedSearchParams(search: Pick<SavedSearchRow, 'query' | 'filters'>): URLSearchParams {
  const params = new URLSearchParams();
  if (search.query) {
    params.set(SEARCH_PARAM, search.query);
  }
  return writeSearchFilters(params, savedFilters(search.filters));
}

/**
 * Where a saved search opens: the documents page with its text and filters in the query string.
 *
 * @param search - The saved search.
 */
export function savedSearchPath(search: Pick<SavedSearchRow, 'query' | 'filters'>): string {
  const params = savedSearchParams(search).toString();
  return params === '' ? ROUTES.documents : `${ROUTES.documents}?${params}`;
}

/**
 * Whether the documents page is showing this saved search now: the same text and the same filters,
 * whatever else the query string holds (the upload panel's folder, say).
 *
 * @param current - The page's query string.
 * @param search - The saved search.
 */
export function isShowingSavedSearch(
  current: URLSearchParams,
  search: Pick<SavedSearchRow, 'query' | 'filters'>,
): boolean {
  const text = (current.get(SEARCH_PARAM) ?? '').trim();
  if (text !== (search.query ?? '')) {
    return false;
  }
  const shown = readSearchFilters(current);
  const saved = savedFilters(search.filters);
  return (Object.keys(saved) as Array<keyof SearchFilters>).every((key) => shown[key] === saved[key]);
}

/** What is wrong with a saved search's name as typed. The server checks the same, and that it is free. */
export function savedSearchNameError(name: string): string | undefined {
  return name.trim() === '' ? 'Give the search a name' : undefined;
}

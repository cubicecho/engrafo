import { DocumentKind, type DocumentSearchFilter } from '@/__generated__/graphql';

// What the documents page's search is narrowed to, kept in the query string beside the search
// text, so a narrowed search survives a reload and Back like the search does. Each filter has a
// key of its own, and a key that is absent narrows nothing.

/** The query string key the search box keeps its text in, so a search survives a reload and Back. */
export const SEARCH_PARAM = 'q';

/** The filters as the page holds them. */
export interface SearchFilters {
  folderId: string | null;
  kind: DocumentKind | null;
  /** `YYYY-MM-DD`, by the date on the document. */
  from: string | null;
  to: string | null;
  receiptsOnly: boolean;
}

/** Nothing narrowed. */
export const NO_FILTERS: Readonly<SearchFilters> = Object.freeze({
  folderId: null,
  kind: null,
  from: null,
  to: null,
  receiptsOnly: false,
});

/** The query string's keys, one per filter. */
const PARAM = { folderId: 'folder', kind: 'kind', from: 'from', to: 'to', receiptsOnly: 'receipts' } as const;
/** What `receipts` says when it is on. */
const ON = '1';

/** The kinds the picker offers, in the words a person uses. */
export const KIND_OPTIONS: ReadonlyArray<{ value: DocumentKind; label: string }> = [
  { value: DocumentKind.Pdf, label: 'PDF' },
  { value: DocumentKind.Image, label: 'Image' },
  { value: DocumentKind.Text, label: 'Text' },
  { value: DocumentKind.Ebook, label: 'Ebook' },
];

const isKind = (value: string | null): value is DocumentKind => KIND_OPTIONS.some((option) => option.value === value);

/**
 * The filters a query string holds. A value that is not one the page could have written, such as
 * a kind that no longer exists, is read as no filter rather than as an error.
 *
 * @param params - The page's query string.
 */
export function readSearchFilters(params: URLSearchParams): SearchFilters {
  const kind = params.get(PARAM.kind);
  return {
    folderId: params.get(PARAM.folderId) || null,
    kind: isKind(kind) ? kind : null,
    from: params.get(PARAM.from) || null,
    to: params.get(PARAM.to) || null,
    receiptsOnly: params.get(PARAM.receiptsOnly) === ON,
  };
}

/**
 * The query string with these filters in it, and every other key left as it was.
 *
 * @param params - The query string as it stands.
 * @param filters - The filters to write.
 */
export function writeSearchFilters(params: URLSearchParams, filters: SearchFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const values: Record<keyof SearchFilters, string | null> = {
    folderId: filters.folderId,
    kind: filters.kind,
    from: filters.from,
    to: filters.to,
    receiptsOnly: filters.receiptsOnly ? ON : null,
  };
  for (const [key, value] of Object.entries(values) as Array<[keyof SearchFilters, string | null]>) {
    if (value === null) {
      next.delete(PARAM[key]);
    } else {
      next.set(PARAM[key], value);
    }
  }
  return next;
}

/**
 * The filters as `searchDocuments` takes them, or null when nothing is narrowed.
 *
 * @param filters - The page's filters.
 */
export function toSearchFilterInput(filters: SearchFilters): DocumentSearchFilter | null {
  const input: DocumentSearchFilter = {
    folderId: filters.folderId,
    kinds: filters.kind ? [filters.kind] : null,
    dateFrom: filters.from,
    dateTo: filters.to,
    hasReceipt: filters.receiptsOnly ? true : null,
  };
  const isNarrowed = Object.values(input).some((value) => value !== null);
  return isNarrowed ? input : null;
}

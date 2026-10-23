import { documents } from '@cubicecho/engrafo-db/schema';
import { and, eq, gte, inArray, isNotNull, isNull, like, lte, or, type SQL } from 'drizzle-orm';
import {
  CSV_MIME_TYPE,
  EPUB_MIME_TYPE,
  HTML_MIME_TYPE,
  MARKDOWN_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
} from '../pipeline/mime.ts';

// What a search may be narrowed to, as conditions on `documents`. They are ANDed into every one
// of the search's reads (passages by meaning, passages by words, titles), never applied to the
// fused list afterwards: each read takes only its best few, so filtering after would leave a
// narrow search with whatever happened to survive the cut, often nothing.

/** The kinds of document a search can be narrowed to, as the upload allowlist groups them. */
export const DocumentKind = {
  Pdf: 'PDF',
  Image: 'IMAGE',
  Text: 'TEXT',
  Ebook: 'EBOOK',
} as const;
/** One of `DocumentKind`. */
export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

/** What a search is narrowed to. Every field left out narrows nothing. */
export interface SearchFilter {
  /** Only documents filed in these folders. Empty, none. */
  folderIds?: readonly string[] | undefined;
  /** Only documents of these kinds. Empty, none. */
  kinds?: readonly DocumentKind[] | undefined;
  /** Only documents dated on or after this day, `YYYY-MM-DD`. An undated document is left out. */
  dateFrom?: string | undefined;
  /** Only documents dated on or before this day. */
  dateTo?: string | undefined;
  /** True, only documents with a vendor or a total; false, only those with neither. */
  hasReceipt?: boolean | undefined;
}

/** The condition for one kind. Image is every `image/*`, so a type added to the allowlist is in it. */
function kindCondition(kind: DocumentKind): SQL {
  switch (kind) {
    case DocumentKind.Pdf:
      return eq(documents.mimeType, 'application/pdf');
    case DocumentKind.Image:
      return like(documents.mimeType, 'image/%');
    case DocumentKind.Text:
      // Everything the text step reads: a CSV or a saved page is text to the person filtering.
      return inArray(documents.mimeType, [PLAIN_TEXT_MIME_TYPE, MARKDOWN_MIME_TYPE, CSV_MIME_TYPE, HTML_MIME_TYPE]);
    case DocumentKind.Ebook:
      return eq(documents.mimeType, EPUB_MIME_TYPE);
  }
}

/**
 * The filter as conditions on `documents`, for a `where`.
 *
 * @param filter - What the search is narrowed to.
 * @returns The conditions, ANDed, or undefined when the filter narrows nothing.
 */
export function filterConditions(filter: SearchFilter): SQL | undefined {
  const conditions: Array<SQL | undefined> = [];
  if (filter.folderIds) {
    conditions.push(inArray(documents.folderId, [...filter.folderIds]));
  }
  if (filter.kinds) {
    conditions.push(or(...filter.kinds.map(kindCondition)));
  }
  if (filter.dateFrom) {
    conditions.push(gte(documents.documentDate, filter.dateFrom));
  }
  if (filter.dateTo) {
    conditions.push(lte(documents.documentDate, filter.dateTo));
  }
  if (filter.hasReceipt === true) {
    conditions.push(or(isNotNull(documents.vendor), isNotNull(documents.total)));
  }
  if (filter.hasReceipt === false) {
    conditions.push(and(isNull(documents.vendor), isNull(documents.total)));
  }
  const present = conditions.filter((condition): condition is SQL => condition !== undefined);
  return present.length > 0 ? and(...present) : undefined;
}

/**
 * Whether the filter can match nothing before anything is read: an empty folder or kind list.
 *
 * @param filter - What the search is narrowed to.
 */
export function matchesNothing(filter: SearchFilter): boolean {
  return filter.folderIds?.length === 0 || filter.kinds?.length === 0;
}

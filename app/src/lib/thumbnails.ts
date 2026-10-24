import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';
import { graphql } from '@/__generated__';

// A list asks for every row's thumbnail in one query, not one per row. The URLs are presigned and
// short-lived, so they are fetched afresh whenever a list mounts (`cache-and-network`), and the
// rows draw a type icon until they arrive, or for a document that has no thumbnail.

export const DocumentThumbnailUrls = graphql(`
  query DocumentThumbnailUrls($ids: [UUID!]!) {
    documentThumbnailUrls(ids: $ids) {
      documentId
      url
    }
  }
`);

/** What kind of picture a row draws when it has no thumbnail. */
export type DocumentIconKind = 'pdf' | 'image' | 'text' | 'markup' | 'table' | 'ebook';

/**
 * The type icon a document is drawn with in place of a thumbnail.
 *
 * @param mimeType - The document's stored type.
 */
export function documentIconKind(mimeType: string): DocumentIconKind {
  if (mimeType === 'application/pdf') {
    return 'pdf';
  }
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType === 'application/epub+zip') {
    return 'ebook';
  }
  if (mimeType === 'text/csv') {
    return 'table';
  }
  if (mimeType === 'text/markdown' || mimeType === 'text/html') {
    return 'markup';
  }
  return 'text';
}

/**
 * The thumbnail URL for each of these documents that has one.
 *
 * @param ids - The rows on screen. Asked about together, in one query.
 * @returns A map from document id to URL. Empty until the answer arrives, and when it fails: a
 *   list without its pictures is still the list.
 */
export function useThumbnailUrls(ids: readonly string[]): ReadonlyMap<string, string> {
  const result = useQuery(DocumentThumbnailUrls, {
    variables: { ids: [...ids] },
    skip: ids.length === 0,
    fetchPolicy: 'cache-and-network',
  });
  const rows = result.data?.documentThumbnailUrls;
  return useMemo(() => new Map((rows ?? []).map((row) => [row.documentId, row.url])), [rows]);
}

import { graphql } from '@/__generated__';

/**
 * A presigned address for one of a document's objects. It is short-lived, so every caller asks
 * with `fetchPolicy: 'network-only'` rather than reading one back out of the cache.
 */
export const DocumentFileUrl = graphql(`
  query DocumentFileUrl($id: UUID!, $variant: DocumentFileVariant!, $download: Boolean!) {
    documentFileUrl(id: $id, variant: $variant, download: $download)
  }
`);

import { generatePath } from 'react-router';

/**
 * Every path the app answers at, as react-router patterns.
 *
 * The router, the sidebar and every redirect read the same entry, so a path that
 * moves is changed once rather than found by searching for a string.
 */
export const ROUTES = Object.freeze({
  /** The archive: the list of documents and the upload panel. */
  documents: '/',
  /** One document. Build a link to it with {@link documentPath}. */
  document: '/documents/:id',
  /** Deleted documents, until they are restored or deleted for good. */
  trash: '/trash',
  /** What the pipeline is doing: running, queued, failed and lately finished. */
  processing: '/processing',
  /** Documents that look like one scan filed as several. Link to one with {@link mergeSuggestionPath}. */
  mergeSuggestions: '/merge-suggestions',
  settings: '/settings',
  login: '/login',
  /** Where a magic link lands, carrying its token in the query string. */
  verify: '/auth/verify',
  /** Where an OIDC sign-in lands, carrying a one-time token the server's callback minted. */
  sso: '/auth/sso',
});

/**
 * The address of one document's page.
 *
 * @param id - The document's id.
 * @returns The path to link or navigate to.
 */
export function documentPath(id: string): string {
  return generatePath(ROUTES.document, { id });
}

/** The query string key that says which suggested merge's dialog is open. */
export const REVIEW_PARAM = 'review';

/**
 * The suggested merges page with one suggestion's merge dialog open: where the document page's
 * "Review merge" goes.
 *
 * @param suggestionId - The suggestion to review.
 */
export function mergeSuggestionPath(suggestionId: string): string {
  return `${ROUTES.mergeSuggestions}?${REVIEW_PARAM}=${encodeURIComponent(suggestionId)}`;
}

/** The query string key that says which folder the upload panel files into. */
export const UPLOAD_INTO_PARAM = 'into';

/**
 * The documents page with its upload panel pointed at a folder: where a folder's "Upload here"
 * goes, from whichever page its tree is on.
 *
 * @param folderId - The folder, or null for the top level.
 */
export function uploadIntoPath(folderId: string | null): string {
  return folderId === null
    ? ROUTES.documents
    : `${ROUTES.documents}?${UPLOAD_INTO_PARAM}=${encodeURIComponent(folderId)}`;
}

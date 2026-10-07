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
  settings: '/settings',
  login: '/login',
  /** Where a magic link lands, carrying its token in the query string. */
  verify: '/auth/verify',
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

/** The query parameter the document page keeps its tab in: `?tab=text`. */
export const DOCUMENT_TAB_PARAM = 'tab';

/** The document page's tabs, in the order they are drawn. */
export const DOCUMENT_TABS = ['preview', 'text', 'history'] as const;

export type DocumentTab = (typeof DOCUMENT_TABS)[number];

function isDocumentTab(value: string | null): value is DocumentTab {
  return (DOCUMENT_TABS as readonly (string | null)[]).includes(value);
}

/**
 * Which tab the document page shows.
 *
 * @param asked - The tab the URL names, if any.
 * @param previewable - Whether the document has a preview: without one there is no Preview tab,
 *   so a link to it, and the default, land on Text instead.
 * @returns The URL's tab when it is one the page has, else Preview, or Text without a preview.
 */
export function documentTab(asked: string | null, previewable: boolean): DocumentTab {
  const fallback: DocumentTab = previewable ? 'preview' : 'text';
  const known = isDocumentTab(asked);
  if (known === false || (asked === 'preview' && previewable === false)) {
    return fallback;
  }
  return asked;
}

/**
 * The query string that selects a tab, keeping every other parameter already in it.
 *
 * @param current - The page's query string as it stands.
 * @param tab - The tab to select.
 * @returns A search string with the leading `?`, for a link's `to`.
 */
export function tabSearch(current: URLSearchParams, tab: DocumentTab): string {
  const next = new URLSearchParams(current);
  next.set(DOCUMENT_TAB_PARAM, tab);
  return `?${next.toString()}`;
}

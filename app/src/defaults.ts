/**
 * The numbers this app could reasonably have chosen differently, in one place.
 *
 * Each group is a frozen value typed by the interface above it, so a page reads a
 * name and a unit rather than a literal. Nothing here is computed and nothing is
 * imported: a value is written out in full, in the unit its name ends with.
 */

/** How the pages keep up with a pipeline that never announces anything. */
export interface PollingSettings {
  /**
   * How often a page asks again while a document is still moving. Long enough
   * not to hammer the server, short enough that a small scan looks live.
   */
  intervalMs: number;
}

/** What the pages poll at unless something says otherwise. */
export const POLLING_DEFAULTS: Readonly<PollingSettings> = Object.freeze({
  intervalMs: 3000,
});

/** How much of the archive the list asks for. */
export interface DocumentListSettings {
  /** The most documents the list query returns. There is no paging past it. */
  limit: number;
}

/** What the list asks for unless something says otherwise. */
export const DOCUMENT_LIST_DEFAULTS: Readonly<DocumentListSettings> = Object.freeze({
  limit: 200,
});

/** How much extracted text the document page will show in the browser. */
export interface TextPreviewSettings {
  /**
   * The largest text object the page fetches to display, 512 KiB. Past it the
   * download button stands in for the text.
   */
  maxBytes: number;
}

/** What the text card will show unless something says otherwise. */
export const TEXT_PREVIEW_DEFAULTS: Readonly<TextPreviewSettings> = Object.freeze({
  maxBytes: 524_288,
});

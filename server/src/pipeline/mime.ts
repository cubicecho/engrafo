/** An EPUB: a zip of XHTML chapters, read here without any outside tool. */
export const EPUB_MIME_TYPE = 'application/epub+zip';
/** Plain text with no markup to take off. */
export const PLAIN_TEXT_MIME_TYPE = 'text/plain';
/** Markdown: stored as it is, and searched by its headings. */
export const MARKDOWN_MIME_TYPE = 'text/markdown';
/** A CSV, usually a bank or card statement: stored as it is, and searched by rows. */
export const CSV_MIME_TYPE = 'text/csv';
/** A saved web page, usually an order confirmation: stored as its text, not its markup. */
export const HTML_MIME_TYPE = 'text/html';
/** What file-type calls a page that opens with an XML declaration, as XHTML may. */
export const XML_MIME_TYPE = 'application/xml';

/**
 * What can be uploaded. Kept to what the pipeline can do something with: PDFs
 * and the raster formats ocrmypdf accepts, plain text, Markdown and CSV, whose
 * content needs no OCR at all, web pages, and EPUB.
 */
export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/webp',
  'image/gif',
  PLAIN_TEXT_MIME_TYPE,
  MARKDOWN_MIME_TYPE,
  CSV_MIME_TYPE,
  HTML_MIME_TYPE,
  EPUB_MIME_TYPE,
] as const;

/**
 * Whether a type is on the upload allowlist.
 *
 * @param mimeType - The type the browser claimed, or the one read from the file's bytes.
 * @returns true when it is one of `ACCEPTED_MIME_TYPES`.
 */
export function isAcceptedMimeType(mimeType: string): boolean {
  return ACCEPTED_MIME_TYPES.some((accepted) => accepted === mimeType);
}

/**
 * Whether a type is a raster image, which ocrmypdf has to be told a resolution for.
 *
 * @param mimeType - A MIME type.
 * @returns true for any `image/*` type.
 */
export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Whether ocrmypdf can take this type as input.
 *
 * @param mimeType - A MIME type.
 * @returns true for a PDF or an image.
 */
export function isOcrable(mimeType: string): boolean {
  return mimeType === 'application/pdf' || isImage(mimeType);
}

/**
 * Whether an image is turned into a PNG before ocrmypdf sees it.
 *
 * @param mimeType - A MIME type.
 * @returns true for WebP and GIF. ocrmypdf reads an opaque one of either, but refuses one with
 *   an alpha channel, which a WebP often has, and makes an animated GIF a page per frame.
 */
export function needsPngForOcr(mimeType: string): boolean {
  return mimeType === 'image/webp' || mimeType === 'image/gif';
}

/**
 * Whether a type is text already, so its content is the file itself.
 *
 * @param mimeType - A MIME type.
 * @returns true for plain text, Markdown and CSV.
 */
export function isText(mimeType: string): boolean {
  return mimeType === PLAIN_TEXT_MIME_TYPE || mimeType === MARKDOWN_MIME_TYPE || mimeType === CSV_MIME_TYPE;
}

/**
 * Whether a type has no magic bytes to know it by, so the inspect step takes the upload's word for it.
 *
 * @param mimeType - A MIME type.
 * @returns true for the text types and HTML.
 */
export function hasNoMagicBytes(mimeType: string): boolean {
  return isText(mimeType) || mimeType === HTML_MIME_TYPE;
}

/**
 * Whether a type's text is written with Markdown headings, which the index cuts it by.
 *
 * @param mimeType - A MIME type.
 * @returns true for Markdown; EPUB, whose chapters are stored as headings; and HTML, whose
 *   h1-h6 are.
 */
export function hasHeadings(mimeType: string): boolean {
  return mimeType === MARKDOWN_MIME_TYPE || mimeType === EPUB_MIME_TYPE || mimeType === HTML_MIME_TYPE;
}

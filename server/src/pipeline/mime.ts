import { fileTypeFromBuffer } from 'file-type';

/** An EPUB: a zip of XHTML chapters, read here without any outside tool. */
export const EPUB_MIME_TYPE = 'application/epub+zip';
/** Plain text with no markup to take off. */
export const PLAIN_TEXT_MIME_TYPE = 'text/plain';
/** Markdown: stored as it is, and searched by its headings. */
export const MARKDOWN_MIME_TYPE = 'text/markdown';

/**
 * What can be uploaded. Kept to what the pipeline can do something with: PDFs
 * and the raster formats ocrmypdf accepts (through img2pdf), plain text and
 * Markdown, whose content needs no OCR at all, and EPUB.
 */
export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  PLAIN_TEXT_MIME_TYPE,
  MARKDOWN_MIME_TYPE,
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
 * Whether a type is text already, so its content is the file itself.
 *
 * @param mimeType - A MIME type.
 * @returns true for plain text and Markdown. Neither has magic bytes, so these are also the
 *   types the inspect step takes the upload's word for.
 */
export function isText(mimeType: string): boolean {
  return mimeType === PLAIN_TEXT_MIME_TYPE || mimeType === MARKDOWN_MIME_TYPE;
}

/**
 * Whether a type's text is written with Markdown headings, which the index cuts it by.
 *
 * @param mimeType - A MIME type.
 * @returns true for Markdown, and for EPUB, whose chapters are stored as headings.
 */
export function hasHeadings(mimeType: string): boolean {
  return mimeType === MARKDOWN_MIME_TYPE || mimeType === EPUB_MIME_TYPE;
}

/** How many leading bytes file-type needs, at most, to recognise any format it knows. */
export const SNIFF_BYTES = 4100;

/**
 * A file's real type, read from its magic bytes.
 *
 * @param head - The file's first bytes; at least `SNIFF_BYTES` of them when it is that long.
 * @param claimed - The type the uploader said, or guessed from the file's extension.
 * @returns The type the bytes say, or `claimed` when the bytes say nothing and it is a text type,
 *   or null when neither can be believed.
 *
 * @remarks
 * Plain text and Markdown have no magic bytes, so "no match" is only taken for one of them when
 * the uploader also said so. Whether the type is accepted is the caller's question.
 */
export async function sniffMimeType(head: Uint8Array, claimed: string): Promise<string | null> {
  const sniffed = await fileTypeFromBuffer(head.subarray(0, SNIFF_BYTES));
  return sniffed?.mime ?? (isText(claimed) ? claimed : null);
}

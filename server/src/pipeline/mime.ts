/**
 * What can be uploaded. Kept to what the pipeline can do something with: PDFs
 * and the raster formats ocrmypdf accepts (through img2pdf), plus plain text,
 * whose content needs no OCR at all.
 */
export const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'text/plain'] as const;

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

/**
 * What can be uploaded. Kept to what the pipeline can do something with: PDFs
 * and the raster formats ocrmypdf accepts (through img2pdf), plus plain text,
 * whose content needs no OCR at all.
 */
export const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'text/plain'] as const;

export function isAcceptedMimeType(mimeType: string): boolean {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** Whether ocrmypdf can take this type as input. */
export function isOcrable(mimeType: string): boolean {
  return mimeType === 'application/pdf' || isImage(mimeType);
}

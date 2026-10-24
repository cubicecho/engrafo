import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { THUMBNAIL_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';
import { EPUB_MIME_TYPE, isImage } from './mime.ts';

// A thumbnail is a JPEG of a document's first page, for the rows of a list. Two tools draw it,
// both already in the image for other steps: pdftoppm (poppler-utils, which pdftotext is part of)
// renders a PDF's first page at the width asked for, and Pillow, through the same Python that
// ocrmypdf runs on, resizes an image or an ebook's cover. Nothing new is installed.

const exec = promisify(execFile);

const THUMBNAIL_TIMEOUT_MS = THUMBNAIL_DEFAULTS.timeoutMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** What a thumbnail is stored as. */
export const THUMBNAIL_MIME_TYPE = 'image/jpeg';

/** Which of the two tools this host has, asked once at boot. */
export interface ThumbnailTools {
  /** pdftoppm, for a PDF's first page. */
  pdf: boolean;
  /** Python with Pillow, for an image or an ebook's cover. */
  image: boolean;
}

/** How a document's thumbnail is drawn, and from which of its objects. */
export type ThumbnailSource =
  | { render: 'pdf'; key: string }
  | { render: 'image'; key: string }
  | { render: 'epub'; key: string };

// The first frame of an animated image, turned the way its EXIF says (a phone photo is stored on
// its side), laid on white since a JPEG has no transparency, then narrowed to the width and cut
// at the height: a receipt roll would otherwise be a strip too thin to see in a row. `draft` lets
// a JPEG decode at a fraction of its size, which is most of the time a photo takes.
const RESIZE = `
import sys
from PIL import Image, ImageOps
source, target = sys.argv[1], sys.argv[2]
width, max_height, quality = int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
with Image.open(source) as image:
    image.draft("RGB", (width, width))
    image.seek(0)
    frame = ImageOps.exif_transpose(image).convert("RGBA")
    page = Image.new("RGB", frame.size, "white")
    page.paste(frame, mask=frame.getchannel("A"))
    if page.width > width:
        page = page.resize((width, max(1, round(page.height * width / page.width))), Image.LANCZOS)
    if page.height > max_height:
        page = page.crop((0, 0, page.width, max_height))
    page.save(target, "JPEG", quality=quality, optimize=True)
`;

/**
 * Which of the two tools are on this host.
 *
 * @returns Each tool's answer. Either can be missing on a bare dev host, and then the thumbnail
 *   step is skipped for the documents that need it, rather than failing them.
 */
export async function detectThumbnailTools(): Promise<ThumbnailTools> {
  const [pdf, image] = await Promise.all([
    exec('pdftoppm', ['-v']).then(
      () => true,
      () => false,
    ),
    exec(THUMBNAIL_DEFAULTS.resizer, ['-c', 'import PIL']).then(
      () => true,
      () => false,
    ),
  ]);
  return { pdf, image };
}

/**
 * Where a document's thumbnail comes from, given what this host can draw.
 *
 * @param doc - The document as earlier steps left it.
 * @param tools - What the host has.
 * @returns How to draw it and from which object, or null when it gets none: text, Markdown, CSV
 *   and HTML have no page to picture, and the app draws a type icon for them instead.
 *
 * @remarks
 * A PDF is drawn from its OCR archive when there is one, which is the same page the archive
 * shows, straightened and turned the right way up. An image is drawn from the original: its
 * archive is a PDF wrapped around the same picture.
 */
export function thumbnailSource(
  doc: Pick<Document, 'mimeType' | 'originalKey' | 'archiveKey'>,
  tools: ThumbnailTools,
): ThumbnailSource | null {
  if (doc.mimeType === 'application/pdf') {
    return tools.pdf ? { render: 'pdf', key: doc.archiveKey ?? doc.originalKey } : null;
  }
  if (isImage(doc.mimeType)) {
    return tools.image ? { render: 'image', key: doc.originalKey } : null;
  }
  if (doc.mimeType === EPUB_MIME_TYPE) {
    return tools.image ? { render: 'epub', key: doc.originalKey } : null;
  }
  return null;
}

/**
 * The arguments pdftoppm is run with for a first page at the thumbnail's width.
 *
 * @param input - The PDF.
 * @param outputBase - The output's path without its extension: pdftoppm adds `.jpg`.
 */
export function pdfThumbnailArgs(input: string, outputBase: string): string[] {
  return [
    '-f',
    '1',
    '-l',
    '1',
    '-singlefile',
    '-jpeg',
    '-jpegopt',
    `quality=${THUMBNAIL_DEFAULTS.jpegQuality}`,
    // The width fixed and the height following the page's own proportions.
    '-scale-to-x',
    String(THUMBNAIL_DEFAULTS.widthPx),
    '-scale-to-y',
    '-1',
    input,
    outputBase,
  ];
}

/**
 * Draws a PDF's first page as a JPEG.
 *
 * @param input - The PDF on disk.
 * @param outputBase - Where it goes, without the `.jpg` pdftoppm adds.
 * @returns The JPEG's path.
 */
export async function renderPdfThumbnail(input: string, outputBase: string): Promise<string> {
  try {
    await exec('pdftoppm', pdfThumbnailArgs(input, outputBase), { timeout: THUMBNAIL_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`pdftoppm could not draw the first page: ${lastLine(error)}`);
  }
  return `${outputBase}.jpg`;
}

/**
 * Resizes an image to a thumbnail JPEG.
 *
 * @param input - Any image Pillow reads: PNG, JPEG, TIFF, WebP, GIF.
 * @param output - Where the JPEG goes.
 */
export async function resizeImageThumbnail(input: string, output: string): Promise<void> {
  const args = [
    '-c',
    RESIZE,
    input,
    output,
    String(THUMBNAIL_DEFAULTS.widthPx),
    String(THUMBNAIL_DEFAULTS.maxHeightPx),
    String(THUMBNAIL_DEFAULTS.jpegQuality),
  ];
  try {
    await exec(THUMBNAIL_DEFAULTS.resizer, args, { timeout: THUMBNAIL_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`Could not resize the image: ${lastLine(error)}`);
  }
}

/** A failed tool's last line of stderr, which is where Python puts the exception and poppler its error. */
function lastLine(error: unknown): string {
  const stderr =
    error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
  return stderr.split('\n').at(-1) || errorMessage(error);
}

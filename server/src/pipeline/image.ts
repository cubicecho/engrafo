import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';
import { OCR_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';

const exec = promisify(execFile);

const PNG_TIMEOUT_MS = OCR_DEFAULTS.pngTimeoutMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;

// Pillow, because it is already there: ocrmypdf is Python and reads images
// with it, and Debian's Pillow reads WebP. Nothing new goes in the image.
//
// The first frame only, since an animated GIF is not a document of many pages,
// and laid on white, since img2pdf refuses an alpha channel and a transparent
// background is nearly always a page's white. A resolution the image states is
// kept, since a scanner writes the true one; without one, ocrmypdf's
// --image-dpi applies as it does to any image.
const TO_PNG = `
import sys
from PIL import Image
with Image.open(sys.argv[1]) as image:
    dpi = image.info.get("dpi")
    image.seek(0)
    frame = image.convert("RGBA")
    page = Image.new("RGB", frame.size, "white")
    page.paste(frame, mask=frame.getchannel("A"))
    page.save(sys.argv[2], "PNG", **({"dpi": dpi} if dpi else {}))
`;

const PNG_SIGNATURE_BYTES = 8;
const CHUNK_LENGTH_BYTES = 4;
const CHUNK_HEADER_BYTES = 8;
const CHUNK_CRC_BYTES = 4;
// Where IHDR's colour type sits in its data: after the width, height and bit depth.
const IHDR_COLOR_TYPE_OFFSET = 9;
const GREYSCALE_ALPHA = 4;
const RGB_ALPHA = 6;
const ALPHA_COLOR_TYPES = new Set([GREYSCALE_ALPHA, RGB_ALPHA]);

/**
 * Writes an image's first frame as an opaque PNG, which ocrmypdf takes without complaint.
 *
 * @param input - A WebP or GIF on disk.
 * @param output - Where the PNG goes.
 * @throws When the image cannot be read, or Python or Pillow is missing, with Python's own last line.
 */
export async function toOpaquePng(input: string, output: string): Promise<void> {
  try {
    await exec(OCR_DEFAULTS.pngConverter, ['-c', TO_PNG, input, output], { timeout: PNG_TIMEOUT_MS });
  } catch (error) {
    // A traceback's last line is the exception, which is the part that says what went wrong.
    const stderr =
      error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(`Could not convert the image for OCR: ${stderr.split('\n').at(-1) || errorMessage(error)}`);
  }
}

/**
 * Whether a PNG has any transparency, which img2pdf refuses and ocrmypdf fails the run over.
 *
 * @param path - A PNG on disk.
 * @returns true for an alpha channel, or a `tRNS` chunk (a palette entry or colour that is
 *   see-through); false for an opaque PNG, which goes to OCR as it is, and for anything that is
 *   not a PNG at all.
 *
 * @remarks
 * Reads chunk headers only, up to the first image data, where the PNG standard puts both: a
 * screenshot is opaque and should not be decoded and written again to find that out.
 */
export async function pngHasTransparency(path: string): Promise<boolean> {
  const file = await open(path);
  try {
    const header = Buffer.alloc(CHUNK_HEADER_BYTES);
    let position = PNG_SIGNATURE_BYTES;
    for (;;) {
      const { bytesRead } = await file.read(header, 0, CHUNK_HEADER_BYTES, position);
      if (bytesRead < CHUNK_HEADER_BYTES) {
        return false;
      }
      const length = header.readUInt32BE(0);
      const type = header.toString('latin1', CHUNK_LENGTH_BYTES, CHUNK_HEADER_BYTES);
      if (type === 'IHDR') {
        const colorType = Buffer.alloc(1);
        await file.read(colorType, 0, 1, position + CHUNK_HEADER_BYTES + IHDR_COLOR_TYPE_OFFSET);
        if (ALPHA_COLOR_TYPES.has(colorType[0] ?? 0)) {
          return true;
        }
      } else if (type === 'tRNS') {
        return true;
      } else if (type === 'IDAT' || type === 'IEND') {
        return false;
      }
      position += CHUNK_HEADER_BYTES + length + CHUNK_CRC_BYTES;
    }
  } finally {
    await file.close();
  }
}

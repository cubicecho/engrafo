import { execFile } from 'node:child_process';
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
// background is nearly always a page's white. The PNG carries no DPI, so
// ocrmypdf's --image-dpi applies to it as it does to any image without one.
const TO_PNG = `
import sys
from PIL import Image
with Image.open(sys.argv[1]) as image:
    image.seek(0)
    frame = image.convert("RGBA")
    page = Image.new("RGB", frame.size, "white")
    page.paste(frame, mask=frame.getchannel("A"))
    page.save(sys.argv[2], "PNG")
`;

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

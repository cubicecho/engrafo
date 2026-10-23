import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toOpaquePng } from '../../pipeline/image.ts';
import { needsPngForOcr } from '../../pipeline/mime.ts';

const exec = promisify(execFile);

describe('needsPngForOcr', () => {
  it('is WebP and GIF only', () => {
    expect(needsPngForOcr('image/webp')).toBe(true);
    expect(needsPngForOcr('image/gif')).toBe(true);
    expect(needsPngForOcr('image/png')).toBe(false);
    expect(needsPngForOcr('application/pdf')).toBe(false);
  });
});

/** Runs Python with Pillow, as the converter does; answers on stdout. */
const python = async (script: string, ...args: string[]) => (await exec('python3', ['-c', script, ...args])).stdout;

// Wherever ocrmypdf is installed, Pillow is too: the image, and most hosts with it. Elsewhere this skips.
const hasPillow = await python('import PIL.WebPImagePlugin').then(
  () => true,
  () => false,
);

// A 40x20 image with a black square in its left half and nothing at all in its right.
const DRAW_TRANSPARENT_WEBP = `
import sys
from PIL import Image
image = Image.new("RGBA", (40, 20), (0, 0, 0, 0))
image.paste((0, 0, 0, 255), (0, 0, 20, 20))
image.save(sys.argv[1], "WEBP", lossless=True)
`;
// Two frames: black, then white. Only the first is a page.
const DRAW_ANIMATED_GIF = `
import sys
from PIL import Image
frames = [Image.new("RGB", (10, 10), colour) for colour in ("black", "white")]
frames[0].save(sys.argv[1], save_all=True, append_images=frames[1:], duration=100, loop=0)
`;
const DESCRIBE_IMAGE = `
import sys
from PIL import Image
with Image.open(sys.argv[1]) as image:
    print(image.format, image.mode, getattr(image, "n_frames", 1), image.getpixel((1, 1)), image.getpixel((30, 10)) if image.width > 30 else "")
`;

describe.skipIf(hasPillow === false)('toOpaquePng', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'engrafo-image-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lays a transparent WebP on white, which ocrmypdf otherwise refuses for its alpha channel', async () => {
    const input = join(dir, 'receipt.webp');
    const output = join(dir, 'receipt.png');
    await python(DRAW_TRANSPARENT_WEBP, input);

    await toOpaquePng(input, output);

    expect((await python(DESCRIBE_IMAGE, output)).trim()).toBe('PNG RGB 1 (0, 0, 0) (255, 255, 255)');
  });

  it("keeps only an animated GIF's first frame", async () => {
    const input = join(dir, 'receipt.gif');
    const output = join(dir, 'receipt.png');
    await python(DRAW_ANIMATED_GIF, input);

    await toOpaquePng(input, output);

    expect((await python(DESCRIBE_IMAGE, output)).trim()).toBe('PNG RGB 1 (0, 0, 0)');
  });

  it("fails with Pillow's own reason when the file is not an image", async () => {
    const input = join(dir, 'fake.webp');
    await writeFile(input, 'not an image');

    await expect(toOpaquePng(input, join(dir, 'out.png'))).rejects.toThrow(
      /^Could not convert the image for OCR: .*cannot identify image file/,
    );
  });
});

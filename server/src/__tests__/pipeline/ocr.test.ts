import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { describe, expect, it } from 'vitest';
import { detectOcr, ocrArgs, ocrStep } from '../../pipeline/steps/ocr.ts';
import type { PipelineConfig } from '../../pipeline/types.ts';
import { bornDigitalPdf, createFakeEmbedder, createFakeStorage, createTestDb } from '../helpers.ts';

const exec = promisify(execFile);

const CONFIG: PipelineConfig = { ocrAvailable: true, pdfTextAvailable: true, ocrLanguages: 'eng', concurrency: 1 };

function doc(values: Partial<Document> = {}): Document {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    folderId: null,
    title: 'Scan',
    originalFilename: 'scan.png',
    mimeType: 'image/png',
    sizeBytes: 1,
    checksumSha256: null,
    originalKey: 'originals/u/scan',
    archiveKey: null,
    contentKey: null,
    contentBytes: null,
    ocrRequested: true,
    status: 'processing',
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  };
}

describe('ocr step', () => {
  it('runs only when asked for, available, and the file is a PDF or image', () => {
    expect(ocrStep.enabled(doc(), CONFIG)).toBe(true);
    expect(ocrStep.enabled(doc({ ocrRequested: false }), CONFIG)).toBe(false);
    expect(ocrStep.enabled(doc(), { ...CONFIG, ocrAvailable: false })).toBe(false);
    expect(ocrStep.enabled(doc({ mimeType: 'text/plain' }), CONFIG)).toBe(false);
  });

  it('gives images a DPI and PDFs none', () => {
    const base = { input: 'in', output: 'out.pdf', sidecar: 'out.txt', languages: 'eng+deu' };
    expect(ocrArgs({ ...base, image: true })).toContain('--image-dpi');
    expect(ocrArgs({ ...base, image: false })).not.toContain('--image-dpi');
    expect(ocrArgs({ ...base, image: false }).slice(-2)).toEqual(['in', 'out.pdf']);
  });

  it('converts an unusual colour space rather than failing the PDF/A conversion', () => {
    const args = ocrArgs({ input: 'in', output: 'out.pdf', sidecar: 'out.txt', languages: 'eng', image: false });
    expect(args[args.indexOf('--color-conversion-strategy') + 1]).toBe('RGB');
  });
});

// The real thing, where the tools exist: the Docker image, or a host with
// ocrmypdf and ImageMagick installed. Everywhere else it reports as skipped.
const hasOcr = (await detectOcr()) !== null;

/** The font the image installs for this test. Its digits are unambiguous to Tesseract. */
const PREFERRED_FONT = 'DejaVu-Sans';

/**
 * A font ImageMagick will actually load. A slim image has no default one, so
 * `-annotate` fails with "unable to read font ''" unless the name is given —
 * and which names exist differs per host, so it asks rather than assuming.
 * The first one listed is not good enough on Debian: that is AvantGarde, whose
 * "1" is a bare stroke Tesseract reads as "]".
 */
const font = await exec('magick', ['-list', 'font']).then(
  ({ stdout }) => {
    const names = [...stdout.matchAll(/^\s*Font:\s*(\S+)/gm)].map(([, name]) => name);
    return names.find((name) => name === PREFERRED_FONT) ?? names[0] ?? null;
  },
  () => null,
);

const isOcrMissing = hasOcr === false || !font;

/** A PNG of one line of large black text on white, which Tesseract reads without trouble. */
async function drawText(path: string, text: string) {
  await exec('magick', [
    '-size',
    '1200x300',
    'xc:white',
    '-fill',
    'black',
    '-font',
    font ?? '',
    '-pointsize',
    '96',
    '-annotate',
    '+60+190',
    text,
    path,
  ]);
}

describe.skipIf(isOcrMissing)('ocrmypdf integration', () => {
  it('turns an image of text into a searchable PDF and its text', { timeout: 120_000 }, async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-ocr-test-'));
    try {
      const image = join(tmpDir, 'scan.png');
      await drawText(image, 'Invoice 4821');
      const storage = createFakeStorage();
      const document = doc();
      storage.files.objects.set(document.originalKey, { body: await readFile(image), contentType: 'image/png' });

      const patch = await ocrStep.run({
        doc: document,
        db: await createTestDb(),
        storage,
        config: CONFIG,
        embedder: createFakeEmbedder(),
        tmpDir,
      });

      const text = storage.text.objects.get(patch?.contentKey ?? '');
      expect(text?.body.toString()).toMatch(/Invoice\s+4821/);
      const archive = storage.files.objects.get(patch?.archiveKey ?? '');
      expect(archive?.body.subarray(0, 5).toString()).toBe('%PDF-');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ocrmypdf refuses an image with an alpha channel, which a WebP often has, and
  // reads every frame of an animated GIF as a page. Both go in as a PNG of the first frame.
  it('reads a transparent WebP, and only the first frame of an animated GIF', { timeout: 240_000 }, async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-ocr-test-'));
    try {
      const first = join(tmpDir, 'first.png');
      const second = join(tmpDir, 'second.png');
      await drawText(first, 'Invoice 4821');
      await drawText(second, 'Refund 9907');
      const webp = join(tmpDir, 'scan.webp');
      const gif = join(tmpDir, 'scan.gif');
      // Pillow, which is wherever ocrmypdf is: the white made see-through, and the two pages as frames.
      await exec('python3', [
        '-c',
        [
          'import sys',
          'from PIL import Image',
          'first, second = Image.open(sys.argv[1]).convert("RGBA"), Image.open(sys.argv[2]).convert("RGB")',
          'first.putalpha(first.convert("L").point(lambda v: 255 - v))',
          'first.save(sys.argv[3], "WEBP", lossless=True)',
          'frames = [Image.open(sys.argv[1]).convert("RGB"), second]',
          'frames[0].save(sys.argv[4], save_all=True, append_images=frames[1:], duration=500, loop=0)',
        ].join('\n'),
        first,
        second,
        webp,
        gif,
      ]);

      for (const [path, mimeType] of [
        [webp, 'image/webp'],
        [gif, 'image/gif'],
      ] as const) {
        const storage = createFakeStorage();
        const document = doc({ mimeType });
        storage.files.objects.set(document.originalKey, { body: await readFile(path), contentType: mimeType });

        const patch = await ocrStep.run({
          doc: document,
          db: await createTestDb(),
          storage,
          config: CONFIG,
          embedder: createFakeEmbedder(),
          tmpDir,
        });

        const text = storage.text.objects.get(patch?.contentKey ?? '')?.body.toString();
        expect(text, mimeType).toMatch(/Invoice\s+4821/);
        expect(text, mimeType).not.toMatch(/9907/);
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ocrmypdf skips a page that already has text, and its sidecar says only that
  // it did. The text has to come from the archive's text layer instead.
  it('keeps the text of a PDF that already had some', { timeout: 120_000 }, async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-ocr-test-'));
    try {
      const storage = createFakeStorage();
      const document = doc({ mimeType: 'application/pdf', originalFilename: 'invoice.pdf' });
      storage.files.objects.set(document.originalKey, {
        body: bornDigitalPdf('Born digital invoice 4711'),
        contentType: 'application/pdf',
      });

      const patch = await ocrStep.run({
        doc: document,
        db: await createTestDb(),
        storage,
        config: CONFIG,
        embedder: createFakeEmbedder(),
        tmpDir,
      });

      const text = storage.text.objects.get(patch?.contentKey ?? '')?.body.toString();
      expect(text).toMatch(/Born digital invoice 4711/);
      expect(text).not.toMatch(/OCR skipped/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

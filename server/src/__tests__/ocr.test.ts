import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { describe, expect, it } from 'vitest';
import { detectOcr, ocrArgs, ocrStep } from '../pipeline/steps/ocr.ts';
import type { PipelineConfig } from '../pipeline/types.ts';
import { createFakeStorage } from './helpers.ts';

const exec = promisify(execFile);

const CONFIG: PipelineConfig = { ocrAvailable: true, ocrLanguages: 'eng', concurrency: 1 };

function doc(values: Partial<Document> = {}): Document {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
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
});

// The real thing, where the tools exist: the Docker image, or a host with
// ocrmypdf and ImageMagick installed. Everywhere else it reports as skipped.
const hasOcr = (await detectOcr()) !== null;

/**
 * A font ImageMagick will actually load. Alpine's build has no default one, so
 * `-annotate` fails with "unable to read font ''" unless the name is given —
 * and which names exist differs per host, so it asks rather than assuming.
 */
const font = await exec('magick', ['-list', 'font']).then(
  ({ stdout }) => stdout.match(/^\s*Font:\s*(\S+)/m)?.[1] ?? null,
  () => null,
);

describe.skipIf(!hasOcr || !font)('ocrmypdf integration', () => {
  it('turns an image of text into a searchable PDF and its text', { timeout: 120_000 }, async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-ocr-test-'));
    try {
      const image = join(tmpDir, 'scan.png');
      await exec('magick', [
        '-size',
        '1200x300',
        'xc:white',
        '-fill',
        'black',
        '-font',
        font as string,
        '-pointsize',
        '96',
        '-annotate',
        '+60+190',
        'Invoice 4821',
        image,
      ]);
      const storage = createFakeStorage();
      const document = doc();
      storage.files.objects.set(document.originalKey, { body: await readFile(image), contentType: 'image/png' });

      const patch = await ocrStep.run({ doc: document, db: null, storage, config: CONFIG, tmpDir });

      const text = storage.text.objects.get(patch?.contentKey ?? '');
      expect(text?.body.toString()).toMatch(/Invoice\s+4821/);
      const archive = storage.files.objects.get(patch?.archiveKey ?? '');
      expect(archive?.body.subarray(0, 5).toString()).toBe('%PDF-');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

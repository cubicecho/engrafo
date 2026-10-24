import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { describe, expect, it } from 'vitest';
import { detectPdfText } from '../../pipeline/pdf-text.ts';
import { pdfTextStep } from '../../pipeline/steps/pdf-text.ts';
import type { RunConfig } from '../../pipeline/types.ts';
import { bornDigitalPdf, createFakeEmbedder, createFakeStorage, createTestDb } from '../helpers.ts';

const CONFIG: RunConfig = {
  ocrAvailable: true,
  pdfTextAvailable: true,
  thumbnailTools: { pdf: false, image: false },
  ocrLanguages: 'eng',
  concurrency: 1,
  dateOrder: 'DMY',
  vision: null,
};

function doc(values: Partial<Document> = {}): Document {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    folderId: null,
    title: 'Invoice',
    originalFilename: 'invoice.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1,
    checksumSha256: null,
    originalKey: 'originals/u/invoice',
    archiveKey: null,
    contentKey: null,
    contentBytes: null,
    thumbnailKey: null,
    documentDate: null,
    documentDateSource: null,
    vendor: null,
    total: null,
    currency: null,
    receiptSource: null,
    ocrRequested: false,
    visionRequested: false,
    status: 'processing',
    error: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  };
}

describe('pdf-text step', () => {
  it('reads a PDF whenever OCR is not going to', () => {
    expect(pdfTextStep.enabled(doc(), CONFIG)).toBe(true);
    expect(pdfTextStep.enabled(doc({ ocrRequested: true }), { ...CONFIG, ocrAvailable: false })).toBe(true);
  });

  it('stands aside when OCR runs, which reads the text itself, and without pdftotext', () => {
    expect(pdfTextStep.enabled(doc({ ocrRequested: true }), CONFIG)).toBe(false);
    expect(pdfTextStep.enabled(doc(), { ...CONFIG, pdfTextAvailable: false })).toBe(false);
    expect(pdfTextStep.enabled(doc({ mimeType: 'image/png' }), CONFIG)).toBe(false);
    expect(pdfTextStep.enabled(doc({ mimeType: 'text/plain' }), CONFIG)).toBe(false);
  });
});

// The real tool, where it exists: the Docker image, or a host with poppler-utils.
describe.skipIf((await detectPdfText()) === false)('pdftotext integration', () => {
  it('stores the text layer of a PDF that was made, not scanned', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-pdf-text-test-'));
    try {
      const storage = createFakeStorage();
      const document = doc();
      storage.files.objects.set(document.originalKey, {
        body: bornDigitalPdf('Born digital invoice 4711'),
        contentType: 'application/pdf',
      });

      const patch = await pdfTextStep.run({
        doc: document,
        db: await createTestDb(),
        storage,
        config: CONFIG,
        embedder: createFakeEmbedder(),
        tmpDir,
      });

      expect(storage.text.objects.get(patch?.contentKey ?? '')?.body.toString()).toBe('Born digital invoice 4711');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

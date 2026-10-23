import type { Document } from '@cubicecho/engrafo-db/schema';
import { describe, expect, it } from 'vitest';
import { metadataPatch, metadataStep } from '../../pipeline/steps/metadata.ts';
import type { PipelineConfig } from '../../pipeline/types.ts';
import { createFakeEmbedder, createFakeStorage, type TestDb } from '../helpers.ts';

const CONFIG: PipelineConfig = {
  ocrAvailable: false,
  pdfTextAvailable: false,
  ocrLanguages: 'eng',
  concurrency: 1,
  dateOrder: 'DMY',
};
const TODAY = '2026-10-23';

function doc(values: Partial<Document> = {}): Document {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    folderId: null,
    title: 'Receipt',
    originalFilename: 'receipt.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1,
    checksumSha256: null,
    originalKey: 'originals/u/d',
    archiveKey: null,
    contentKey: null,
    contentBytes: null,
    documentDate: null,
    documentDateSource: null,
    vendor: null,
    total: null,
    currency: null,
    receiptSource: null,
    ocrRequested: false,
    status: 'processing',
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  };
}

describe('the metadata step', () => {
  it('fills in the date it reads, as extracted', () => {
    expect(metadataPatch(doc(), 'Rechnung vom 12.03.2025', CONFIG, TODAY)).toMatchObject({
      documentDate: '2025-03-12',
      documentDateSource: 'extracted',
    });
  });

  it('reads an ambiguous date in the configured order', () => {
    expect(metadataPatch(doc(), 'Date 03/04/2025', { dateOrder: 'MDY' }, TODAY)).toMatchObject({
      documentDate: '2025-03-04',
    });
  });

  it('replaces an extracted date, and clears it when the new text has none', () => {
    const before = doc({ documentDate: '2020-01-01', documentDateSource: 'extracted' });
    expect(metadataPatch(before, 'No date here.', CONFIG, TODAY)).toMatchObject({
      documentDate: null,
      documentDateSource: null,
    });
  });

  it('never touches a date the user set, or cleared', () => {
    const set = doc({ documentDate: '2020-01-01', documentDateSource: 'user' });
    expect(metadataPatch(set, 'Dated 12.03.2025', CONFIG, TODAY)).not.toHaveProperty('documentDate');
    const cleared = doc({ documentDate: null, documentDateSource: 'user' });
    expect(metadataPatch(cleared, 'Dated 12.03.2025', CONFIG, TODAY)).not.toHaveProperty('documentDate');
  });

  it('reads the text from the text bucket, and runs for a document with none', async () => {
    const storage = createFakeStorage();
    storage.text.objects.set('text/u/d', { body: Buffer.from('Issued 1 March 2024'), contentType: 'text/plain' });
    const context = { db: {} as TestDb, storage, config: CONFIG, embedder: createFakeEmbedder(), tmpDir: '/tmp' };

    expect(metadataStep.enabled(doc(), CONFIG)).toBe(true);
    expect(await metadataStep.run({ ...context, doc: doc({ contentKey: 'text/u/d' }) })).toMatchObject({
      documentDate: '2024-03-01',
    });
    expect(await metadataStep.run({ ...context, doc: doc() })).toMatchObject({ documentDate: null });
  });
});

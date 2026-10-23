import type { Document } from '@cubicecho/engrafo-db/schema';
import { describe, expect, it } from 'vitest';
import { metadataPatch, metadataStep } from '../../pipeline/steps/metadata.ts';
import type { RunConfig } from '../../pipeline/types.ts';
import { createFakeEmbedder, createFakeStorage, type TestDb } from '../helpers.ts';

const CONFIG: RunConfig = {
  ocrAvailable: false,
  pdfTextAvailable: false,
  ocrLanguages: 'eng',
  concurrency: 1,
  dateOrder: 'DMY',
  vision: null,
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
    visionRequested: false,
    status: 'processing',
    error: null,
    deletedAt: null,
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

  const RECEIPT = { vendor: 'REWE', total: '12.67', currency: 'EUR' };

  it('fills in the receipt fields, as extracted', () => {
    expect(metadataPatch(doc(), '', CONFIG, TODAY, RECEIPT)).toMatchObject({
      ...RECEIPT,
      receiptSource: 'extracted',
    });
  });

  it('clears extracted receipt fields when the new text has none', () => {
    const before = doc({ ...RECEIPT, receiptSource: 'extracted' });
    expect(metadataPatch(before, '', CONFIG, TODAY)).toMatchObject({
      vendor: null,
      total: null,
      currency: null,
      receiptSource: null,
    });
  });

  it('never touches a receipt the user edited, any field of it', () => {
    const edited = doc({ vendor: 'My shop', total: null, currency: null, receiptSource: 'user' });
    const patch = metadataPatch(edited, '', CONFIG, TODAY, RECEIPT);
    expect(patch).not.toHaveProperty('vendor');
    expect(patch).not.toHaveProperty('total');
    expect(patch).not.toHaveProperty('receiptSource');
  });

  it('does not take an ebook or a Markdown note for a receipt', () => {
    expect(metadataPatch(doc({ mimeType: 'text/markdown' }), '', CONFIG, TODAY, RECEIPT)).toMatchObject({
      total: null,
      receiptSource: null,
    });
  });

  it('reads the text from the text bucket, and runs for a document with none', async () => {
    const storage = createFakeStorage();
    const receipt = 'Bäckerei Müller\nIssued 1 March 2024\nBrot 3,50\nSumme EUR 3,50';
    storage.text.objects.set('text/u/d', { body: Buffer.from(receipt), contentType: 'text/plain' });
    const context = { db: {} as TestDb, storage, config: CONFIG, embedder: createFakeEmbedder(), tmpDir: '/tmp' };

    expect(metadataStep.enabled(doc(), CONFIG)).toBe(true);
    expect(await metadataStep.run({ ...context, doc: doc({ contentKey: 'text/u/d' }) })).toEqual({
      documentDate: '2024-03-01',
      documentDateSource: 'extracted',
      vendor: 'Bäckerei Müller',
      total: '3.50',
      currency: 'EUR',
      receiptSource: 'extracted',
    });
    expect(await metadataStep.run({ ...context, doc: doc() })).toMatchObject({ documentDate: null });
  });
});

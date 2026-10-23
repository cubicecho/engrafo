import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectStep } from '../../pipeline/steps/inspect.ts';
import { textStep } from '../../pipeline/steps/text.ts';
import type { PipelineConfig, StepContext } from '../../pipeline/types.ts';
import { createFakeEmbedder, createFakeStorage, createTestDb, type FakeStorage } from '../helpers.ts';

const CONFIG: PipelineConfig = {
  ocrAvailable: true,
  pdfTextAvailable: true,
  ocrLanguages: 'eng',
  concurrency: 1,
  dateOrder: 'DMY',
};
const NOTES = '# Server\n\nIt runs on the NAS.\n';

function doc(values: Partial<Document> = {}): Document {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    folderId: null,
    title: 'notes',
    originalFilename: 'notes.md',
    mimeType: 'text/markdown',
    sizeBytes: NOTES.length,
    checksumSha256: null,
    originalKey: 'originals/u/notes',
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

describe('text step', () => {
  let tmpDir: string;
  let storage: FakeStorage;
  let context: (document: Document) => Promise<StepContext>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-text-test-'));
    storage = createFakeStorage();
    storage.files.objects.set(doc().originalKey, { body: Buffer.from(NOTES), contentType: 'text/markdown' });
    const db = await createTestDb();
    context = async (document) => ({
      doc: document,
      db,
      storage,
      config: CONFIG,
      embedder: createFakeEmbedder(),
      tmpDir,
    });
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('runs for plain text and Markdown', () => {
    expect(textStep.enabled(doc(), CONFIG)).toBe(true);
    expect(textStep.enabled(doc({ mimeType: 'text/plain' }), CONFIG)).toBe(true);
    expect(textStep.enabled(doc({ mimeType: 'application/pdf' }), CONFIG)).toBe(false);
  });

  it('takes the upload at its word for Markdown, which has no magic bytes', async () => {
    expect((await inspectStep.run(await context(doc())))?.mimeType).toBe('text/markdown');
  });

  it('still refuses a file with no magic bytes that claimed some other type', async () => {
    await expect(inspectStep.run(await context(doc({ mimeType: 'application/pdf' })))).rejects.toThrow(
      'Unsupported file type',
    );
  });

  it('stores Markdown as it is, headings and all', async () => {
    const patch = await textStep.run(await context(doc()));
    expect(storage.text.objects.get(patch?.contentKey ?? '')?.body.toString()).toBe(NOTES.trim());
  });
});

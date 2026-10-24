import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectStep } from '../../pipeline/steps/inspect.ts';
import { textStep } from '../../pipeline/steps/text.ts';
import type { RunConfig, StepContext } from '../../pipeline/types.ts';
import { createFakeEmbedder, createFakeStorage, createTestDb, type FakeStorage } from '../helpers.ts';

const CONFIG: RunConfig = {
  ocrAvailable: true,
  pdfTextAvailable: true,
  thumbnailTools: { pdf: false, image: false },
  ocrLanguages: 'eng',
  concurrency: 1,
  dateOrder: 'DMY',
  vision: null,
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

  it('runs for plain text, Markdown, CSV and HTML', () => {
    expect(textStep.enabled(doc(), CONFIG)).toBe(true);
    expect(textStep.enabled(doc({ mimeType: 'text/plain' }), CONFIG)).toBe(true);
    expect(textStep.enabled(doc({ mimeType: 'text/csv' }), CONFIG)).toBe(true);
    expect(textStep.enabled(doc({ mimeType: 'text/html' }), CONFIG)).toBe(true);
    expect(textStep.enabled(doc({ mimeType: 'application/pdf' }), CONFIG)).toBe(false);
  });

  it('takes the upload at its word for Markdown, CSV and HTML, which have no magic bytes', async () => {
    expect((await inspectStep.run(await context(doc())))?.mimeType).toBe('text/markdown');
    expect((await inspectStep.run(await context(doc({ mimeType: 'text/csv' }))))?.mimeType).toBe('text/csv');
    expect((await inspectStep.run(await context(doc({ mimeType: 'text/html' }))))?.mimeType).toBe('text/html');
  });

  it('reads XHTML as a web page, though its bytes say only XML', async () => {
    const xhtml = '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>';
    storage.files.objects.set(doc().originalKey, { body: Buffer.from(xhtml), contentType: 'text/html' });

    expect((await inspectStep.run(await context(doc({ mimeType: 'text/html' }))))?.mimeType).toBe('text/html');
    // XML claiming anything else is still XML, which is not on the list.
    await expect(inspectStep.run(await context(doc({ mimeType: 'text/plain' })))).rejects.toThrow(
      'Unsupported file type (application/xml)',
    );
  });

  it('stores a CSV as it is', async () => {
    const csv = 'Date,Amount\n2024-01-02,-3.50';
    storage.files.objects.set(doc().originalKey, { body: Buffer.from(csv), contentType: 'text/csv' });

    const patch = await textStep.run(await context(doc({ mimeType: 'text/csv' })));
    expect(storage.text.objects.get(patch?.contentKey ?? '')?.body.toString()).toBe(csv);
  });

  it('stores a CSV written in a Windows code page as UTF-8', async () => {
    // "Café,£4.50" as windows-1252 writes it.
    const bytes = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x2c, 0xa3, 0x34, 0x2e, 0x35, 0x30]);
    storage.files.objects.set(doc().originalKey, { body: bytes, contentType: 'text/csv' });

    const patch = await textStep.run(await context(doc({ mimeType: 'text/csv' })));
    expect(storage.text.objects.get(patch?.contentKey ?? '')?.body.toString()).toBe('Café,£4.50');
  });

  it("stores a web page's text, not its markup", async () => {
    const html = '<html><head><script>steal()</script></head><body><h1>Order 1234</h1><p>One kettle.</p></body></html>';
    storage.files.objects.set(doc().originalKey, { body: Buffer.from(html), contentType: 'text/html' });

    const patch = await textStep.run(await context(doc({ mimeType: 'text/html' })));
    expect(storage.text.objects.get(patch?.contentKey ?? '')?.body.toString()).toBe('# Order 1234\n\nOne kettle.');
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

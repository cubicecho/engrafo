import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ebookStep } from '../../pipeline/steps/ebook.ts';
import { inspectStep } from '../../pipeline/steps/inspect.ts';
import type { RunConfig, StepContext } from '../../pipeline/types.ts';
import {
  createFakeEmbedder,
  createFakeStorage,
  createTestDb,
  epubFile,
  type FakeStorage,
  noProgress,
} from '../helpers.ts';

const CONFIG: RunConfig = {
  ocrAvailable: true,
  pdfTextAvailable: true,
  thumbnailTools: { pdf: false, image: false },
  ocrLanguages: 'eng',
  concurrency: 1,
  dateOrder: 'DMY',
  vision: null,
};

const BOOK = epubFile({
  'OEBPS/content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/>
  <manifest>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine><itemref idref="one"/></spine>
</package>`,
  'OEBPS/nav.xhtml':
    '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml">The Storm</a></li></ol></nav></body></html>',
  'OEBPS/one.xhtml': '<html><body><p>Rain fell on the harbour.</p></body></html>',
});

function doc(values: Partial<Document> = {}): Document {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    folderId: null,
    title: 'Storm',
    originalFilename: 'storm.epub',
    mimeType: 'application/epub+zip',
    sizeBytes: BOOK.length,
    checksumSha256: null,
    originalKey: 'originals/u/storm',
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
    ocrRequested: true,
    visionRequested: false,
    status: 'processing',
    error: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  };
}

describe('ebook step', () => {
  let tmpDir: string;
  let storage: FakeStorage;
  let context: (document: Document) => Promise<StepContext>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-ebook-test-'));
    storage = createFakeStorage();
    storage.files.objects.set(doc().originalKey, { body: BOOK, contentType: 'application/epub+zip' });
    const db = await createTestDb();
    context = async (document) => ({
      doc: document,
      db,
      storage,
      config: CONFIG,
      embedder: createFakeEmbedder(),
      reportProgress: noProgress,
      tmpDir,
    });
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('runs for an EPUB and nothing else', () => {
    expect(ebookStep.enabled(doc(), CONFIG)).toBe(true);
    expect(ebookStep.enabled(doc({ mimeType: 'application/pdf' }), CONFIG)).toBe(false);
    expect(ebookStep.enabled(doc({ mimeType: 'text/plain' }), CONFIG)).toBe(false);
  });

  it('knows an EPUB by its bytes, whatever the browser called it', async () => {
    const patch = await inspectStep.run(await context(doc({ mimeType: 'application/octet-stream' })));
    expect(patch?.mimeType).toBe('application/epub+zip');
  });

  it('stores the text with each chapter named above it', async () => {
    const patch = await ebookStep.run(await context(doc()));

    const stored = storage.text.objects.get(patch?.contentKey ?? '')?.body.toString();
    expect(stored).toBe('# The Storm\n\nRain fell on the harbour.');
    expect(patch?.contentBytes).toBe(Buffer.byteLength(stored ?? ''));
    expect(patch?.archiveKey).toBeUndefined();
  });
});

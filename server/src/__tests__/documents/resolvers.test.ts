import { documents, processingSteps } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { createPipelineEvents, type PipelineEvents } from '../../pipeline/events.ts';
import {
  createClient,
  createFakeStorage,
  createTestDb,
  createUser,
  type FakeStorage,
  type TestDb,
} from '../helpers.ts';

const CREATE = `
  mutation ($input: CreateDocumentUploadInput!) {
    createDocumentUpload(input: $input) {
      document { id title status mimeType sizeBytes ocrRequested originalKey }
      uploadUrl
      uploadHeaders { name value }
    }
  }
`;
const COMPLETE = 'mutation ($id: UUID!) { completeDocumentUpload(id: $id) { id status } }';

describe('document uploads', () => {
  let db: TestDb;
  let userId: string;
  let storage: FakeStorage;
  let events: PipelineEvents;
  let emitted: string[];

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
    storage = createFakeStorage();
    events = createPipelineEvents();
    emitted = [];
    events.on('document.uploaded', ({ documentId }) => emitted.push(documentId));
  });

  const client = () => createClient(db, userId, { storage, events });

  async function createUpload(input: Record<string, unknown> = {}) {
    const data = await client().expectOk(CREATE, {
      input: { filename: 'scan.pdf', mimeType: 'application/pdf', sizeBytes: 5, ...input },
    });
    return data.createDocumentUpload;
  }

  it('creates a pending row and signs a PUT for a key the server chose', async () => {
    const upload = await createUpload({ ocr: false });
    expect(upload.document).toMatchObject({
      title: 'scan',
      status: 'pending_upload',
      mimeType: 'application/pdf',
      sizeBytes: 5,
      ocrRequested: false,
    });
    expect(upload.document.originalKey).toBe(`originals/${userId}/${upload.document.id}`);
    expect(upload.uploadUrl).toBe(`https://s3.test/put/${upload.document.originalKey}`);
    expect(upload.uploadHeaders).toEqual([{ name: 'Content-Type', value: 'application/pdf' }]);
  });

  it('rejects unsupported types and oversized files', async () => {
    const type = await client().expectError(CREATE, {
      input: { filename: 'x.exe', mimeType: 'application/x-msdownload', sizeBytes: 5 },
    });
    expect(type.code).toBe(ErrorCode.BadUserInput);
    const size = await client().expectError(CREATE, {
      input: { filename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 1024 ** 4 },
    });
    expect(size.code).toBe(ErrorCode.BadUserInput);
  });

  it('will not complete before the object exists, or when its size differs', async () => {
    const { document } = await createUpload();
    const missing = await client().expectError(COMPLETE, { id: document.id });
    expect(missing.code).toBe(ErrorCode.BadUserInput);

    storage.files.objects.set(document.originalKey, { body: Buffer.from('123'), contentType: 'application/pdf' });
    const wrongSize = await client().expectError(COMPLETE, { id: document.id });
    expect(wrongSize.code).toBe(ErrorCode.BadUserInput);
    expect(emitted).toEqual([]);
  });

  it('completes once: queues every step and emits exactly one event', async () => {
    const { document } = await createUpload();
    storage.files.objects.set(document.originalKey, { body: Buffer.from('%PDF-'), contentType: 'application/pdf' });

    const first = await client().expectOk(COMPLETE, { id: document.id });
    const second = await client().expectOk(COMPLETE, { id: document.id });
    expect(first.completeDocumentUpload.status).toBe('uploaded');
    expect(second.completeDocumentUpload.status).toBe('uploaded');
    expect(emitted).toEqual([document.id]);

    const steps = await db.select().from(processingSteps).where(eq(processingSteps.documentId, document.id));
    expect(steps.map((step: { step: string; status: string }) => [step.step, step.status])).toEqual([
      ['inspect', 'queued'],
      ['text', 'queued'],
      ['ocr', 'queued'],
      ['pdf-text', 'queued'],
    ]);
  });

  it('retries only a failed document, resetting its failed step', async () => {
    const { document } = await createUpload();
    const retry = 'mutation ($id: UUID!) { retryDocumentProcessing(id: $id) { status error } }';
    expect((await client().expectError(retry, { id: document.id })).code).toBe(ErrorCode.BadUserInput);

    await db.update(documents).set({ status: 'failed', error: 'ocr: boom' }).where(eq(documents.id, document.id));
    await db
      .insert(processingSteps)
      .values({ userId, documentId: document.id, step: 'ocr', position: 2, status: 'failed', error: 'boom' });

    const data = await client().expectOk(retry, { id: document.id });
    expect(data.retryDocumentProcessing).toEqual({ status: 'uploaded', error: null });
    const [step] = await db.select().from(processingSteps).where(eq(processingSteps.documentId, document.id));
    expect(step).toMatchObject({ status: 'queued', error: null });
    expect(emitted).toEqual([document.id]);
  });

  it('starts one run when the same document is retried twice at once', async () => {
    const { document } = await createUpload();
    const retry = 'mutation ($id: UUID!) { retryDocumentProcessing(id: $id) { status } }';
    await db.update(documents).set({ status: 'failed', error: 'ocr: boom' }).where(eq(documents.id, document.id));
    await db
      .insert(processingSteps)
      .values({ userId, documentId: document.id, step: 'ocr', position: 2, status: 'failed', error: 'boom' });

    await Promise.all([client().run(retry, { id: document.id }), client().run(retry, { id: document.id })]);

    expect(emitted).toEqual([document.id]);
    const [step] = await db.select().from(processingSteps).where(eq(processingSteps.documentId, document.id));
    expect(step).toMatchObject({ status: 'queued', error: null });
  });

  describe('reprocessDocument', () => {
    const REPROCESS =
      'mutation ($id: UUID!, $ocr: Boolean) { reprocessDocument(id: $id, ocr: $ocr) { status error ocrRequested archiveKey contentKey } }';

    /** A document that finished, with an archive and text in the buckets and every step done. */
    async function finished(status: 'ready' | 'failed' = 'ready') {
      const { document } = await createUpload({ ocr: false });
      const archiveKey = `archives/${userId}/${document.id}`;
      const contentKey = `text/${userId}/${document.id}`;
      storage.files.objects.set(archiveKey, { body: Buffer.from('%PDF-'), contentType: 'application/pdf' });
      storage.text.objects.set(contentKey, { body: Buffer.from('old text'), contentType: 'text/plain' });
      await db
        .update(documents)
        .set({ status, archiveKey, contentKey, contentBytes: 8 })
        .where(eq(documents.id, document.id));
      await db.insert(processingSteps).values([
        { userId, documentId: document.id, step: 'inspect', position: 0, status: 'succeeded' },
        { userId, documentId: document.id, step: 'ocr', position: 2, status: 'skipped' },
      ]);
      return { id: document.id, archiveKey, contentKey };
    }

    it('re-runs every step of a ready document and forgets what the last run produced', async () => {
      const { id, archiveKey, contentKey } = await finished();

      const data = await client().expectOk(REPROCESS, { id });
      expect(data.reprocessDocument).toEqual({
        status: 'uploaded',
        error: null,
        ocrRequested: false,
        archiveKey: null,
        contentKey: null,
      });
      const steps = await db.select().from(processingSteps).where(eq(processingSteps.documentId, id));
      expect(steps.map((step: { status: string }) => step.status)).toEqual(['queued', 'queued']);
      expect(storage.files.objects.has(archiveKey)).toBe(false);
      expect(storage.text.objects.has(contentKey)).toBe(false);
      expect(emitted).toEqual([id]);
    });

    it('turns OCR on for the run when asked, and refuses where OCR is unavailable', async () => {
      const { id } = await finished('failed');
      expect((await client().expectError(REPROCESS, { id, ocr: true })).code).toBe(ErrorCode.BadUserInput);

      const withOcr = createClient(db, userId, { storage, events, ocrAvailable: true });
      const data = await withOcr.expectOk(REPROCESS, { id, ocr: true });
      expect(data.reprocessDocument.ocrRequested).toBe(true);
    });

    it('refuses a document still uploading or already processing', async () => {
      const { document } = await createUpload();
      expect((await client().expectError(REPROCESS, { id: document.id })).code).toBe(ErrorCode.BadUserInput);
      await db.update(documents).set({ status: 'processing' }).where(eq(documents.id, document.id));
      expect((await client().expectError(REPROCESS, { id: document.id })).code).toBe(ErrorCode.Conflict);
      expect(emitted).toEqual([]);
    });

    it('starts one run when re-run twice at once', async () => {
      const { id } = await finished();
      await Promise.all([client().run(REPROCESS, { id }), client().run(REPROCESS, { id })]);
      expect(emitted).toEqual([id]);
    });

    it("answers NOT_FOUND for someone else's document", async () => {
      const { id } = await finished();
      const stranger = await createUser(db, 'stranger@example.com');
      const error = await createClient(db, stranger, { storage, events }).expectError(REPROCESS, { id });
      expect(error.code).toBe(ErrorCode.NotFound);
    });
  });

  it('renames, and refuses an empty title', async () => {
    const { document } = await createUpload();
    const rename = 'mutation ($id: UUID!, $title: String!) { renameDocument(id: $id, title: $title) { title } }';
    const data = await client().expectOk(rename, { id: document.id, title: '  Tax return 2025 ' });
    expect(data.renameDocument.title).toBe('Tax return 2025');
    expect((await client().expectError(rename, { id: document.id, title: '   ' })).code).toBe(ErrorCode.BadUserInput);
  });

  it('signs file URLs only for files that exist', async () => {
    const { document } = await createUpload();
    const query = 'query ($id: UUID!, $variant: DocumentFileVariant!) { documentFileUrl(id: $id, variant: $variant) }';
    expect((await client().expectError(query, { id: document.id, variant: 'ORIGINAL' })).code).toBe(ErrorCode.NotFound);

    await db.update(documents).set({ status: 'ready' }).where(eq(documents.id, document.id));
    const original = await client().expectOk(query, { id: document.id, variant: 'ORIGINAL' });
    expect(original.documentFileUrl).toBe(`https://s3.test/get/${document.originalKey}`);
    expect((await client().expectError(query, { id: document.id, variant: 'ARCHIVE' })).code).toBe(ErrorCode.NotFound);
  });

  it('deletes the row and its objects', async () => {
    const { document } = await createUpload();
    const archiveKey = `archive/${userId}/${document.id}.pdf`;
    const contentKey = `text/${userId}/${document.id}.txt`;
    await db.update(documents).set({ status: 'ready', archiveKey, contentKey }).where(eq(documents.id, document.id));
    storage.files.objects.set(document.originalKey, { body: Buffer.from('a'), contentType: 'application/pdf' });
    storage.files.objects.set(archiveKey, { body: Buffer.from('b'), contentType: 'application/pdf' });
    storage.text.objects.set(contentKey, { body: Buffer.from('c'), contentType: 'text/plain' });

    const data = await client().expectOk('mutation ($id: UUID!) { deleteDocument(id: $id) }', { id: document.id });
    expect(data.deleteDocument).toBe(true);
    expect(storage.files.objects.size).toBe(0);
    expect(storage.text.objects.size).toBe(0);
    expect(await db.select().from(documents)).toEqual([]);
  });

  it('reports server config', async () => {
    const data = await createClient(db, userId, { ocrAvailable: true }).expectOk(
      '{ serverConfig { version maxUploadBytes acceptedMimeTypes ocrAvailable } }',
    );
    expect(data.serverConfig.ocrAvailable).toBe(true);
    expect(data.serverConfig.acceptedMimeTypes).toContain('application/pdf');
    // Not just "a string": the version is read off package.json by a relative
    // path, and the Dockerfile lays the image out differently from the repo. A
    // wrong path fails soft as "unknown", which is exactly what the settings
    // screen and a bug report would then quote.
    expect(data.serverConfig.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

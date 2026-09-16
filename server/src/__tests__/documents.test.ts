import { documents, processingSteps } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPipelineEvents, type PipelineEvents } from '../pipeline/events.ts';
import { createClient, createFakeStorage, createTestDb, createUser, type FakeStorage, type TestDb } from './helpers.ts';

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
    expect(type.code).toBe('BAD_USER_INPUT');
    const size = await client().expectError(CREATE, {
      input: { filename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 1024 ** 4 },
    });
    expect(size.code).toBe('BAD_USER_INPUT');
  });

  it('will not complete before the object exists, or when its size differs', async () => {
    const { document } = await createUpload();
    const missing = await client().expectError(COMPLETE, { id: document.id });
    expect(missing.code).toBe('BAD_USER_INPUT');

    storage.files.objects.set(document.originalKey, { body: Buffer.from('123'), contentType: 'application/pdf' });
    const wrongSize = await client().expectError(COMPLETE, { id: document.id });
    expect(wrongSize.code).toBe('BAD_USER_INPUT');
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
    ]);
  });

  it('retries only a failed document, resetting its failed step', async () => {
    const { document } = await createUpload();
    const retry = 'mutation ($id: UUID!) { retryDocumentProcessing(id: $id) { status error } }';
    expect((await client().expectError(retry, { id: document.id })).code).toBe('BAD_USER_INPUT');

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

  it('renames, and refuses an empty title', async () => {
    const { document } = await createUpload();
    const rename = 'mutation ($id: UUID!, $title: String!) { renameDocument(id: $id, title: $title) { title } }';
    const data = await client().expectOk(rename, { id: document.id, title: '  Tax return 2025 ' });
    expect(data.renameDocument.title).toBe('Tax return 2025');
    expect((await client().expectError(rename, { id: document.id, title: '   ' })).code).toBe('BAD_USER_INPUT');
  });

  it('signs file URLs only for files that exist', async () => {
    const { document } = await createUpload();
    const query = 'query ($id: UUID!, $variant: DocumentFileVariant!) { documentFileUrl(id: $id, variant: $variant) }';
    expect((await client().expectError(query, { id: document.id, variant: 'ORIGINAL' })).code).toBe('NOT_FOUND');

    await db.update(documents).set({ status: 'ready' }).where(eq(documents.id, document.id));
    const original = await client().expectOk(query, { id: document.id, variant: 'ORIGINAL' });
    expect(original.documentFileUrl).toBe(`https://s3.test/get/${document.originalKey}`);
    expect((await client().expectError(query, { id: document.id, variant: 'ARCHIVE' })).code).toBe('NOT_FOUND');
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

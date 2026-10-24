import { documentChunks, documents, folders } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_DAY } from '../../core/wire.ts';
import { createPipelineEvents, type PipelineEvents } from '../../pipeline/events.ts';
import { indexDocument } from '../../search/index-document.ts';
import { searchDocuments } from '../../search/search.ts';
import { createTrashPurger } from '../../trash/purger.ts';
import {
  createClient,
  createFakeEmbedder,
  createFakeStorage,
  createTestDb,
  createUser,
  type FakeStorage,
  type TestDb,
} from '../helpers.ts';

const UPLOAD = `
  mutation ($input: CreateDocumentUploadInput!) {
    createDocumentUpload(input: $input) { document { id title folderId originalKey } }
  }
`;
const CREATE_FOLDER = 'mutation ($name: String!) { createFolder(name: $name) { id } }';
const DELETE = 'mutation ($id: UUID!) { deleteDocument(id: $id) }';
const DELETE_FOLDER = 'mutation ($id: UUID!) { deleteFolder(id: $id) }';
const RESTORE = 'mutation ($id: UUID!) { restoreDocument(id: $id) { id title folderId deletedAt } }';
const PURGE = 'mutation ($id: UUID!) { purgeDocument(id: $id) }';
const EMPTY = 'mutation { emptyTrash }';
const TRASH = '{ trash { count retentionDays documents { id title folderId deletedAt } } }';
const LIST = '{ documents { id } }';
const ONE = 'query ($id: UUID!) { document(where: { id: { eq: $id } }) { id } }';

const DAY_MS = SECONDS_PER_DAY * MS_PER_SECOND;

describe('the trash', () => {
  let db: TestDb;
  let userId: string;
  let otherId: string;
  let storage: FakeStorage;
  let events: PipelineEvents;
  let emitted: string[];
  const embedder = createFakeEmbedder();

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
    otherId = await createUser(db, 'other@example.com');
    storage = createFakeStorage();
    events = createPipelineEvents();
    emitted = [];
    events.on('document.uploaded', ({ documentId }) => emitted.push(documentId));
  });

  const client = () => createClient(db, userId, { storage, events, embedder });
  const other = () => createClient(db, otherId, { storage, events, embedder });

  /** A ready document with its original and its text stored. */
  async function filed(filename: string, folderId: string | null = null, status = 'ready') {
    const data = await client().expectOk(UPLOAD, {
      input: { filename, mimeType: 'application/pdf', sizeBytes: 5, folderId },
    });
    const doc = data.createDocumentUpload.document;
    const contentKey = `text/${userId}/${doc.id}`;
    storage.files.objects.set(doc.originalKey, { body: Buffer.from('%PDF-'), contentType: 'application/pdf' });
    storage.text.objects.set(contentKey, { body: Buffer.from('words'), contentType: 'text/plain' });
    await db
      .update(documents)
      .set({ status: status as 'ready', contentKey, checksumSha256: 'abc' })
      .where(eq(documents.id, doc.id));
    return { ...doc, contentKey };
  }

  async function folder(name: string): Promise<string> {
    return (await client().expectOk(CREATE_FOLDER, { name })).createFolder.id;
  }

  it('keeps a deleted document, with its files, out of every generated read', async () => {
    const doc = await filed('scan.pdf');
    expect((await client().expectOk(DELETE, { id: doc.id })).deleteDocument).toBe(true);

    expect(storage.files.objects.has(doc.originalKey)).toBe(true);
    expect(storage.text.objects.has(doc.contentKey)).toBe(true);
    expect((await client().expectOk(LIST)).documents).toEqual([]);
    expect((await client().expectOk(ONE, { id: doc.id })).document).toBeNull();

    const { trash } = await client().expectOk(TRASH);
    expect(trash.count).toBe(1);
    expect(trash.retentionDays).toBe(30);
    expect(trash.documents.map((row: { id: string }) => row.id)).toEqual([doc.id]);
    expect(trash.documents[0].deletedAt).toBeTruthy();
    // Someone else's trash is their own.
    expect((await other().expectOk(TRASH)).trash.count).toBe(0);
  });

  it('refuses every other write on a trashed document as NOT_FOUND', async () => {
    const doc = await filed('scan.pdf');
    await client().expectOk(DELETE, { id: doc.id });
    const rename = await client().expectError('mutation ($id: UUID!) { renameDocument(id: $id, title: "x") { id } }', {
      id: doc.id,
    });
    expect(rename.code).toBe(ErrorCode.NotFound);
    expect((await client().expectError(DELETE, { id: doc.id })).code).toBe(ErrorCode.NotFound);
  });

  it('deletes an upload that never finished at once, since there is nothing to restore', async () => {
    const data = await client().expectOk(UPLOAD, {
      input: { filename: 'half.pdf', mimeType: 'application/pdf', sizeBytes: 5 },
    });
    await client().expectOk(DELETE, { id: data.createDocumentUpload.document.id });
    expect(await db.select().from(documents)).toEqual([]);
  });

  it('frees the name: a new upload beside a trashed one is not numbered', async () => {
    const doc = await filed('scan.pdf');
    await client().expectOk(DELETE, { id: doc.id });
    expect((await filed('scan.pdf')).title).toBe('scan');
  });

  it('restores into the same folder, numbering the name when it has been taken since', async () => {
    const a = await folder('A');
    const doc = await filed('scan.pdf', a);
    await client().expectOk(DELETE, { id: doc.id });
    await filed('scan.pdf', a);

    const { restoreDocument } = await client().expectOk(RESTORE, { id: doc.id });
    expect(restoreDocument).toMatchObject({ id: doc.id, title: 'scan (2)', folderId: a, deletedAt: null });
    expect((await client().expectOk(TRASH)).trash.count).toBe(0);
    // Ready already: nothing for the pipeline to do.
    expect(emitted).toEqual([]);
  });

  it('sends a document trashed mid-pipeline back through it on restore', async () => {
    const doc = await filed('scan.pdf', null, 'processing');
    await client().expectOk(DELETE, { id: doc.id });
    await client().expectOk(RESTORE, { id: doc.id });
    expect(emitted).toEqual([doc.id]);
  });

  it('trashes a deleted folder’s documents and files them at the top level on restore', async () => {
    const a = await folder('A');
    const inside = await filed('one.pdf', a);
    const alreadyTrashed = await filed('two.pdf', a);
    await client().expectOk(DELETE, { id: alreadyTrashed.id });
    const pending = (
      await client().expectOk(UPLOAD, {
        input: { filename: 'half.pdf', mimeType: 'application/pdf', sizeBytes: 5, folderId: a },
      })
    ).createDocumentUpload.document;

    await client().expectOk(DELETE_FOLDER, { id: a });

    expect(await db.select().from(folders)).toEqual([]);
    expect((await db.select({ id: documents.id }).from(documents).where(eq(documents.id, pending.id))).length).toBe(0);
    const { trash } = await client().expectOk(TRASH);
    expect(trash.documents.map((row: { id: string }) => row.id).sort()).toEqual([inside.id, alreadyTrashed.id].sort());
    expect(storage.files.objects.has(inside.originalKey)).toBe(true);

    const { restoreDocument } = await client().expectOk(RESTORE, { id: inside.id });
    expect(restoreDocument).toMatchObject({ folderId: null, title: 'one' });
  });

  it('answers NOT_FOUND for a restore or purge of a filed document or someone else’s', async () => {
    const doc = await filed('scan.pdf');
    expect((await client().expectError(RESTORE, { id: doc.id })).code).toBe(ErrorCode.NotFound);
    expect((await client().expectError(PURGE, { id: doc.id })).code).toBe(ErrorCode.NotFound);
    await client().expectOk(DELETE, { id: doc.id });
    expect((await other().expectError(RESTORE, { id: doc.id })).code).toBe(ErrorCode.NotFound);
    expect((await other().expectError(PURGE, { id: doc.id })).code).toBe(ErrorCode.NotFound);
    expect((await client().expectOk(TRASH)).trash.count).toBe(1);
  });

  it('deletes for good, with the files in both buckets', async () => {
    const one = await filed('one.pdf');
    const two = await filed('two.pdf');
    const kept = await filed('three.pdf');
    await client().expectOk(DELETE, { id: one.id });
    await client().expectOk(DELETE, { id: two.id });

    expect((await client().expectOk(PURGE, { id: one.id })).purgeDocument).toBe(true);
    expect(storage.files.objects.has(one.originalKey)).toBe(false);
    expect(storage.text.objects.has(one.contentKey)).toBe(false);

    expect((await client().expectOk(EMPTY)).emptyTrash).toBe(1);
    expect((await db.select({ id: documents.id }).from(documents)).map((row) => row.id)).toEqual([kept.id]);
    expect([...storage.files.objects.keys()]).toEqual([kept.originalKey]);
  });

  it('purges what has sat past the retention period, and nothing younger', async () => {
    const old = await filed('old.pdf');
    const recent = await filed('recent.pdf');
    const now = new Date();
    await db
      .update(documents)
      .set({ deletedAt: new Date(now.getTime() - 31 * DAY_MS) })
      .where(eq(documents.id, old.id));
    await db
      .update(documents)
      .set({ deletedAt: new Date(now.getTime() - 29 * DAY_MS) })
      .where(eq(documents.id, recent.id));

    const purger = createTrashPurger({
      db,
      storage,
      config: { retentionDays: 30, purgeIntervalMs: DAY_MS },
      now: () => now,
      log: () => {},
    });
    expect(await purger.purgeOnce()).toBe(1);
    expect((await db.select({ id: documents.id }).from(documents)).map((row) => row.id)).toEqual([recent.id]);
    expect(storage.files.objects.has(old.originalKey)).toBe(false);
  });

  it('leaves trashed documents out of search, browse and duplicates, and back in on restore', async () => {
    const doc = await filed('invoice.pdf');
    const twin = await filed('copy.pdf');
    const [row] = await db.select().from(documents).where(eq(documents.id, doc.id));
    await indexDocument({ db, storage, embedder }, { ...row, contentKey: doc.contentKey });
    const search = () => searchDocuments({ db, embedder }, userId, 'words', 10, { minCosine: 0.3 });
    expect((await search()).map((hit) => hit.document.id)).toEqual([doc.id]);

    await client().expectOk(DELETE, { id: doc.id });
    expect(await search()).toEqual([]);
    // The passages stay, so a restore is searchable at once.
    expect((await db.select().from(documentChunks)).length).toBeGreaterThan(0);
    const browse = await client().expectOk('{ browseDocuments { documents { id } } }');
    expect(browse.browseDocuments.documents).toEqual([{ id: twin.id }]);
    const dupes = await client().expectOk(
      'query ($ids: [UUID!]!) { documentDuplicates(ids: $ids) { document { id } duplicates { id } } }',
      { ids: [doc.id, twin.id] },
    );
    expect(dupes.documentDuplicates).toEqual([{ document: { id: twin.id }, duplicates: [] }]);

    await client().expectOk(RESTORE, { id: doc.id });
    expect((await search()).map((hit) => hit.document.id)).toEqual([doc.id]);
  });
});

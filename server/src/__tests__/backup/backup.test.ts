import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import {
  type Document,
  DocumentStatus,
  documents,
  FieldSource,
  folders,
  processingSteps,
} from '@cubicecho/engrafo-db/schema';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedAuthHost } from '../../auth/auth-host.ts';
import { createRateLimiter } from '../../auth/rate-limit.ts';
import { planExport, streamExport } from '../../backup/export.ts';
import { importArchive } from '../../backup/import.ts';
import type { Manifest } from '../../backup/manifest.ts';
import { type Backups, createBackups, createExportLinks, type ImportJob } from '../../backup/state.ts';
import { readTar } from '../../backup/tar.ts';
import { ErrorCode } from '../../core/errors.ts';
import { HttpStatus } from '../../core/wire.ts';
import { createApp } from '../../http/app.ts';
import { createPipelineEvents, type PipelineEvents } from '../../pipeline/events.ts';
import { archiveKey, originalKey, textKey } from '../../storage/s3.ts';
import {
  bornDigitalPdf,
  createClient,
  createFakeEmbedder,
  createFakeStorage,
  createTestAuth,
  createTestDb,
  createUser,
  type FakeStorage,
  type TestDb,
} from '../helpers.ts';

/** Building a PGlite and pushing the schema into it; slow on a busy machine, and done once here. */
const DB_SETUP_TIMEOUT_MS = 60_000;

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');

/** What a seeded document is given. */
interface Seed {
  title: string;
  folderId?: string | null;
  body: Buffer;
  filename?: string;
  mimeType?: string;
  archive?: Buffer;
  text?: string;
  fields?: Partial<Document>;
}

/** A document as the pipeline would leave it, with its objects in the buckets. */
async function seed(db: TestDb, storage: FakeStorage, userId: string, input: Seed): Promise<Document> {
  const id = randomUUID();
  const original = originalKey(userId, id);
  await storage.files.put(original, input.body, input.mimeType ?? 'application/pdf');
  let archive: string | null = null;
  if (input.archive) {
    archive = archiveKey(userId, id);
    await storage.files.put(archive, input.archive, 'application/pdf');
  }
  let content: string | null = null;
  if (input.text) {
    content = textKey(userId, id);
    await storage.text.put(content, input.text, 'text/plain');
  }
  const [row] = await db
    .insert(documents)
    .values({
      id,
      userId,
      folderId: input.folderId ?? null,
      title: input.title,
      originalFilename: input.filename ?? `${input.title}.pdf`,
      mimeType: input.mimeType ?? 'application/pdf',
      sizeBytes: input.body.length,
      checksumSha256: sha256(input.body),
      originalKey: original,
      archiveKey: archive,
      contentKey: content,
      contentBytes: input.text ? Buffer.byteLength(input.text) : null,
      status: DocumentStatus.Ready,
      ...input.fields,
    })
    .returning();
  return row;
}

async function folder(db: TestDb, userId: string, name: string, parentId: string | null = null): Promise<string> {
  const [row] = await db.insert(folders).values({ userId, name, parentId }).returning();
  return row.id;
}

/** The whole export as one buffer, as a download would save it. */
async function exportTar(db: TestDb, storage: FakeStorage, userId: string): Promise<Buffer> {
  const plan = await planExport({ db, storage }, userId, new Date('2026-10-23T12:00:00Z'));
  const chunks: Buffer[] = [];
  for await (const chunk of streamExport(plan)) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Every file in a tar, by path. */
async function untar(tar: Buffer): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for await (const entry of readTar(Readable.from([tar]))) {
    files.set(entry.name, await entry.read());
  }
  return files;
}

function newJob(): Pick<ImportJob, 'total' | 'imported' | 'skipped' | 'failed'> {
  return { total: null, imported: 0, skipped: [], failed: [] };
}

describe('backups', () => {
  let db: TestDb;
  let storage: FakeStorage;
  let events: PipelineEvents;
  let emitted: string[];
  let alice: string;
  let bob: string;

  // One database for the file, and new users for every test, which keeps them apart as well:
  // a Postgres per test is more memory than this suite needs.
  beforeAll(async () => {
    db = await createTestDb();
  }, DB_SETUP_TIMEOUT_MS);

  beforeEach(async () => {
    storage = createFakeStorage();
    events = createPipelineEvents();
    emitted = [];
    events.on('document.uploaded', ({ documentId }) => emitted.push(documentId));
    alice = await createUser(db, `alice-${randomUUID()}@example.com`);
    bob = await createUser(db, `bob-${randomUUID()}@example.com`);
  });

  /** Alice's archive: a receipt she corrected in Taxes/2026, a note at the top, an empty folder. */
  async function seedAlice() {
    const taxes = await folder(db, alice, 'Taxes');
    const year = await folder(db, alice, '2026', taxes);
    await folder(db, alice, 'Empty');
    const receipt = await seed(db, storage, alice, {
      title: 'Hardware store',
      folderId: year,
      body: bornDigitalPdf('Total 12 50'),
      archive: Buffer.from('%PDF-1.4 archive'),
      text: 'Total 12.50 EUR',
      fields: {
        documentDate: '2026-03-12',
        documentDateSource: FieldSource.User,
        vendor: 'Hammer & Sons',
        total: '12.50',
        currency: 'EUR',
        receiptSource: FieldSource.User,
      },
    });
    const note = await seed(db, storage, alice, {
      title: 'Note: ideas?',
      body: Buffer.from('plain words'),
      filename: 'ideas.txt',
      mimeType: 'text/plain',
      fields: { documentDate: '2025-01-01', documentDateSource: FieldSource.Extracted },
    });
    return { receipt, note };
  }

  describe('the export', () => {
    it('holds metadata.json first, then every original, archive PDF and text', async () => {
      const { receipt, note } = await seedAlice();
      const files = await untar(await exportTar(db, storage, alice));
      const names = [...files.keys()];

      expect(names[0]).toBe('engrafo-export-2026-10-23/metadata.json');
      const manifest: Manifest = JSON.parse(files.get(names[0])?.toString() ?? '');
      expect(manifest.format).toBe('engrafo-export');
      expect(manifest.folders.map((f) => f.path)).toEqual(['Empty', 'Taxes', 'Taxes/2026']);

      const listed = manifest.documents.find((doc) => doc.id === receipt.id);
      expect(listed).toMatchObject({
        title: 'Hardware store',
        folder: 'Taxes/2026',
        documentDate: '2026-03-12',
        documentDateSource: 'user',
        vendor: 'Hammer & Sons',
        total: '12.50',
        currency: 'EUR',
        receiptSource: 'user',
        checksumSha256: receipt.checksumSha256,
        files: {
          original: 'originals/Taxes/2026/Hardware store.pdf',
          archive: 'archive/Taxes/2026/Hardware store.pdf',
          text: 'text/Taxes/2026/Hardware store.txt',
        },
      });
      const root = 'engrafo-export-2026-10-23';
      expect(files.get(`${root}/originals/Taxes/2026/Hardware store.pdf`)).toEqual(bornDigitalPdf('Total 12 50'));
      expect(files.get(`${root}/archive/Taxes/2026/Hardware store.pdf`)?.toString()).toBe('%PDF-1.4 archive');
      expect(files.get(`${root}/text/Taxes/2026/Hardware store.txt`)?.toString()).toBe('Total 12.50 EUR');

      // A title's unsafe characters are swapped in the path only; metadata keeps it as it is.
      const noteListed = manifest.documents.find((doc) => doc.id === note.id);
      expect(noteListed?.title).toBe('Note: ideas?');
      expect(noteListed?.files).toEqual({ original: 'originals/Note_ ideas_.txt', archive: null, text: null });
      expect(files.get(`${root}/originals/Note_ ideas_.txt`)?.toString()).toBe('plain words');
    });

    it('holds nothing of anyone else, and no upload still pending', async () => {
      await seedAlice();
      await seed(db, storage, bob, { title: 'Bob only', body: Buffer.from('bob'), mimeType: 'text/plain' });
      await seed(db, storage, alice, {
        title: 'Half uploaded',
        body: Buffer.from('half'),
        fields: { status: DocumentStatus.PendingUpload },
      });

      const bobs = await untar(await exportTar(db, storage, bob));
      const manifest: Manifest = JSON.parse(bobs.get('engrafo-export-2026-10-23/metadata.json')?.toString() ?? '');
      expect(manifest.documents.map((doc) => doc.title)).toEqual(['Bob only']);
      expect(manifest.folders).toEqual([]);

      const alices = await untar(await exportTar(db, storage, alice));
      const aliceManifest: Manifest = JSON.parse(
        alices.get('engrafo-export-2026-10-23/metadata.json')?.toString() ?? '',
      );
      expect(aliceManifest.documents.map((doc) => doc.title)).not.toContain('Half uploaded');
    });
  });

  describe('export links', () => {
    it('work once, for the user they were minted for, until they expire', () => {
      let clock = 1_000_000;
      const links = createExportLinks(() => clock);

      const first = links.mint(alice);
      expect(links.redeem(first.token)).toBe(alice);
      expect(links.redeem(first.token)).toBeNull();

      const second = links.mint(bob);
      clock = second.expiresAt.getTime();
      expect(links.redeem(second.token)).toBeNull();
      expect(links.redeem('made-up')).toBeNull();
    });

    describe('over HTTP', () => {
      let server: Server;
      let origin: string;
      let backups: Backups;

      beforeEach(async () => {
        backups = createBackups();
        const app = createApp({
          db,
          authHost: fixedAuthHost(createTestAuth(db).auth),
          limiter: createRateLimiter(),
          storage,
          events,
          ocrAvailable: false,
          embedder: createFakeEmbedder(),
          backups,
        });
        server = await new Promise<Server>((resolve) => {
          const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        const address = server.address();
        if (address === null || typeof address === 'string') {
          throw new Error('expected a TCP port');
        }
        origin = `http://127.0.0.1:${address.port}`;
      });

      afterEach(async () => {
        await new Promise((resolve) => server.close(resolve));
      });

      it('streams the export as an attachment, once', async () => {
        await seedAlice();
        const client = createClient(db, alice, { storage, backups });
        const { createExportLink } = await client.expectOk('mutation { createExportLink { path expiresAt } }');
        expect(createExportLink.path).toMatch(/^\/export\/[\w-]{40,}$/);

        const response = await fetch(`${origin}${createExportLink.path}`);
        expect(response.status).toBe(HttpStatus.Ok);
        expect(response.headers.get('content-type')).toBe('application/x-tar');
        expect(response.headers.get('content-disposition')).toBe(
          `attachment; filename="engrafo-export-${new Date().toISOString().slice(0, 10)}.tar"`,
        );
        const files = await untar(Buffer.from(await response.arrayBuffer()));
        expect([...files.keys()].some((name) => name.endsWith('/originals/Taxes/2026/Hardware store.pdf'))).toBe(true);

        const again = await fetch(`${origin}${createExportLink.path}`);
        expect(again.status).toBe(HttpStatus.NotFound);
      });

      it('answers an unknown link as not found, and a signed-out caller cannot mint one', async () => {
        expect((await fetch(`${origin}/export/nothing-here`)).status).toBe(HttpStatus.NotFound);
        const anonymous = createClient(db, null, { storage, backups });
        const error = await anonymous.expectError('mutation { createExportLink { path } }');
        expect(error.code).toBe(ErrorCode.Unauthenticated);
      });
    });
  });

  describe('the import', () => {
    it('rebuilds folders, keeps what the user set, and runs the pipeline over each document', async () => {
      await seedAlice();
      const tar = await exportTar(db, storage, alice);
      const job = newJob();

      await importArchive({ db, storage, events }, bob, Readable.from([tar]), job);

      expect(job).toMatchObject({ total: 2, imported: 2, skipped: [], failed: [] });
      const bobFolders = await db.select().from(folders).where(eq(folders.userId, bob));
      expect(bobFolders.map((f) => f.name).sort()).toEqual(['2026', 'Empty', 'Taxes']);
      const year = bobFolders.find((f) => f.name === '2026');
      expect(bobFolders.find((f) => f.id === year?.parentId)?.name).toBe('Taxes');
      // Sharing with MCP is chosen again, never carried over.
      expect(bobFolders.every((f) => f.mcpEnabled === false)).toBe(true);

      const rows = await db.select().from(documents).where(eq(documents.userId, bob));
      const receipt = rows.find((row) => row.title === 'Hardware store');
      expect(receipt).toMatchObject({
        folderId: year?.id,
        status: DocumentStatus.Uploaded,
        documentDate: '2026-03-12',
        documentDateSource: FieldSource.User,
        vendor: 'Hammer & Sons',
        total: '12.50',
        currency: 'EUR',
        receiptSource: FieldSource.User,
        checksumSha256: sha256(bornDigitalPdf('Total 12 50')),
        archiveKey: null,
        contentKey: null,
      });
      expect(storage.files.objects.get(receipt?.originalKey ?? '')?.body).toEqual(bornDigitalPdf('Total 12 50'));

      // An extracted date is the pipeline's to read again, so it is not carried over.
      const note = rows.find((row) => row.title === 'Note: ideas?');
      expect(note).toMatchObject({
        folderId: null,
        documentDate: null,
        documentDateSource: null,
        mimeType: 'text/plain',
      });

      expect(emitted.sort()).toEqual(rows.map((row) => row.id).sort());
      const steps = await db.select().from(processingSteps).where(eq(processingSteps.userId, bob));
      expect(steps.length).toBeGreaterThan(0);
    });

    it('skips what is already in the archive, so a second run adds nothing', async () => {
      await seedAlice();
      const tar = await exportTar(db, storage, alice);

      const intoItself = newJob();
      await importArchive({ db, storage, events }, alice, Readable.from([tar]), intoItself);
      expect(intoItself.imported).toBe(0);
      expect(intoItself.skipped.map((item) => item.title).sort()).toEqual(['Hardware store', 'Note: ideas?']);
      expect(intoItself.skipped[0].reason).toMatch(/Already in the archive as/);

      await importArchive({ db, storage, events }, bob, Readable.from([tar]), newJob());
      const again = newJob();
      await importArchive({ db, storage, events }, bob, Readable.from([tar]), again);
      expect(again).toMatchObject({ imported: 0, failed: [] });
      expect(await db.select().from(documents).where(eq(documents.userId, bob))).toHaveLength(2);
    });

    it('numbers a title that is taken in its folder', async () => {
      await seedAlice();
      const tar = await exportTar(db, storage, alice);
      const taxes = await folder(db, bob, 'taxes');
      const year = await folder(db, bob, '2026', taxes);
      await seed(db, storage, bob, {
        title: 'hardware STORE',
        folderId: year,
        body: Buffer.from('a different file'),
        mimeType: 'text/plain',
      });

      const job = newJob();
      await importArchive({ db, storage, events }, bob, Readable.from([tar]), job);

      expect(job.imported).toBe(2);
      // The existing folders are found ignoring case rather than made twice.
      expect(await db.select().from(folders).where(eq(folders.userId, bob))).toHaveLength(3);
      const inYear = await db
        .select()
        .from(documents)
        .where(and(eq(documents.userId, bob), eq(documents.folderId, year)));
      expect(inYear.map((row) => row.title).sort()).toEqual(['Hardware store (2)', 'hardware STORE']);
    });

    it('refuses a tar that is not an export, and reports a damaged or missing original', async () => {
      await expect(
        importArchive({ db, storage, events }, bob, Readable.from([Buffer.alloc(2048)]), newJob()),
      ).rejects.toThrow(/not an Engrafo export/);

      const { receipt } = await seedAlice();
      // The bytes change after the checksum was taken, and one document's object goes missing.
      await storage.files.put(receipt.originalKey, Buffer.from('tampered'), 'application/pdf');
      const [note] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.userId, alice), eq(documents.title, 'Note: ideas?')));
      storage.files.objects.delete(note.originalKey);

      const job = newJob();
      await importArchive({ db, storage, events }, bob, Readable.from([await exportTar(db, storage, alice)]), job);
      expect(job.imported).toBe(0);
      expect(job.failed).toEqual([
        { title: 'Hardware store', reason: expect.stringMatching(/do not match the checksum/) },
        { title: 'Note: ideas?', reason: 'Its original is missing from the archive.' },
      ]);
    });

    it('reads a gzipped export too', async () => {
      await seedAlice();
      const { gzipSync } = await import('node:zlib');
      const job = newJob();
      await importArchive(
        { db, storage, events },
        bob,
        Readable.from([gzipSync(await exportTar(db, storage, alice))]),
        job,
      );
      expect(job.imported).toBe(2);
    });
  });

  describe('the import through GraphQL', () => {
    it('signs the upload, runs in the background, and reports on itself', async () => {
      await seedAlice();
      const tar = await exportTar(db, storage, alice);
      const backups = createBackups();
      const client = createClient(db, bob, { storage, events, backups });

      const { createImportUpload } = await client.expectOk(
        'mutation ($size: Float!) { createImportUpload(sizeBytes: $size) { key uploadUrl uploadHeaders { name value } } }',
        { size: tar.length },
      );
      expect(createImportUpload.key).toMatch(new RegExp(`^imports/${bob}/`));
      await storage.files.put(createImportUpload.key, tar, 'application/x-tar');

      const { importArchive: started } = await client.expectOk(
        'mutation ($key: String!) { importArchive(key: $key) { id state } }',
        { key: createImportUpload.key },
      );
      expect(started.state).toBe('RUNNING');
      await backups.imports.latest(bob)?.finished;

      const { latestImport } = await client.expectOk(
        '{ latestImport { id state total imported skipped { title } failed { title reason } error } }',
      );
      expect(latestImport).toMatchObject({ id: started.id, state: 'DONE', total: 2, imported: 2, failed: [] });
      // The uploaded archive is not kept once it has been read.
      expect(storage.files.objects.has(createImportUpload.key)).toBe(false);
    });

    it("answers someone else's upload, or none, as not found, and refuses one too large", async () => {
      const backups = createBackups();
      const client = createClient(db, bob, { storage, events, backups });
      const aliceKey = `imports/${alice}/x.tar`;
      await storage.files.put(aliceKey, Buffer.from('tar'), 'application/x-tar');

      const theirs = await client.expectError('mutation ($key: String!) { importArchive(key: $key) { id } }', {
        key: aliceKey,
      });
      expect(theirs.code).toBe(ErrorCode.NotFound);
      const none = await client.expectError('mutation ($key: String!) { importArchive(key: $key) { id } }', {
        key: `imports/${bob}/missing.tar`,
      });
      expect(none.code).toBe(ErrorCode.NotFound);

      const huge = await client.expectError('mutation { createImportUpload(sizeBytes: 1e15) { key } }');
      expect(huge.code).toBe(ErrorCode.BadUserInput);
    });
  });
});

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentStatus, documents, folders, processingSteps } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchConfig } from '../../core/config.ts';
import { insertPendingDocument } from '../../documents/create.ts';
import { createPipelineEvents, type PipelineEvents } from '../../pipeline/events.ts';
import { isIgnoredDir, isIgnoredFile } from '../../watch/files.ts';
import { createWatcher, type Watcher, type WatchLog } from '../../watch/watcher.ts';
import {
  bornDigitalPdf,
  createFakeStorage,
  createTestDb,
  createUser,
  type FakeStorage,
  type TestDb,
} from '../helpers.ts';

const OWNER = 'scanner@example.com';
const STABLE_MS = 10_000;

describe('ignored names', () => {
  it('skips what scanners, SMB and editors write beside real files', () => {
    for (const name of ['.DS_Store', '._scan.pdf', '.~lock.notes.txt#', '~$report.docx', 'scan.pdf.tmp', 'a.part']) {
      expect(isIgnoredFile(name), name).toBe(true);
    }
    expect(isIgnoredFile('scan.pdf')).toBe(false);
    for (const name of ['@eaDir', '#recycle', '.stfolder', '$RECYCLE.BIN']) {
      expect(isIgnoredDir(name), name).toBe(true);
    }
    expect(isIgnoredDir('Taxes')).toBe(false);
  });
});

describe('the watched folder', () => {
  let db: TestDb;
  let storage: FakeStorage;
  let events: PipelineEvents;
  let emitted: string[];
  let dir: string;
  let clock: number;
  let lines: string[];
  let watcher: Watcher;

  const log: WatchLog = {
    info: (line) => lines.push(line),
    warn: (line) => lines.push(line),
  };

  const makeWatcher = (overrides: Partial<WatchConfig> = {}) =>
    createWatcher({
      db,
      storage,
      events,
      config: { dir, owner: OWNER, pollMs: 1000, stableMs: STABLE_MS, ...overrides },
      now: () => clock,
      log,
    });

  /** Two passes, the stability interval apart: what it takes for a file sitting still to be filed. */
  const settle = async () => {
    await watcher.scanOnce();
    clock += STABLE_MS;
    await watcher.scanOnce();
  };

  const put = async (relativePath: string, body: string | Buffer) => {
    const path = join(dir, relativePath);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, body);
    return path;
  };

  beforeEach(async () => {
    db = await createTestDb();
    storage = createFakeStorage();
    events = createPipelineEvents();
    emitted = [];
    events.on('document.uploaded', ({ documentId }) => emitted.push(documentId));
    dir = await mkdtemp(join(tmpdir(), 'engrafo-watch-test-'));
    clock = 1_000_000;
    lines = [];
    watcher = makeWatcher();
  });

  afterEach(async () => {
    // Undefined when beforeEach itself timed out, which is contention, not this file.
    await watcher?.stop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  it('files a file once it has held still, then removes it', async () => {
    const userId = await createUser(db, OWNER);
    const pdf = bornDigitalPdf('Invoice 42');
    const path = await put('invoice.pdf', pdf);

    await watcher.scanOnce();
    expect(await db.select().from(documents)).toHaveLength(0);
    clock += STABLE_MS;
    await watcher.scanOnce();

    const [doc] = await db.select().from(documents);
    expect(doc).toMatchObject({
      userId,
      title: 'invoice',
      originalFilename: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      status: DocumentStatus.Uploaded,
      folderId: null,
      checksumSha256: createHash('sha256').update(pdf).digest('hex'),
    });
    expect(storage.files.objects.get(doc.originalKey)?.body.equals(pdf)).toBe(true);
    expect(await db.select().from(processingSteps).where(eq(processingSteps.documentId, doc.id))).not.toHaveLength(0);
    expect(emitted).toEqual([doc.id]);
    expect(existsSync(path)).toBe(false);
  });

  it('waits while the file is still growing', async () => {
    await createUser(db, OWNER);
    const path = await put('scan.pdf', bornDigitalPdf('half'));
    await watcher.scanOnce();
    clock += STABLE_MS;
    await writeFile(path, bornDigitalPdf('half and the rest'));
    await utimes(path, new Date(), new Date(Date.now() + 5000));
    await watcher.scanOnce();
    expect(await db.select().from(documents)).toHaveLength(0);
    clock += STABLE_MS;
    await watcher.scanOnce();
    expect(await db.select().from(documents)).toHaveLength(1);
  });

  it('files subdirectories into folders, reusing one of the same name in any case', async () => {
    const userId = await createUser(db, OWNER);
    const [taxes] = await db.insert(folders).values({ userId, name: 'Taxes', parentId: null }).returning();
    await put('taxes/2026/receipt.pdf', bornDigitalPdf('receipt'));

    await settle();

    const all = await db.select().from(folders);
    expect(all).toHaveLength(2);
    const year = all.find((folder) => folder.name === '2026');
    expect(year?.parentId).toBe(taxes.id);
    const [doc] = await db.select().from(documents);
    expect(doc.folderId).toBe(year?.id);
  });

  it('numbers a name already taken in the folder, as an upload does', async () => {
    await createUser(db, OWNER);
    await put('scan.pdf', bornDigitalPdf('first'));
    await settle();
    await put('scan.pdf', bornDigitalPdf('second'));
    await settle();
    const titles = (await db.select().from(documents)).map((doc) => doc.title).sort();
    expect(titles).toEqual(['scan', 'scan (2)']);
  });

  it('reads text and Markdown by their extension, since they have no magic bytes', async () => {
    await createUser(db, OWNER);
    await put('notes.md', '# Notes\n\nSome text.');
    await put('plain.txt', 'Just words.');
    await settle();
    const types = Object.fromEntries((await db.select().from(documents)).map((doc) => [doc.title, doc.mimeType]));
    expect(types).toEqual({ notes: 'text/markdown', plain: 'text/plain' });
  });

  it('leaves dotfiles and temporary files alone, without a word', async () => {
    await createUser(db, OWNER);
    const paths = [await put('.DS_Store', 'x'), await put('scan.pdf.tmp', bornDigitalPdf('partial'))];
    await settle();
    expect(await db.select().from(documents)).toHaveLength(0);
    expect(paths.every((path) => existsSync(path))).toBe(true);
    expect(lines.filter((line) => line.includes('.DS_Store') || line.includes('.tmp'))).toEqual([]);
  });

  it('leaves an unsupported file in place and says so once', async () => {
    await createUser(db, OWNER);
    // A plain zip: file-type knows it, and nothing reads one.
    const path = await put('photos.zip', Buffer.from(zipSync({ 'a.txt': strToU8('a') })));
    await settle();
    clock += STABLE_MS;
    await watcher.scanOnce();
    await watcher.scanOnce();
    expect(await db.select().from(documents)).toHaveLength(0);
    expect(existsSync(path)).toBe(true);
    expect(lines.filter((line) => line.includes('photos.zip'))).toHaveLength(1);
    expect(lines.find((line) => line.includes('photos.zip'))).toMatch(/unsupported file type \(application\/zip\)/);
  });

  it('leaves a file over MAX_UPLOAD_BYTES in place', async () => {
    vi.stubEnv('MAX_UPLOAD_BYTES', '100');
    await createUser(db, OWNER);
    const path = await put('big.pdf', bornDigitalPdf('far more than a hundred bytes'));
    await settle();
    expect(await db.select().from(documents)).toHaveLength(0);
    expect(existsSync(path)).toBe(true);
    expect(lines.some((line) => line.includes('big.pdf') && line.includes('limit'))).toBe(true);
  });

  it('leaves a file in a directory that cannot be a folder name', async () => {
    await createUser(db, OWNER);
    const path = await put('Bills & Co/bill.pdf', bornDigitalPdf('bill'));
    await settle();
    expect(await db.select().from(documents)).toHaveLength(0);
    expect(await db.select().from(folders)).toHaveLength(0);
    expect(existsSync(path)).toBe(true);
  });

  it('removes a file whose bytes are already in the archive without adding them again', async () => {
    await createUser(db, OWNER);
    const pdf = bornDigitalPdf('twice');
    await put('a.pdf', pdf);
    await settle();
    const path = await put('b.pdf', pdf);
    await settle();
    const docs = await db.select().from(documents);
    expect(docs).toHaveLength(1);
    expect(existsSync(path)).toBe(false);
    expect(lines.some((line) => line.includes('b.pdf') && line.includes('already in the archive'))).toBe(true);
  });

  it('finishes a pending row it left behind, rather than adding a second', async () => {
    const userId = await createUser(db, OWNER);
    const pdf = bornDigitalPdf('crashed');
    const checksum = createHash('sha256').update(pdf).digest('hex');
    // What a crash between the insert and the PUT leaves: the row, no object.
    const pending = await insertPendingDocument(
      db,
      userId,
      { filename: 'crashed.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length },
      checksum,
    );
    const path = await put('crashed.pdf', pdf);
    await settle();
    const docs = await db.select().from(documents);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ id: pending.id, status: DocumentStatus.Uploaded });
    expect(storage.files.objects.has(pending.originalKey)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('keeps the file and retries when storage fails', async () => {
    await createUser(db, OWNER);
    const path = await put('scan.pdf', bornDigitalPdf('retry me'));
    const putFile = storage.files.putFile;
    storage.files.putFile = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    await settle();
    expect(existsSync(path)).toBe(true);
    expect(lines.some((line) => line.includes('ECONNREFUSED') && line.includes('will retry'))).toBe(true);

    storage.files.putFile = putFile;
    await watcher.scanOnce();
    const docs = await db.select().from(documents);
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe(DocumentStatus.Uploaded);
    expect(existsSync(path)).toBe(false);
  });

  // Root ignores directory permissions, so this cannot be staged as root.
  it.skipIf(process.getuid?.() === 0)('files once and says so when the file cannot be removed', async () => {
    await createUser(db, OWNER);
    const path = await put('locked/scan.pdf', bornDigitalPdf('read only share'));
    await chmod(join(dir, 'locked'), 0o555);
    try {
      await settle();
      await settle();
      await settle();
    } finally {
      await chmod(join(dir, 'locked'), 0o755);
    }
    expect(await db.select().from(documents)).toHaveLength(1);
    expect(existsSync(path)).toBe(true);
    const said = lines.filter((line) => line.includes('locked/scan.pdf'));
    expect(said).toEqual([
      expect.stringMatching(/filed as "scan", but could not remove it/),
      expect.stringMatching(/already in the archive as "scan", not added again, but could not remove it/),
    ]);
  });

  it('does nothing while the owner has no account, then starts once it has one', async () => {
    const path = await put('scan.pdf', bornDigitalPdf('early'));
    await settle();
    await watcher.scanOnce();
    expect(existsSync(path)).toBe(true);
    expect(lines.filter((line) => line.includes('has no account'))).toHaveLength(1);

    await createUser(db, OWNER);
    await settle();
    expect(await db.select().from(documents)).toHaveLength(1);
  });

  it('does nothing without an owner named', async () => {
    watcher = makeWatcher({ owner: null });
    const path = await put('scan.pdf', bornDigitalPdf('nobody'));
    await settle();
    expect(existsSync(path)).toBe(true);
    expect(lines).toEqual([expect.stringContaining('WATCH_OWNER is not')]);
  });

  it('says once when the directory is missing, and carries on', async () => {
    await createUser(db, OWNER);
    watcher = makeWatcher({ dir: join(dir, 'not-mounted') });
    await settle();
    expect(lines.filter((line) => line.includes('cannot read'))).toHaveLength(1);
  });

  it('on stop, finishes the file it is filing and starts no other', async () => {
    await createUser(db, OWNER);
    const first = await put('a.pdf', bornDigitalPdf('first'));
    const second = await put('b.pdf', bornDigitalPdf('second'));
    await watcher.scanOnce();
    clock += STABLE_MS;

    const gate: { release?: () => void } = {};
    const putFile = storage.files.putFile;
    storage.files.putFile = async (...args) => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return putFile(...args);
    };
    const pass = watcher.scanOnce();
    // Mid-PUT: the row is written, the object is not.
    await vi.waitFor(() => expect(gate.release).toBeDefined());
    let stopped = false;
    const stopping = watcher.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    gate.release?.();
    await Promise.all([pass, stopping]);

    const docs = await db.select().from(documents);
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe(DocumentStatus.Uploaded);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);

    await watcher.scanOnce();
    expect(await db.select().from(documents)).toHaveLength(1);
  });

  it('polls on its own once started', async () => {
    await createUser(db, OWNER);
    watcher = createWatcher({
      db,
      storage,
      events,
      config: { dir, owner: OWNER, pollMs: 10, stableMs: 0 },
      log,
    });
    const path = await put('scan.pdf', bornDigitalPdf('polled'));
    watcher.start();
    await vi.waitFor(() => expect(existsSync(path)).toBe(false), { timeout: 5000 });
    expect(await db.select().from(documents)).toHaveLength(1);
  });
});

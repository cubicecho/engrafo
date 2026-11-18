import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  type ContentFormat,
  DocumentStatus,
  documents,
  folders,
  processingSteps,
  StepStatus,
} from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MERGE_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { detectMerge } from '../../merge/pdf.ts';
import { createPipelineEvents, type PipelineEvents } from '../../pipeline/events.ts';
import { createPipeline } from '../../pipeline/runner.ts';
import { STEPS } from '../../pipeline/step-list.ts';
import type { VisionConfig } from '../../vision/settings.ts';
import {
  bornDigitalPdf,
  createClient,
  createFakeEmbedder,
  createFakeStorage,
  createTestDb,
  createUser,
  type FakeStorage,
  type TestDb,
} from '../helpers.ts';

const exec = promisify(execFile);

const MERGE = `
  mutation ($input: MergeDocumentsInput!) {
    mergeDocuments(input: $input) { id title folderId mimeType status ocrRequested }
  }
`;

// The real merge runs where Python has pikepdf and img2pdf, which ocrmypdf brings: the Docker
// test stage. The rules are checked everywhere, since they are all decided before Python starts.
const canMerge = await detectMerge();

/** Runs Python with the merge's own modules, for the fixtures and for reading the result back. */
async function python(script: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec(MERGE_DEFAULTS.python, ['-c', script, ...args]);
  return stdout.trim();
}

/** How many pages a PDF has and its top-level bookmarks, in order. */
async function readMerged(body: Buffer, dir: string): Promise<{ pages: number; bookmarks: string[] }> {
  const path = join(dir, `${randomUUID()}.pdf`);
  await writeFile(path, body);
  const out = await python(
    `import json, sys, pikepdf
with pikepdf.open(sys.argv[1]) as pdf:
    with pdf.open_outline() as outline:
        print(json.dumps({"pages": len(pdf.pages), "bookmarks": [str(item.title) for item in outline.root]}))`,
    path,
  );
  return JSON.parse(out);
}

describe('mergeDocuments', () => {
  let db: TestDb;
  let userId: string;
  let otherId: string;
  let storage: FakeStorage;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'engrafo-merge-test-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
    otherId = await createUser(db, 'other@example.com');
    storage = createFakeStorage();
  });

  interface SeedOptions {
    owner?: string;
    mimeType?: string;
    status?: (typeof DocumentStatus)[keyof typeof DocumentStatus];
    folderId?: string | null;
    body?: Buffer;
    archive?: Buffer;
    ocrRequested?: boolean;
    deletedAt?: Date;
    /** The text earlier steps extracted, stored in the text bucket. */
    text?: string;
    contentFormat?: ContentFormat;
  }

  /** A processed document straight through Drizzle, with its objects in the fake bucket. */
  async function seed(title: string, options: SeedOptions = {}): Promise<string> {
    const id = randomUUID();
    const owner = options.owner ?? userId;
    const body = options.body ?? bornDigitalPdf(title.replace(/[^A-Za-z0-9 ]/g, ''));
    const originalKey = `originals/${owner}/${id}`;
    const archiveKey = options.archive ? `archive/${owner}/${id}.pdf` : null;
    await storage.files.put(originalKey, body, options.mimeType ?? 'application/pdf');
    if (options.archive && archiveKey) {
      await storage.files.put(archiveKey, options.archive, 'application/pdf');
    }
    const contentKey = options.text === undefined ? null : `text/${owner}/${id}`;
    if (contentKey && options.text !== undefined) {
      await storage.text.put(contentKey, options.text, 'text/plain; charset=utf-8');
    }
    await db.insert(documents).values({
      id,
      userId: owner,
      folderId: options.folderId ?? null,
      title,
      originalFilename: `${title}.pdf`,
      mimeType: options.mimeType ?? 'application/pdf',
      sizeBytes: body.length,
      originalKey,
      archiveKey,
      contentKey,
      contentBytes: options.text === undefined ? null : Buffer.byteLength(options.text),
      contentFormat: options.contentFormat ?? 'plain',
      ocrRequested: options.ocrRequested ?? false,
      status: options.status ?? DocumentStatus.Ready,
      ...(options.deletedAt ? { deletedAt: options.deletedAt } : {}),
    });
    return id;
  }

  const client = (as: string | null = userId, mergeAvailable = true, events = createPipelineEvents()) =>
    createClient(db, as, { storage, events, mergeAvailable });

  /** The merged copy's step rows, by name. */
  async function stepsOf(documentId: string) {
    const rows = await db.select().from(processingSteps).where(eq(processingSteps.documentId, documentId));
    return new Map(rows.map((row) => [row.step, row]));
  }

  /** The text stored for a document, or null when it has none. */
  async function storedText(documentId: string): Promise<string | null> {
    const [row] = await db.select().from(documents).where(eq(documents.id, documentId));
    return row.contentKey === null ? null : (storage.text.objects.get(row.contentKey)?.body.toString('utf-8') ?? null);
  }

  async function folder(name: string, owner = userId): Promise<string> {
    const [row] = await db.insert(folders).values({ userId: owner, name }).returning();
    return row.id;
  }

  describe('refuses before any bytes move', () => {
    it('asks for a session', async () => {
      const a = await seed('a');
      const b = await seed('b');
      const error = await client(null).expectError(MERGE, { input: { ids: [a, b], title: 'ab' } });
      expect(error.code).toBe(ErrorCode.Unauthenticated);
    });

    it('says so when this server cannot merge', async () => {
      const a = await seed('a');
      const b = await seed('b');
      const error = await client(userId, false).expectError(MERGE, { input: { ids: [a, b], title: 'ab' } });
      expect(error.code).toBe(ErrorCode.BadUserInput);
      expect(error.message).toMatch(/pikepdf/);
    });

    it('needs two documents, each once', async () => {
      const a = await seed('a');
      const one = await client().expectError(MERGE, { input: { ids: [a], title: 'ab' } });
      expect(one.code).toBe(ErrorCode.BadUserInput);
      const twice = await client().expectError(MERGE, { input: { ids: [a, a], title: 'ab' } });
      expect(twice.code).toBe(ErrorCode.BadUserInput);
      expect(twice.message).toMatch(/twice/);
    });

    it('checks the title as a rename does', async () => {
      const a = await seed('a');
      const b = await seed('b');
      const error = await client().expectError(MERGE, { input: { ids: [a, b], title: 'a/b' } });
      expect(error.code).toBe(ErrorCode.BadUserInput);
    });

    it('cannot see another user’s document, or one in the trash', async () => {
      const mine = await seed('mine');
      const theirs = await seed('theirs', { owner: otherId });
      const trashed = await seed('trashed', { deletedAt: new Date() });
      for (const id of [theirs, trashed]) {
        const error = await client().expectError(MERGE, { input: { ids: [mine, id], title: 'ab' } });
        expect(error.code).toBe(ErrorCode.NotFound);
      }
    });

    it('takes only PDFs and images, which have pages', async () => {
      const a = await seed('a');
      const notes = await seed('notes', { mimeType: 'text/markdown', body: Buffer.from('# Notes') });
      const error = await client().expectError(MERGE, { input: { ids: [a, notes], title: 'ab' } });
      expect(error.code).toBe(ErrorCode.BadUserInput);
      expect(error.message).toMatch(/notes/);
    });

    it('waits for a document still being processed', async () => {
      const a = await seed('a');
      const busy = await seed('busy', { status: DocumentStatus.Processing });
      const error = await client().expectError(MERGE, { input: { ids: [a, busy], title: 'ab' } });
      expect(error.code).toBe(ErrorCode.Conflict);
    });

    it('files only into the caller’s own folder', async () => {
      const a = await seed('a');
      const b = await seed('b');
      const theirs = await folder('Theirs', otherId);
      const error = await client().expectError(MERGE, { input: { ids: [a, b], title: 'ab', folderId: theirs } });
      expect(error.code).toBe(ErrorCode.NotFound);
    });
  });

  describe.skipIf(canMerge === false)('with pikepdf', () => {
    it('files the pages in the order asked, from each archive when there is one, as a new document', async () => {
      const taxes = await folder('Taxes');
      const scanned = await seed('Page one', {
        body: bornDigitalPdf('original'),
        archive: Buffer.concat([bornDigitalPdf('archive')]),
        ocrRequested: true,
      });
      const image = join(dir, 'page.png');
      await python(
        `import sys
from PIL import Image
Image.new("RGB", (850, 1100), "white").save(sys.argv[1], dpi=(100, 100))`,
        image,
      );
      const picture = await seed('Page two', { mimeType: 'image/png', body: await readFile(image) });
      const typed = await seed('Page three');

      const data = await client().expectOk(MERGE, {
        input: { ids: [typed, scanned, picture], title: 'Bundle', folderId: taxes },
      });
      const merged = data.mergeDocuments;
      expect(merged).toMatchObject({
        title: 'Bundle',
        folderId: taxes,
        mimeType: 'application/pdf',
        status: DocumentStatus.Uploaded,
        // One source asked for OCR, so the pages that came from it get it.
        ocrRequested: true,
      });

      const [row] = await db.select().from(documents).where(eq(documents.id, merged.id));
      expect(row.originalFilename).toBe('Bundle.pdf');
      expect(row.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
      const stored = storage.files.objects.get(row.originalKey);
      expect(stored?.contentType).toBe('application/pdf');
      expect(stored?.body.length).toBe(row.sizeBytes);
      expect(await readMerged(stored?.body ?? Buffer.alloc(0), dir)).toEqual({
        pages: 3,
        bookmarks: ['Page three', 'Page one', 'Page two'],
      });
      // The archive, not the original: its text is what the merged page carries. pikepdf
      // compresses the streams it writes, so the page is read back through it.
      const path = join(dir, 'bundle.pdf');
      await writeFile(path, stored?.body ?? Buffer.alloc(0));
      const second = await python(
        `import sys, pikepdf
with pikepdf.open(sys.argv[1]) as pdf:
    print(pdf.pages[1].Contents.read_bytes().decode("latin-1"))`,
        path,
      );
      expect(second).toContain('(archive)');

      // Queued like an upload.
      const steps = await db.select().from(processingSteps).where(eq(processingSteps.documentId, merged.id));
      expect(steps.length).toBeGreaterThan(0);

      // The originals stay where they were.
      const kept = await db.select().from(documents).where(eq(documents.id, scanned));
      expect(kept[0].deletedAt).toBeNull();
    });

    it('lays a see-through image on white and gives an image with no resolution OCR’s', async () => {
      const image = join(dir, 'clear.png');
      await python(
        `import sys
from PIL import Image
Image.new("RGBA", (600, 600), (0, 0, 0, 0)).save(sys.argv[1])`,
        image,
      );
      const clear = await seed('Clear', { mimeType: 'image/png', body: await readFile(image) });
      const a = await seed('a');
      const data = await client().expectOk(MERGE, { input: { ids: [clear, a], title: 'Mixed' } });
      const [row] = await db.select().from(documents).where(eq(documents.id, data.mergeDocuments.id));
      const body = storage.files.objects.get(row.originalKey)?.body ?? Buffer.alloc(0);
      const path = join(dir, 'mixed.pdf');
      await writeFile(path, body);
      // 600 pixels at 300 DPI is two inches: 144 points.
      const width = await python(
        `import sys, pikepdf
with pikepdf.open(sys.argv[1]) as pdf:
    print(float(pdf.pages[0].mediabox[2]))`,
        path,
      );
      expect(Number(width)).toBeCloseTo(144, 0);
    });

    it('numbers a taken title, and takes it after all once the originals go to the trash', async () => {
      const first = await seed('Scan');
      const second = await seed('Scan 2');

      const kept = await client().expectOk(MERGE, { input: { ids: [first, second], title: 'Scan' } });
      expect(kept.mergeDocuments.title).toBe('Scan (2)');

      const trashed = await client().expectOk(MERGE, {
        input: { ids: [first, second], title: 'Scan', trashOriginals: true },
      });
      // "Scan (2)" is the first merge's; "Scan" was the original's, which is in the trash now.
      expect(trashed.mergeDocuments.title).toBe('Scan');
      for (const id of [first, second]) {
        const [row] = await db.select().from(documents).where(eq(documents.id, id));
        expect(row.deletedAt).not.toBeNull();
      }
    });

    describe('when every source is ready', () => {
      it('carries their text over in page order and reads no page again', async () => {
        const events: PipelineEvents = createPipelineEvents();
        // OCR here and a vision model reading every OCR'd document: both would run on an upload.
        const vision = { auto: true, skipOcr: false } as VisionConfig;
        const pipeline = createPipeline({
          db,
          storage,
          events,
          steps: STEPS,
          config: {
            ocrAvailable: true,
            pdfTextAvailable: true,
            thumbnailTools: { pdf: false, image: false },
            ocrLanguages: 'eng',
            concurrency: 1,
            dateOrder: 'DMY',
          },
          embedder: createFakeEmbedder(),
          loadVision: async () => vision,
        });
        const first = await seed('First', { text: 'Invoice 12.03.2025\n', ocrRequested: true });
        const blank = await seed('Blank', { ocrRequested: true });
        const second = await seed('Second', { text: 'Page two says thanks.' });

        const data = await client(userId, true, events).expectOk(MERGE, {
          input: { ids: [second, blank, first], title: 'Bundle' },
        });
        const id = data.mergeDocuments.id;
        await pipeline.idle();

        expect(await storedText(id)).toBe('Page two says thanks.\n\nInvoice 12.03.2025');
        const steps = await stepsOf(id);
        for (const step of STEPS.filter((s) => s.extractsText)) {
          expect(steps.get(step.name)).toMatchObject({ status: StepStatus.Skipped, attempts: 0, startedAt: null });
        }
        // The steps that read the text still run on it.
        expect(steps.get('metadata')?.status).toBe(StepStatus.Succeeded);
        expect(steps.get('index')?.status).toBe(StepStatus.Succeeded);
        const [row] = await db.select().from(documents).where(eq(documents.id, id));
        expect(row).toMatchObject({ status: DocumentStatus.Ready, documentDate: '2025-03-12', contentFormat: 'plain' });
      });

      it('keeps Markdown only when every source with text was Markdown', async () => {
        const a = await seed('a', { text: '# One', contentFormat: 'markdown' });
        const b = await seed('b', { text: '# Two', contentFormat: 'markdown' });
        const c = await seed('c', { text: 'plain words' });
        const both = await client().expectOk(MERGE, { input: { ids: [a, b], title: 'md' } });
        const mixed = await client().expectOk(MERGE, { input: { ids: [a, c], title: 'mixed' } });
        const formats = await db.select({ id: documents.id, format: documents.contentFormat }).from(documents);
        const formatOf = (id: string) => formats.find((row) => row.id === id)?.format;
        expect(formatOf(both.mergeDocuments.id)).toBe('markdown');
        expect(formatOf(mixed.mergeDocuments.id)).toBe('plain');
      });
    });

    it('reads the merged copy afresh when a source failed', async () => {
      const a = await seed('a', { text: 'kept' });
      const failed = await seed('failed', { status: DocumentStatus.Failed, ocrRequested: true });
      const data = await client().expectOk(MERGE, { input: { ids: [a, failed], title: 'ab' } });
      const id = data.mergeDocuments.id;
      expect(await storedText(id)).toBeNull();
      for (const row of (await stepsOf(id)).values()) {
        expect(row.status).toBe(StepStatus.Queued);
      }
    });

    it('names a source it cannot read and files nothing', async () => {
      const locked = join(dir, 'locked.pdf');
      await python(
        `import sys, pikepdf
pdf = pikepdf.new()
pdf.add_blank_page()
pdf.save(sys.argv[1], encryption=pikepdf.Encryption(owner="owner", user="secret"))`,
        locked,
      );
      const a = await seed('a');
      const secret = await seed('Payslip', { body: await readFile(locked) });
      const before = await db.select().from(documents);

      const error = await client().expectError(MERGE, { input: { ids: [a, secret], title: 'ab' } });
      expect(error.code).toBe(ErrorCode.BadUserInput);
      expect(error.message).toMatch(/Payslip.*password/);
      expect(await db.select().from(documents)).toHaveLength(before.length);
    });
  });
});

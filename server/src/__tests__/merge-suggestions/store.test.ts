import { DocumentStatus, documents, MergeSuggestionStatus, mergeSuggestions } from '@cubicecho/engrafo-db/schema';
import { eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { MERGE_SUGGESTION_DEFAULTS } from '../../core/defaults.ts';
import { loadCandidates } from '../../merge-suggestions/candidates.ts';
import { loadOpenSuggestions, markMerged, memberKey, rescoreUser } from '../../merge-suggestions/store.ts';
import { type ByteRange, textKey } from '../../storage/s3.ts';
import { createFakeStorage, createTestDb, createUser, type FakeStorage, type TestDb } from '../helpers.ts';
import { at, candidate, invoicePages, morning, twoReceipts } from './fixtures.ts';
import { insertPassages, padded, type Seeded, seedCandidates } from './seed.ts';

// The morning's fixtures filed as real rows, scored, and stored. The day after, so all of it is
// inside the lookback.
const NOW = new Date(at(0).getTime() + 24 * 60 * 60 * 1000);

describe('rescoreUser', () => {
  let db: TestDb;
  let storage: FakeStorage;
  let userId: string;

  beforeEach(async () => {
    db = await createTestDb();
    storage = createFakeStorage();
    userId = await createUser(db, 'owner@example.com');
  });

  const rescore = () => rescoreUser({ db, storage }, userId, { now: NOW });
  const rowsOf = (owner = userId) => db.select().from(mergeSuggestions).where(eq(mergeSuggestions.userId, owner));
  const idsOf = (seeded: Seeded, names: readonly { id: string }[]) =>
    names.map((name) => seeded.ids.get(name.id) ?? name.id);

  it('stores a three-page split as one open suggestion, in page order', async () => {
    // Filed last page first, as a browser may upload a folder.
    const reversed = [...invoicePages].reverse();
    const seeded = await seedCandidates(db, storage, userId, reversed);

    expect(await rescore()).toEqual({ inserted: 1, updated: 0, deleted: 0 });

    const [row, ...others] = await rowsOf();
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      documentIds: idsOf(seeded, invoicePages),
      memberKey: memberKey(idsOf(seeded, invoicePages)),
      status: MergeSuggestionStatus.Open,
      aiVerdicts: [],
    });
    expect(row.confidence).toBeGreaterThan(0.85);
    expect(row.reasons.map((reason) => reason.text)).toContain('page 2 of 3 follows page 1');
  });

  it('suggests nothing for two receipts scanned back to back', async () => {
    await seedCandidates(db, storage, userId, twoReceipts);
    expect(await rescore()).toEqual({ inserted: 0, updated: 0, deleted: 0 });
    expect(await rowsOf()).toEqual([]);
  });

  it('stores what the scorer finds in a whole morning', async () => {
    await seedCandidates(db, storage, userId, morning);
    await rescore();
    expect((await rowsOf()).map((row) => row.documentIds.length).sort()).toEqual([2, 2, 3]);
  });

  it('updates an open suggestion found again rather than adding another', async () => {
    await seedCandidates(db, storage, userId, invoicePages);
    await rescore();
    const [before] = await rowsOf();

    expect(await rescore()).toEqual({ inserted: 0, updated: 1, deleted: 0 });
    const [after, ...others] = await rowsOf();
    expect(others).toEqual([]);
    expect(after.id).toBe(before.id);
  });

  it('never proposes a dismissed set again, but does a larger set containing it', async () => {
    const seeded = await seedCandidates(db, storage, userId, invoicePages.slice(0, 2));
    await rescore();
    const [first] = await rowsOf();
    await db
      .update(mergeSuggestions)
      .set({ status: MergeSuggestionStatus.Dismissed })
      .where(eq(mergeSuggestions.id, first.id));

    expect(await rescore()).toEqual({ inserted: 0, updated: 0, deleted: 0 });
    const [kept] = await rowsOf();
    expect(kept).toMatchObject({ status: MergeSuggestionStatus.Dismissed, confidence: first.confidence });

    // The third page arrives later.
    await seedCandidates(db, storage, userId, invoicePages.slice(2), seeded);
    expect(await rescore()).toEqual({ inserted: 1, updated: 0, deleted: 0 });
    const rows = await rowsOf();
    expect(rows.map((row) => [row.documentIds.length, row.status]).sort()).toEqual([
      [2, MergeSuggestionStatus.Dismissed],
      [3, MergeSuggestionStatus.Open],
    ]);
  });

  it('drops an open suggestion once a member is in the trash', async () => {
    const seeded = await seedCandidates(db, storage, userId, invoicePages);
    await rescore();
    const [row] = await rowsOf();
    const middle = seeded.ids.get('invoice-2') ?? '';
    await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, middle));

    // Stale already, before the next rescore notices.
    expect(await loadOpenSuggestions(db, userId)).toEqual([]);

    await rescore();
    const after = await rowsOf();
    expect(after.map((each) => each.id)).not.toContain(row.id);
    expect(after.flatMap((each) => each.documentIds)).not.toContain(middle);
  });

  it('keeps a merged suggestion as the record of what was decided', async () => {
    const seeded = await seedCandidates(db, storage, userId, invoicePages);
    await rescore();
    const ids = idsOf(seeded, invoicePages);

    await markMerged(db, userId, [...ids].reverse());
    const [merged] = await rowsOf();
    expect(merged.status).toBe(MergeSuggestionStatus.Merged);

    // The originals were kept, so the scorer finds the same set; it stays merged, and is not live.
    expect(await rescore()).toEqual({ inserted: 0, updated: 0, deleted: 0 });
    expect((await rowsOf())[0].status).toBe(MergeSuggestionStatus.Merged);
    expect(await loadOpenSuggestions(db, userId)).toEqual([]);
  });

  it('marks nothing for a set nobody suggested, or for another user', async () => {
    const seeded = await seedCandidates(db, storage, userId, invoicePages);
    await rescore();
    const ids = idsOf(seeded, invoicePages);
    const other = await createUser(db, 'other@example.com');

    await markMerged(db, userId, ids.slice(0, 2));
    await markMerged(db, other, ids);
    expect((await rowsOf())[0].status).toBe(MergeSuggestionStatus.Open);
  });

  it('reads only open suggestions whose members are all ready', async () => {
    const seeded = await seedCandidates(db, storage, userId, invoicePages);
    await rescore();
    expect(await loadOpenSuggestions(db, userId)).toHaveLength(1);

    await db
      .update(documents)
      .set({ status: DocumentStatus.Processing })
      .where(eq(documents.id, seeded.ids.get('invoice-1') ?? ''));
    expect(await loadOpenSuggestions(db, userId)).toEqual([]);
  });
});

describe('loadCandidates', () => {
  let db: TestDb;
  let storage: FakeStorage;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    db = await createTestDb();
    storage = createFakeStorage();
    alice = await createUser(db, 'alice@example.com');
    bob = await createUser(db, 'bob@example.com');
  });

  it('reads the ends of each text and the mean of its passages', async () => {
    const seeded = await seedCandidates(db, storage, alice, invoicePages.slice(0, 1));
    const [loaded] = await loadCandidates({ db, storage }, alice, { now: NOW });
    expect(loaded).toMatchObject({
      id: seeded.ids.get('invoice-1'),
      originalFilename: 'scan_0003.pdf',
      documentDate: '2026-11-03',
      textHead: invoicePages[0].textHead,
      textTail: invoicePages[0].textTail,
    });
    const expected = padded(invoicePages[0].meanEmbedding ?? []);
    expect(loaded.meanEmbedding?.length).toBe(expected.length);
    loaded.meanEmbedding?.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index] ?? 0, 5);
    });
  });

  it('reads only the ends of a long text, cut at characters not bytes', async () => {
    const line = 'Größe 🧾 Seite übertragen, ';
    const text = `Anfang ${line.repeat(400)}Ende`;
    const [seededDoc] = await db
      .insert(documents)
      .values({
        userId: alice,
        title: 'long',
        originalFilename: 'long.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        originalKey: 'originals/long',
        status: DocumentStatus.Ready,
        createdAt: at(0),
      })
      .returning();
    const key = textKey(alice, seededDoc.id);
    await storage.text.put(key, text, 'text/plain; charset=utf-8');
    await db
      .update(documents)
      .set({ contentKey: key, contentBytes: Buffer.byteLength(text) })
      .where(eq(documents.id, seededDoc.id));

    const ranges: Array<ByteRange | undefined> = [];
    const getStream = storage.text.getStream;
    storage.text.getStream = (streamKey, range) => {
      ranges.push(range);
      return getStream(streamKey, range);
    };

    const [loaded] = await loadCandidates({ db, storage }, alice, { now: NOW });
    const chars = MERGE_SUGGESTION_DEFAULTS.aiContextChars;
    expect(loaded.textHead).toBe(text.slice(0, chars));
    expect(loaded.textTail).toBe(text.slice(-chars));
    // The end is a range from the end, not the whole text.
    const bytes = Buffer.byteLength(text);
    expect(ranges).toContainEqual({ first: bytes - (chars + 1) * 3, last: bytes - 1 });
  });

  it('leaves text empty and the embedding null for a document with neither', async () => {
    await seedCandidates(db, storage, alice, [candidate({ id: 'blank', createdAt: at(0) })]);
    const [loaded] = await loadCandidates({ db, storage }, alice, { now: NOW });
    expect(loaded).toMatchObject({ textHead: '', textTail: '', meanEmbedding: null });
  });

  it('takes only ready, filed PDFs and images from the lookback', async () => {
    const seeded = await seedCandidates(db, storage, alice, [
      candidate({ id: 'scan', createdAt: at(0) }),
      candidate({ id: 'notes', createdAt: at(10), mimeType: 'text/markdown' }),
      candidate({ id: 'old', createdAt: new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000) }),
      candidate({ id: 'trashed', createdAt: at(20) }),
      candidate({ id: 'busy', createdAt: at(30) }),
    ]);
    await db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, seeded.ids.get('trashed') ?? ''));
    await db
      .update(documents)
      .set({ status: DocumentStatus.Processing })
      .where(eq(documents.id, seeded.ids.get('busy') ?? ''));

    const loaded = await loadCandidates({ db, storage }, alice, { now: NOW });
    expect(loaded.map((each) => each.id)).toEqual([seeded.ids.get('scan')]);
  });

  it('never reads another user’s documents or passages', async () => {
    const mine = await seedCandidates(db, storage, alice, invoicePages);
    const theirs = await seedCandidates(db, storage, bob, invoicePages);
    // A passage carrying Bob's id on Alice's document, which the pipeline never writes: the read
    // filters by its own user all the same.
    const first = mine.ids.get('invoice-1') ?? '';
    await insertPassages(db, bob, first, [0, 0, 0, 0, 1], 2);

    const loaded = await loadCandidates({ db, storage }, alice, { now: NOW });
    const theirIds = [...theirs.ids.values()];
    expect(loaded.map((each) => each.id).sort()).toEqual([...mine.ids.values()].sort());
    expect(loaded.some((each) => theirIds.includes(each.id))).toBe(false);
    const firstLoaded = loaded.find((each) => each.id === first);
    expect(firstLoaded?.meanEmbedding?.[4]).toBeCloseTo(0, 5);

    await rescoreUser({ db, storage }, alice, { now: NOW });
    const rows = await db.select().from(mergeSuggestions);
    expect(rows.map((row) => row.userId)).toEqual([alice]);
    const bobsDocs = await db.select().from(documents).where(inArray(documents.id, theirIds));
    expect(rows[0].documentIds.some((id) => bobsDocs.some((doc) => doc.id === id))).toBe(false);
  });
});

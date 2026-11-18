import { randomUUID } from 'node:crypto';
import {
  DocumentStatus,
  documents,
  type MergeSuggestionStatus,
  mergeSuggestions,
  type StoredMergeVerdict,
} from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { memberKey } from '../../merge-suggestions/store.ts';
import { createMergeSuggester } from '../../merge-suggestions/suggester.ts';
import { createPipelineEvents } from '../../pipeline/events.ts';
import { createClient, createFakeStorage, createTestDb, createUser, type TestDb } from '../helpers.ts';
import { at, invoicePages } from './fixtures.ts';
import { seedCandidates } from './seed.ts';

// The suggested merges as the person reads and answers them. Rows are written directly, so each
// test decides exactly what is stored; what the API may show of it is the subject.

const LIST = `
  query ($documentId: UUID) {
    mergeSuggestions {
      count
      suggestions(documentId: $documentId) {
        id
        confidence
        heuristicConfidence
        band
        reasons { signal text points }
        verdicts { fromId toId continues confidence reason model checkedAt }
        createdAt
        documents { id title folderId mimeType sizeBytes archiveKey }
      }
    }
  }
`;
const COUNT = '{ mergeSuggestions { count } }';
const DISMISS = 'mutation ($id: UUID!) { dismissMergeSuggestion(id: $id) }';
const RESCORE = 'mutation { rescoreMergeSuggestions { count suggestions { documents { id } } } }';

describe('the suggested merges API', () => {
  let db: TestDb;
  let userId: string;
  let otherId: string;

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
    otherId = await createUser(db, 'other@example.com');
  });

  const client = () => createClient(db, userId);
  const other = () => createClient(db, otherId);

  /** A ready PDF of the owner's, or of whoever is named. */
  async function page(title: string, owner = userId, status: DocumentStatus = DocumentStatus.Ready) {
    const id = randomUUID();
    await db.insert(documents).values({
      id,
      userId: owner,
      title,
      originalFilename: `${title}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 100,
      originalKey: `originals/${owner}/${id}`,
      status,
    });
    return id;
  }

  interface Stored {
    owner?: string;
    confidence?: number;
    heuristicConfidence?: number;
    status?: MergeSuggestionStatus;
    verdicts?: StoredMergeVerdict[];
  }

  /** A stored suggestion over these documents, in this order. */
  async function suggest(documentIds: string[], stored: Stored = {}) {
    const { owner = userId, confidence = 0.9, status = 'open', verdicts = [] } = stored;
    const heuristicConfidence = stored.heuristicConfidence ?? confidence;
    const [row] = await db
      .insert(mergeSuggestions)
      .values({
        userId: owner,
        documentIds,
        memberKey: memberKey(documentIds),
        links: documentIds.slice(1).map((toId, index) => ({ fromId: documentIds[index], toId, heuristic: 0.7 })),
        aiVerdicts: verdicts,
        heuristicConfidence,
        confidence,
        reasons: [
          { signal: 'time', text: 'scanned 40 s apart', points: 1.5 },
          { signal: 'letterhead', text: 'page 2 opens with a letterhead', points: -0.8 },
        ],
        status,
      })
      .returning();
    return row.id;
  }

  const statusOf = async (id: string) =>
    (await db.select().from(mergeSuggestions).where(eq(mergeSuggestions.id, id)))[0]?.status;

  describe('reads', () => {
    it('lists a suggestion with its documents in page order, its band, reasons and verdicts', async () => {
      const first = await page('scan_0001');
      const second = await page('scan_0002');
      const verdict: StoredMergeVerdict = {
        fromId: second,
        toId: first,
        continues: true,
        confidence: 0.8,
        reason: 'the sentence runs on',
        model: 'qwen',
        checkedAt: '2026-11-01T10:00:00.000Z',
      };
      // Second page first: the stored order is the page order, whatever the filing order was.
      const id = await suggest([second, first], { confidence: 0.92, heuristicConfidence: 0.7, verdicts: [verdict] });

      const { mergeSuggestions: read } = await client().expectOk(LIST);

      expect(read.count).toBe(1);
      expect(read.suggestions).toHaveLength(1);
      const [suggestion] = read.suggestions;
      expect(suggestion).toMatchObject({
        id,
        confidence: 0.92,
        heuristicConfidence: 0.7,
        band: 'HIGH',
        // In-process, the DateTime scalar hands back the Date it serialises.
        verdicts: [{ ...verdict, checkedAt: new Date(verdict.checkedAt) }],
      });
      expect(suggestion.documents.map((doc: { id: string }) => doc.id)).toEqual([second, first]);
      expect(suggestion.documents[0]).toMatchObject({
        title: 'scan_0002',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });
      expect(suggestion.reasons.map((reason: { text: string }) => reason.text)).toEqual([
        'scanned 40 s apart',
        'page 2 opens with a letterhead',
      ]);
    });

    it('lists the surest first, and names each band', async () => {
      const ids = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((title) => page(title)));
      await suggest(ids.slice(0, 2), { confidence: 0.6 });
      await suggest(ids.slice(2, 4), { confidence: 0.95 });
      await suggest(ids.slice(4, 6), { confidence: 0.7 });

      const { mergeSuggestions: read } = await client().expectOk(LIST);

      expect(read.suggestions.map((each: { confidence: number }) => each.confidence)).toEqual([0.95, 0.7, 0.6]);
      expect(read.suggestions.map((each: { band: string }) => each.band)).toEqual(['HIGH', 'MEDIUM', 'LOW']);
    });

    it('hides a suggestion the model rejected, and does not count it', async () => {
      // The rules never store one under minConfidence, so a row under it is the model's "no".
      await suggest([await page('a'), await page('b')], { confidence: 0.2, heuristicConfidence: 0.7 });

      const { mergeSuggestions: read } = await client().expectOk(LIST);

      expect(read).toEqual({ count: 0, suggestions: [] });
    });

    it('hides a suggestion once a member is in the trash', async () => {
      const first = await page('a');
      const second = await page('b');
      await suggest([first, second]);
      await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, second));

      expect((await client().expectOk(LIST)).mergeSuggestions).toEqual({ count: 0, suggestions: [] });
    });

    it('hides a suggestion whose member is back in the pipeline', async () => {
      const first = await page('a');
      await suggest([first, await page('b', userId, DocumentStatus.Processing)]);

      expect((await client().expectOk(COUNT)).mergeSuggestions.count).toBe(0);
    });

    it('hides a dismissed or merged suggestion', async () => {
      await suggest([await page('a'), await page('b')], { status: 'dismissed' });
      await suggest([await page('c'), await page('d')], { status: 'merged' });

      expect((await client().expectOk(LIST)).mergeSuggestions).toEqual({ count: 0, suggestions: [] });
    });

    it('shows nobody else the caller’s suggestions', async () => {
      await suggest([await page('a'), await page('b')]);

      expect((await other().expectOk(LIST)).mergeSuggestions).toEqual({ count: 0, suggestions: [] });
    });

    it('hides a row naming someone else’s document, even the caller’s own', async () => {
      // Never written by the suggester, which reads one user's documents; a read must not trust it.
      await suggest([await page('mine'), await page('theirs', otherId)]);

      expect((await client().expectOk(LIST)).mergeSuggestions).toEqual({ count: 0, suggestions: [] });
    });

    it('lists only the suggestions a document is in when asked about one', async () => {
      const first = await page('a');
      const second = await page('b');
      const third = await page('c');
      const fourth = await page('d');
      const withFirst = await suggest([first, second]);
      await suggest([third, fourth]);

      const { mergeSuggestions: read } = await client().expectOk(LIST, { documentId: first });

      expect(read.suggestions.map((each: { id: string }) => each.id)).toEqual([withFirst]);
      // The count is the badge's: every shown suggestion, whatever was asked about.
      expect(read.count).toBe(2);
    });

    it('answers nothing about someone else’s document', async () => {
      const theirs = await page('a', otherId);
      await suggest([theirs, await page('b', otherId)], { owner: otherId });

      const { mergeSuggestions: read } = await client().expectOk(LIST, { documentId: theirs });

      expect(read.suggestions).toEqual([]);
    });

    it('asks for a session', async () => {
      const error = await createClient(db, null).expectError(COUNT);
      expect(error.code).toBe(ErrorCode.Unauthenticated);
    });
  });

  describe('dismissMergeSuggestion', () => {
    it('dismisses the caller’s open suggestion, which leaves the list and the count', async () => {
      const id = await suggest([await page('a'), await page('b')]);

      expect((await client().expectOk(DISMISS, { id })).dismissMergeSuggestion).toBe(true);

      expect(await statusOf(id)).toBe('dismissed');
      expect((await client().expectOk(LIST)).mergeSuggestions).toEqual({ count: 0, suggestions: [] });
    });

    it('answers true again for one already dismissed', async () => {
      const id = await suggest([await page('a'), await page('b')]);
      await client().expectOk(DISMISS, { id });

      expect((await client().expectOk(DISMISS, { id })).dismissMergeSuggestion).toBe(true);
      expect(await statusOf(id)).toBe('dismissed');
    });

    it('is NOT_FOUND for someone else’s, and leaves it open', async () => {
      const id = await suggest([await page('a', otherId), await page('b', otherId)], { owner: otherId });

      const error = await client().expectError(DISMISS, { id });

      expect(error.code).toBe(ErrorCode.NotFound);
      expect(await statusOf(id)).toBe('open');
    });

    it('is NOT_FOUND for a merged one, and leaves it merged', async () => {
      const id = await suggest([await page('a'), await page('b')], { status: 'merged' });

      expect((await client().expectError(DISMISS, { id })).code).toBe(ErrorCode.NotFound);
      expect(await statusOf(id)).toBe('merged');
    });

    it('is NOT_FOUND for an id that is no suggestion, or no UUID at all', async () => {
      expect((await client().expectError(DISMISS, { id: randomUUID() })).code).toBe(ErrorCode.NotFound);
      // The UUID scalar refuses the variable before the resolver sees it.
      const notAnId = await client().run(DISMISS, { id: 'not-an-id' });
      expect(notAnId.errors?.[0]?.message).toMatch(/UUID/i);
    });
  });

  describe('rescoreMergeSuggestions', () => {
    it('scores the caller’s documents now and answers with what it wrote', async () => {
      const storage = createFakeStorage();
      await seedCandidates(db, storage, userId, invoicePages);
      const day = 24 * 60 * 60 * 1000;
      const suggester = createMergeSuggester({
        db,
        storage,
        events: createPipelineEvents(),
        now: () => new Date(at(0).getTime() + day),
        log: () => undefined,
      });

      const { rescoreMergeSuggestions } = await createClient(db, userId, {
        storage,
        mergeSuggester: suggester,
      }).expectOk(RESCORE);

      expect(rescoreMergeSuggestions.count).toBe(1);
      expect(rescoreMergeSuggestions.suggestions[0].documents).toHaveLength(invoicePages.length);
    });

    it('runs one rescore at a time, and folds the presses made meanwhile into one more', async () => {
      let running = 0;
      let most = 0;
      let runs = 0;
      const releases: Array<() => void> = [];
      const suggester = createMergeSuggester({
        db,
        storage: createFakeStorage(),
        events: createPipelineEvents(),
        rescore: async () => {
          runs += 1;
          running += 1;
          most = Math.max(most, running);
          await new Promise<void>((release) => releases.push(release));
          running -= 1;
          return { inserted: 0, updated: 0, deleted: 0 };
        },
        check: async () => ({ asked: 0, recorded: 0 }),
        log: () => undefined,
      });
      const asOwner = createClient(db, userId, { mergeSuggester: suggester });

      const until = async (condition: () => boolean) => {
        while (condition() === false) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      };

      const presses = [asOwner.run(RESCORE), asOwner.run(RESCORE), asOwner.run(RESCORE)];
      // The first press starts a run; the other two arrive while it is held open.
      await until(() => runs === 1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      releases.shift()?.();
      // They are one run after it, not two beside it.
      await until(() => runs === 2);
      releases.shift()?.();
      const results = await Promise.all(presses);

      expect(results.every((result) => result.errors === undefined)).toBe(true);
      expect(most).toBe(1);
      expect(runs).toBe(2);
    });
  });
});

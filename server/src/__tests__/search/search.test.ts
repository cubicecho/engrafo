import { documentChunks, documents } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { indexDocument } from '../../search/index-document.ts';
import { searchDocuments, snippet } from '../../search/search.ts';
import {
  createClient,
  createFakeEmbedder,
  createFakeStorage,
  createTestDb,
  createUser,
  type FakeStorage,
  type TestDb,
} from '../helpers.ts';

// Search against a real Postgres (PGlite with pgvector) and the fake embedder,
// whose cosine is word overlap. That is enough to check the plumbing: each side
// finds what it should, the fusion ranks, and nobody sees anyone else's text.
// How well the real model ranks meaning is mcp-ragdown's benchmark, not this.

const SEARCH = `query ($query: String!, $first: Int) {
  searchDocuments(query: $query, first: $first) { snippet score document { id title } }
}`;

describe('document search', () => {
  let db: TestDb;
  let storage: FakeStorage;
  let alice: string;
  let bob: string;
  const embedder = createFakeEmbedder();

  beforeEach(async () => {
    db = await createTestDb();
    storage = createFakeStorage();
    alice = await createUser(db, 'alice@example.com');
    bob = await createUser(db, 'bob@example.com');
  });

  /** A ready document with this text, indexed. */
  async function indexed(userId: string, title: string, text: string) {
    const contentKey = `text/${userId}/${title}`;
    storage.text.objects.set(contentKey, { body: Buffer.from(text), contentType: 'text/plain' });
    const [doc] = await db
      .insert(documents)
      .values({
        userId,
        title,
        originalFilename: `${title}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1,
        originalKey: `originals/${userId}/${title}`,
        contentKey,
        status: 'ready',
      })
      .returning();
    await indexDocument({ db, storage, embedder }, doc);
    return doc;
  }

  const search = (userId: string, query: string, minCosine = 0.3) =>
    searchDocuments({ db, embedder }, userId, query, 10, { minCosine });

  it('finds a document by a word in its text, with the passage around it', async () => {
    const lease = await indexed(alice, 'Lease', 'The tenant pays rent monthly.\n\nThe deposit is 1200 EUR.');
    await indexed(alice, 'Invoice', 'Invoice 4711 for plumbing work.');

    const hits = await search(alice, 'deposit');
    expect(hits[0]?.document.id).toBe(lease.id);
    expect(hits[0]?.snippet).toContain('deposit is 1200 EUR');
  });

  it('finds an exact number the way it was written', async () => {
    const invoice = await indexed(alice, 'Invoice', 'Invoice 4711 for plumbing work.');
    await indexed(alice, 'Lease', 'The tenant pays rent monthly.');
    expect((await search(alice, '4711')).map((hit) => hit.document.id)).toEqual([invoice.id]);
  });

  it('finds a document by its title even when it has no text', async () => {
    const [scan] = await db
      .insert(documents)
      .values({
        userId: alice,
        title: 'Passport scan',
        originalFilename: 'passport.png',
        mimeType: 'image/png',
        sizeBytes: 1,
        originalKey: `originals/${alice}/passport`,
        status: 'ready',
      })
      .returning();
    const hits = await search(alice, 'passport');
    expect(hits.map((hit) => hit.document.id)).toEqual([scan.id]);
    expect(hits[0]?.snippet).toBe('');
  });

  it('ranks a document matching on both sides above one matching on one', async () => {
    const both = await indexed(alice, 'Boiler', 'Boiler service contract with annual boiler service.');
    await indexed(alice, 'Car', 'Car service at the garage.');
    expect((await search(alice, 'boiler service'))[0]?.document.id).toBe(both.id);
  });

  it("never returns another user's documents, whatever matches", async () => {
    await indexed(bob, 'Bob lease', 'The deposit is 900 EUR.');
    expect(await search(alice, 'deposit')).toEqual([]);
  });

  it('returns nothing for a query that shares nothing, rather than the nearest anything', async () => {
    await indexed(alice, 'Lease', 'The tenant pays rent monthly.');
    expect(await search(alice, 'zebra', 0.8)).toEqual([]);
  });

  it('drops a document from search when its text is gone', async () => {
    const lease = await indexed(alice, 'Lease', 'The deposit is 1200 EUR.');
    await db.update(documents).set({ contentKey: null }).where(eq(documents.id, lease.id));
    await indexDocument({ db, storage, embedder }, { ...lease, contentKey: null });
    expect(await db.select().from(documentChunks).where(eq(documentChunks.documentId, lease.id))).toEqual([]);
    expect(await search(alice, 'deposit')).toEqual([]);
  });

  it('answers over GraphQL for the signed-in user, and refuses an empty query', async () => {
    const lease = await indexed(alice, 'Lease', 'The deposit is 1200 EUR.');
    const client = createClient(db, alice, { storage, embedder });
    const data = await client.expectOk(SEARCH, { query: 'deposit' });
    expect(data.searchDocuments.map((hit: { document: { id: string } }) => hit.document.id)).toEqual([lease.id]);

    expect((await client.expectError(SEARCH, { query: '   ' })).code).toBe(ErrorCode.BadUserInput);
    expect((await client.expectError(SEARCH, { query: 'x', first: 500 })).code).toBe(ErrorCode.BadUserInput);
    const signedOut = createClient(db, null, { storage, embedder });
    expect((await signedOut.expectError(SEARCH, { query: 'deposit' })).code).toBe(ErrorCode.Unauthenticated);
  });
});

describe('snippet', () => {
  const text = `${'Preamble words go here. '.repeat(20)}The deposit is 1200 EUR. ${'More words after. '.repeat(20)}`;

  it('is a window around the first word of the query, cut at word boundaries', () => {
    const out = snippet(text, 'deposit', 80);
    expect(out).toContain('deposit is 1200 EUR');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(82);
  });

  it('is the start of the passage when no word matches, and the whole of a short one', () => {
    expect(snippet(text, 'zebra', 40).startsWith('Preamble')).toBe(true);
    expect(snippet('Short.', 'zebra', 40)).toBe('Short.');
  });
});

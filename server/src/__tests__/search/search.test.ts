import { documentChunks, documents, folders, type NewDocument } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { browseDocuments } from '../../search/browse.ts';
import type { SearchFilter } from '../../search/filters.ts';
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
  async function indexed(
    userId: string,
    title: string,
    text: string,
    mimeType = 'application/pdf',
    values: Partial<NewDocument> = {},
  ) {
    const contentKey = `text/${userId}/${title}`;
    storage.text.objects.set(contentKey, { body: Buffer.from(text), contentType: 'text/plain' });
    const [doc] = await db
      .insert(documents)
      .values({
        userId,
        title,
        originalFilename: `${title}.pdf`,
        mimeType,
        sizeBytes: 1,
        originalKey: `originals/${userId}/${title}`,
        contentKey,
        status: 'ready',
        ...values,
      })
      .returning();
    await indexDocument({ db, storage, embedder }, doc);
    return doc;
  }

  const search = (userId: string, query: string, minCosine = 0.3, filter: SearchFilter = {}) =>
    searchDocuments({ db, embedder }, userId, query, 10, { minCosine, filter });

  it("cuts an ebook's passages by chapter and embeds each under its chapter's name", async () => {
    const novel = await indexed(
      alice,
      'Novel',
      'Title page.\n\n# One\n\nFirst.\n\n# Two\n\nSecond.',
      'application/epub+zip',
      { contentFormat: 'markdown' },
    );

    const passages = await db
      .select({ content: documentChunks.content })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, novel.id))
      .orderBy(documentChunks.position);
    expect(passages.map((p) => p.content)).toEqual(['Title page.', 'First.', 'Second.']);
    expect(embedder.embedded).toEqual(
      expect.arrayContaining(['Novel\n\nTitle page.', 'Novel\nOne\n\nFirst.', 'Novel\nTwo\n\nSecond.']),
    );
  });

  it('embeds a Markdown passage under its breadcrumb of headings', async () => {
    await indexed(alice, 'Runbook', '# Backups\n\n## Restore\n\nRun it twice.', 'text/markdown', {
      contentFormat: 'markdown',
    });

    expect(embedder.embedded).toContain('Runbook\nBackups › Restore\n\nRun it twice.');
  });

  it("embeds a CSV's rows under its header row, and stores the rows alone", async () => {
    const statement = await indexed(
      alice,
      'Statement',
      'Date,Description,Amount\n2024-01-02,COFFEE SHOP,-3.50\n2024-01-03,PAYROLL,2100.00\n',
      'text/csv',
    );

    expect(embedder.embedded).toContain(
      'Statement\nDate,Description,Amount\n\n2024-01-02,COFFEE SHOP,-3.50\n2024-01-03,PAYROLL,2100.00',
    );
    const passages = await db
      .select({ content: documentChunks.content })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, statement.id));
    expect(passages).toEqual([{ content: '2024-01-02,COFFEE SHOP,-3.50\n2024-01-03,PAYROLL,2100.00' }]);
  });

  it("embeds a web page's passages under its headings", async () => {
    await indexed(alice, 'Order', '# Order 1234\n\n## Items\n\nOne kettle.', 'text/html', {
      contentFormat: 'markdown',
    });

    expect(embedder.embedded).toContain('Order\nOrder 1234 › Items\n\nOne kettle.');
  });

  it('cuts a scan by its headings when the vision model wrote it as Markdown', async () => {
    await indexed(alice, 'Manual', '# Setup\n\n## Wiring\n\nRed to red.', 'application/pdf', {
      contentFormat: 'markdown',
    });

    expect(embedder.embedded).toContain('Manual\nSetup › Wiring\n\nRed to red.');
  });

  it('leaves a line starting with "# " alone in anything without headings', async () => {
    const scan = await indexed(alice, 'Scan', 'Order\n\n# 4711\n\nShipped.');

    const passages = await db
      .select({ content: documentChunks.content })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, scan.id));
    expect(passages.map((p) => p.content)).toEqual(['Order\n\n# 4711\n\nShipped.']);
  });

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

describe('search filters', () => {
  let db: TestDb;
  let storage: FakeStorage;
  let alice: string;
  const embedder = createFakeEmbedder();

  beforeEach(async () => {
    db = await createTestDb();
    storage = createFakeStorage();
    alice = await createUser(db, 'alice@example.com');
  });

  async function indexed(title: string, text: string, values: Partial<NewDocument> = {}) {
    const contentKey = `text/${alice}/${title}`;
    storage.text.objects.set(contentKey, { body: Buffer.from(text), contentType: 'text/plain' });
    const [doc] = await db
      .insert(documents)
      .values({
        userId: alice,
        title,
        originalFilename: `${title}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1,
        originalKey: `originals/${alice}/${title}`,
        contentKey,
        status: 'ready',
        ...values,
      })
      .returning();
    await indexDocument({ db, storage, embedder }, doc);
    return doc;
  }

  const search = (query: string, filter: SearchFilter) =>
    searchDocuments({ db, embedder }, alice, query, 10, { minCosine: 0.3, filter });
  const found = async (query: string, filter: SearchFilter) =>
    (await search(query, filter)).map((hit) => hit.document.title).sort();

  it('narrows by kind', async () => {
    await indexed('Scan', 'Rent receipt', { mimeType: 'image/png' });
    await indexed('Note', 'Rent notes', { mimeType: 'text/markdown' });
    await indexed('Lease', 'Rent lease');
    await indexed('Statement', 'Date,Payee\n2026-03-01,Rent', { mimeType: 'text/csv' });
    await indexed('Order', 'Rent order', { mimeType: 'text/html' });
    expect(await found('rent', { kinds: ['IMAGE', 'TEXT'] })).toEqual(['Note', 'Order', 'Scan', 'Statement']);
    expect(await found('rent', { kinds: ['PDF'] })).toEqual(['Lease']);
    expect(await found('rent', { kinds: [] })).toEqual([]);
  });

  it('narrows by the date on the document, inclusive, leaving undated ones out', async () => {
    await indexed('March', 'Rent', { documentDate: '2026-03-01' });
    await indexed('April', 'Rent', { documentDate: '2026-04-30' });
    await indexed('May', 'Rent', { documentDate: '2026-05-01' });
    await indexed('Undated', 'Rent');
    expect(await found('rent', { dateFrom: '2026-03-01', dateTo: '2026-04-30' })).toEqual(['April', 'March']);
    expect(await found('rent', { dateFrom: '2026-04-01' })).toEqual(['April', 'May']);
  });

  it('narrows to receipts, or away from them', async () => {
    await indexed('Receipt', 'Rent paid', { total: '950.00' });
    await indexed('Vendor only', 'Rent paid', { vendor: 'Landlord' });
    await indexed('Letter', 'Rent paid');
    expect(await found('rent', { hasReceipt: true })).toEqual(['Receipt', 'Vendor only']);
    expect(await found('rent', { hasReceipt: false })).toEqual(['Letter']);
  });

  it('narrows the title read too', async () => {
    await indexed('Rent', '', { mimeType: 'image/png' });
    await indexed('Rent 2', '');
    expect(await found('rent', { kinds: ['IMAGE'] })).toEqual(['Rent']);
  });

  it('filters inside each read, so a narrow search is not starved by better matches outside it', async () => {
    // More documents than each read hands the fusion, all matching better than the one asked for.
    // Filtering the fused list afterwards would find nothing.
    for (let i = 0; i < 55; i++) {
      await indexed(`Lease ${i}`, 'deposit deposit deposit deposit');
    }
    await indexed('Photo', 'deposit', { mimeType: 'image/jpeg' });
    expect(await found('deposit', { kinds: ['IMAGE'] })).toEqual(['Photo']);
  });

  it('narrows to a folder and everything inside it over GraphQL, or to the folder alone', async () => {
    const [taxes] = await db.insert(folders).values({ userId: alice, name: 'Taxes' }).returning();
    const [year] = await db.insert(folders).values({ userId: alice, name: '2026', parentId: taxes?.id }).returning();
    await indexed('Top', 'Rent', { folderId: taxes?.id });
    await indexed('Inside', 'Rent', { folderId: year?.id });
    await indexed('Outside', 'Rent');

    const client = createClient(db, alice, { storage, embedder });
    const titles = (data: { searchDocuments: Array<{ document: { title: string } }> }) =>
      data.searchDocuments.map((hit) => hit.document.title).sort();
    const query = `query ($filter: DocumentSearchFilter) {
      searchDocuments(query: "rent", filter: $filter) { document { title } }
    }`;
    expect(titles(await client.expectOk(query, { filter: { folderId: taxes?.id } }))).toEqual(['Inside', 'Top']);
    const alone = await client.expectOk(query, { filter: { folderId: taxes?.id, includeSubfolders: false } });
    expect(titles(alone)).toEqual(['Top']);
    const pdfs = await client.expectOk(query, { filter: { kinds: ['PDF'], dateFrom: '2000-01-01' } });
    expect(titles(pdfs)).toEqual([]);

    const backwards = await client.expectError(query, { filter: { dateFrom: '2026-02-01', dateTo: '2026-01-01' } });
    expect(backwards.code).toBe(ErrorCode.BadUserInput);
  });

  it("finds nothing in someone else's folder", async () => {
    const bob = await createUser(db, 'bob@example.com');
    const [theirs] = await db.insert(folders).values({ userId: bob, name: 'Bob' }).returning();
    await indexed('Mine', 'Rent');
    expect(await found('rent', { folderIds: theirs ? [theirs.id] : [] })).toEqual([]);
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

describe('browsing by filter, with no search', () => {
  let db: TestDb;
  let alice: string;

  beforeEach(async () => {
    db = await createTestDb();
    alice = await createUser(db, 'alice@example.com');
  });

  async function filed(title: string, values: Partial<NewDocument> = {}) {
    await db.insert(documents).values({
      userId: alice,
      title,
      originalFilename: `${title}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1,
      originalKey: `originals/${alice}/${title}`,
      status: 'ready',
      ...values,
    });
  }

  const browse = async (filter: SearchFilter, page = { first: 10, offset: 0 }) => {
    const { documents: rows, hasMore } = await browseDocuments({ db }, alice, filter, page);
    return { titles: rows.map((doc) => doc.title), hasMore };
  };

  it('lists the newest by the date on the document first, then the undated by upload time', async () => {
    await filed('Undated old', { createdAt: new Date('2026-01-01T00:00:00Z') });
    await filed('March', { documentDate: '2026-03-01' });
    await filed('Undated new', { createdAt: new Date('2026-05-01T00:00:00Z') });
    await filed('April', { documentDate: '2026-04-30' });
    expect((await browse({})).titles).toEqual(['April', 'March', 'Undated new', 'Undated old']);
  });

  it('narrows by the same filters as a search', async () => {
    await filed('Receipt', { total: '12.50', documentDate: '2026-03-02' });
    await filed('Scan', { mimeType: 'image/png', documentDate: '2026-03-03' });
    await filed('Statement', { mimeType: 'text/csv' });
    await filed('Old receipt', { vendor: 'Bakery', documentDate: '2025-01-01' });
    expect((await browse({ hasReceipt: true })).titles).toEqual(['Receipt', 'Old receipt']);
    expect((await browse({ kinds: ['IMAGE', 'TEXT'] })).titles).toEqual(['Scan', 'Statement']);
    expect((await browse({ dateFrom: '2026-03-01', dateTo: '2026-03-31' })).titles).toEqual(['Scan', 'Receipt']);
    expect((await browse({ kinds: [] })).titles).toEqual([]);
  });

  it('pages, and says when there is another page', async () => {
    for (let day = 1; day <= 5; day++) {
      await filed(`Day ${day}`, { documentDate: `2026-03-0${day}` });
    }
    expect(await browse({}, { first: 2, offset: 0 })).toEqual({ titles: ['Day 5', 'Day 4'], hasMore: true });
    expect(await browse({}, { first: 2, offset: 2 })).toEqual({ titles: ['Day 3', 'Day 2'], hasMore: true });
    expect(await browse({}, { first: 2, offset: 4 })).toEqual({ titles: ['Day 1'], hasMore: false });
  });

  it("leaves out someone else's documents and an upload still waiting for its bytes", async () => {
    const bob = await createUser(db, 'bob@example.com');
    await filed('Mine');
    await filed('Waiting', { status: 'pending_upload' });
    await db.insert(documents).values({
      userId: bob,
      title: 'Theirs',
      originalFilename: 'theirs.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      originalKey: `originals/${bob}/theirs`,
      status: 'ready',
    });
    expect((await browse({})).titles).toEqual(['Mine']);
  });

  it('is a query, with the folder filter and its subfolders, and refuses too large a page', async () => {
    const [taxes] = await db.insert(folders).values({ userId: alice, name: 'Taxes' }).returning();
    const [year] = await db.insert(folders).values({ userId: alice, name: '2026', parentId: taxes?.id }).returning();
    await filed('Top', { folderId: taxes?.id, documentDate: '2026-02-01' });
    await filed('Inside', { folderId: year?.id, documentDate: '2026-01-01' });
    await filed('Outside');

    const client = createClient(db, alice);
    const query = `query ($filter: DocumentSearchFilter, $first: Int, $offset: Int) {
      browseDocuments(filter: $filter, first: $first, offset: $offset) { hasMore documents { title } }
    }`;
    const data = await client.expectOk(query, { filter: { folderId: taxes?.id }, first: 1 });
    expect(data.browseDocuments).toEqual({ hasMore: true, documents: [{ title: 'Top' }] });
    const next = await client.expectOk(query, { filter: { folderId: taxes?.id }, first: 1, offset: 1 });
    expect(next.browseDocuments).toEqual({ hasMore: false, documents: [{ title: 'Inside' }] });

    expect((await client.expectError(query, { first: 10_000 })).code).toBe(ErrorCode.BadUserInput);
    expect((await client.expectError(query, { offset: -1 })).code).toBe(ErrorCode.BadUserInput);
  });
});

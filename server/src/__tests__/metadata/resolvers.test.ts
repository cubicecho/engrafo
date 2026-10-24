import { documents, folders } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { createClient, createFakeStorage, createTestDb, createUser, type TestDb } from '../helpers.ts';

const SET_DATE = `mutation ($id: UUID!, $date: String) {
  setDocumentDate(id: $id, date: $date) { id documentDate documentDateSource }
}`;
const SET_RECEIPT = `mutation ($id: UUID!, $input: DocumentReceiptInput!) {
  setDocumentReceipt(id: $id, input: $input) { id vendor total currency receiptSource }
}`;
const EXPORT = `query ($from: String, $to: String, $folderId: UUID) {
  receiptsCsv(from: $from, to: $to, folderId: $folderId)
}`;
const RESET = `mutation ($id: UUID!, $fields: [DocumentMetadataField!]!) {
  resetDocumentMetadata(id: $id, fields: $fields) {
    id documentDate documentDateSource vendor total currency receiptSource
  }
}`;
const RECEIPT_TEXT = 'Joe’s Diner\n12.03.2025\nBurger 9,50\nTotal EUR 12,50';
const CSV_HEADER = 'date,vendor,total,currency,title,folder\r\n';

describe('document metadata', () => {
  let db: TestDb;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    db = await createTestDb();
    alice = await createUser(db, 'alice@example.com');
    bob = await createUser(db, 'bob@example.com');
  });

  let keys = 0;
  async function insertDocument(userId: string, values: Partial<typeof documents.$inferInsert> = {}) {
    keys += 1;
    const [doc] = await db
      .insert(documents)
      .values({
        userId,
        title: `Receipt ${keys}`,
        originalFilename: 'receipt.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        originalKey: `originals/${userId}/${keys}`,
        status: 'ready',
        ...values,
      })
      .returning();
    return doc;
  }

  async function folder(userId: string, name: string, parentId: string | null = null) {
    const [row] = await db.insert(folders).values({ userId, name, parentId }).returning();
    return row;
  }

  describe('setDocumentDate', () => {
    it('sets the date and marks it the user’s', async () => {
      const doc = await insertDocument(alice, { documentDate: '2020-01-01', documentDateSource: 'extracted' });
      const data = await createClient(db, alice).expectOk(SET_DATE, { id: doc.id, date: '2025-03-12' });
      expect(data.setDocumentDate).toEqual({ id: doc.id, documentDate: '2025-03-12', documentDateSource: 'user' });
    });

    it('clears it, and the clearing is the user’s too', async () => {
      const doc = await insertDocument(alice, { documentDate: '2020-01-01', documentDateSource: 'extracted' });
      await createClient(db, alice).expectOk(SET_DATE, { id: doc.id, date: null });
      const [row] = await db.select().from(documents).where(eq(documents.id, doc.id));
      expect(row).toMatchObject({ documentDate: null, documentDateSource: 'user' });
    });

    it('refuses a day that does not exist', async () => {
      const doc = await insertDocument(alice);
      const error = await createClient(db, alice).expectError(SET_DATE, { id: doc.id, date: '2025-02-30' });
      expect(error.code).toBe(ErrorCode.BadUserInput);
    });

    it("answers NOT_FOUND for someone else's document, and for an id that is not one", async () => {
      const doc = await insertDocument(bob);
      const theirs = await createClient(db, alice).expectError(SET_DATE, { id: doc.id, date: '2025-03-12' });
      expect(theirs.code).toBe(ErrorCode.NotFound);
      const [row] = await db.select().from(documents).where(eq(documents.id, doc.id));
      expect(row?.documentDate).toBeNull();
    });

    it('needs a session', async () => {
      const doc = await insertDocument(alice);
      const error = await createClient(db, null).expectError(SET_DATE, { id: doc.id, date: '2025-03-12' });
      expect(error.code).toBe(ErrorCode.Unauthenticated);
    });
  });

  describe('setDocumentReceipt', () => {
    it('sets all three fields, normalised, and marks the receipt the user’s', async () => {
      const doc = await insertDocument(alice, { vendor: 'REWE', total: '9.99', receiptSource: 'extracted' });
      const data = await createClient(db, alice).expectOk(SET_RECEIPT, {
        id: doc.id,
        input: { vendor: '  Joe’s Diner ', total: '12,50', currency: 'eur' },
      });
      expect(data.setDocumentReceipt).toEqual({
        id: doc.id,
        vendor: 'Joe’s Diner',
        total: '12.50',
        currency: 'EUR',
        receiptSource: 'user',
      });
    });

    it('keeps the total exact, as written', async () => {
      const doc = await insertDocument(alice);
      const data = await createClient(db, alice).expectOk(SET_RECEIPT, {
        id: doc.id,
        input: { total: '123456789012.125', currency: 'BHD' },
      });
      expect(data.setDocumentReceipt.total).toBe('123456789012.125');
    });

    it('clears a field left empty', async () => {
      const doc = await insertDocument(alice, { vendor: 'REWE', total: '9.99', currency: 'EUR' });
      const data = await createClient(db, alice).expectOk(SET_RECEIPT, {
        id: doc.id,
        input: { vendor: '', total: null },
      });
      expect(data.setDocumentReceipt).toMatchObject({
        vendor: null,
        total: null,
        currency: null,
        receiptSource: 'user',
      });
    });

    it.each([
      ['a negative total', { total: '-5.00' }],
      ['a total that is not a number', { total: '12.50 EUR' }],
      ['a currency that is not a code', { currency: 'euro' }],
    ])('refuses %s', async (_label, input) => {
      const doc = await insertDocument(alice);
      const error = await createClient(db, alice).expectError(SET_RECEIPT, { id: doc.id, input });
      expect(error.code).toBe(ErrorCode.BadUserInput);
    });

    it("answers NOT_FOUND for someone else's document", async () => {
      const doc = await insertDocument(bob, { vendor: 'Bob’s' });
      const error = await createClient(db, alice).expectError(SET_RECEIPT, { id: doc.id, input: { vendor: 'Mine' } });
      expect(error.code).toBe(ErrorCode.NotFound);
      const [row] = await db.select().from(documents).where(eq(documents.id, doc.id));
      expect(row?.vendor).toBe('Bob’s');
    });
  });

  describe('resetDocumentMetadata', () => {
    const storage = createFakeStorage();

    /** A document whose stored text is `content`, with the edits given. */
    async function withText(userId: string, content: string, values: Partial<typeof documents.$inferInsert> = {}) {
      const doc = await insertDocument(userId, values);
      const contentKey = `text/${userId}/${doc.id}`;
      await storage.text.put(contentKey, content, 'text/plain');
      await db.update(documents).set({ contentKey }).where(eq(documents.id, doc.id));
      return doc;
    }

    it('reads the date from the stored text again, and leaves the edited receipt alone', async () => {
      const doc = await withText(alice, RECEIPT_TEXT, {
        documentDate: null,
        documentDateSource: 'user',
        vendor: 'Mine',
        receiptSource: 'user',
      });
      const data = await createClient(db, alice, { storage }).expectOk(RESET, { id: doc.id, fields: ['DATE'] });
      expect(data.resetDocumentMetadata).toEqual({
        id: doc.id,
        documentDate: '2025-03-12',
        documentDateSource: 'extracted',
        vendor: 'Mine',
        total: null,
        currency: null,
        receiptSource: 'user',
      });
    });

    it('reads the receipt again, and leaves the edited date alone', async () => {
      const doc = await withText(alice, RECEIPT_TEXT, {
        documentDate: '2020-01-01',
        documentDateSource: 'user',
        vendor: 'Mine',
        total: '1.00',
        receiptSource: 'user',
      });
      const data = await createClient(db, alice, { storage }).expectOk(RESET, { id: doc.id, fields: ['RECEIPT'] });
      expect(data.resetDocumentMetadata).toMatchObject({
        documentDate: '2020-01-01',
        documentDateSource: 'user',
        vendor: 'Joe’s Diner',
        total: '12.50',
        currency: 'EUR',
        receiptSource: 'extracted',
      });
    });

    it('resets both at once', async () => {
      const doc = await withText(alice, RECEIPT_TEXT, { documentDateSource: 'user', receiptSource: 'user' });
      const data = await createClient(db, alice, { storage }).expectOk(RESET, {
        id: doc.id,
        fields: ['DATE', 'RECEIPT'],
      });
      expect(data.resetDocumentMetadata).toMatchObject({ documentDateSource: 'extracted', receiptSource: 'extracted' });
    });

    it('does not read again an extracted field it was not asked about', async () => {
      // The stored text has since changed under the receipt; only the date was asked for.
      const doc = await withText(alice, RECEIPT_TEXT, {
        documentDateSource: 'user',
        vendor: 'REWE',
        total: '9.99',
        receiptSource: 'extracted',
      });
      const data = await createClient(db, alice, { storage }).expectOk(RESET, { id: doc.id, fields: ['DATE'] });
      expect(data.resetDocumentMetadata).toMatchObject({ vendor: 'REWE', total: '9.99', receiptSource: 'extracted' });
    });

    it('clears the fields of a document with no text, and hands them back', async () => {
      const doc = await insertDocument(alice, {
        documentDate: '2020-01-01',
        documentDateSource: 'user',
        vendor: 'Mine',
        receiptSource: 'user',
      });
      const data = await createClient(db, alice, { storage }).expectOk(RESET, {
        id: doc.id,
        fields: ['DATE', 'RECEIPT'],
      });
      // No source either: nothing was read, and the next run is free to read one.
      expect(data.resetDocumentMetadata).toMatchObject({
        documentDate: null,
        documentDateSource: null,
        vendor: null,
        receiptSource: null,
      });
    });

    it('refuses a document that is being processed, and leaves it alone', async () => {
      const doc = await withText(alice, RECEIPT_TEXT, { status: 'processing', documentDateSource: 'user' });
      const error = await createClient(db, alice, { storage }).expectError(RESET, { id: doc.id, fields: ['DATE'] });
      expect(error.code).toBe(ErrorCode.Conflict);
      const [row] = await db.select().from(documents).where(eq(documents.id, doc.id));
      expect(row?.documentDateSource).toBe('user');
    });

    it('refuses an empty list of fields', async () => {
      const doc = await withText(alice, RECEIPT_TEXT);
      const error = await createClient(db, alice, { storage }).expectError(RESET, { id: doc.id, fields: [] });
      expect(error.code).toBe(ErrorCode.BadUserInput);
    });

    it("answers NOT_FOUND for someone else's document", async () => {
      const doc = await withText(bob, RECEIPT_TEXT, { documentDateSource: 'user', receiptSource: 'user' });
      const error = await createClient(db, alice, { storage }).expectError(RESET, {
        id: doc.id,
        fields: ['DATE', 'RECEIPT'],
      });
      expect(error.code).toBe(ErrorCode.NotFound);
      const [row] = await db.select().from(documents).where(eq(documents.id, doc.id));
      expect(row).toMatchObject({ documentDateSource: 'user', receiptSource: 'user' });
    });
  });

  describe('receiptsCsv', () => {
    it("exports the caller's receipts by date, with a header and the folder's path", async () => {
      const taxes = await folder(alice, 'Taxes');
      const year = await folder(alice, '2026', taxes.id);
      await insertDocument(alice, {
        title: 'Lunch',
        documentDate: '2026-03-02',
        vendor: 'Joe’s Diner',
        total: '20.86',
        currency: 'USD',
        folderId: year.id,
      });
      await insertDocument(alice, { title: 'Bread', documentDate: '2026-01-05', total: '3.50' });
      await insertDocument(alice, { title: 'Letter', documentDate: '2026-02-01' });
      await insertDocument(alice, { title: 'Undated', total: '1.00' });
      await insertDocument(bob, { title: 'Bob’s', vendor: 'Secret', total: '1.00' });

      const data = await createClient(db, alice).expectOk(EXPORT);
      expect(data.receiptsCsv).toBe(
        `${CSV_HEADER}2026-01-05,,3.50,,Bread,\r\n2026-03-02,Joe’s Diner,20.86,USD,Lunch,Taxes/2026\r\n,,1.00,,Undated,\r\n`,
      );
    });

    it('keeps a date range, inclusive, and a folder with everything inside it', async () => {
      const taxes = await folder(alice, 'Taxes');
      const year = await folder(alice, '2026', taxes.id);
      await insertDocument(alice, { title: 'In', documentDate: '2026-03-31', total: '1.00', folderId: year.id });
      await insertDocument(alice, { title: 'Early', documentDate: '2026-02-28', total: '1.00', folderId: year.id });
      await insertDocument(alice, { title: 'Undated', total: '1.00', folderId: year.id });
      await insertDocument(alice, { title: 'Elsewhere', documentDate: '2026-03-15', total: '1.00' });

      const ranged = await createClient(db, alice).expectOk(EXPORT, {
        from: '2026-03-01',
        to: '2026-03-31',
        folderId: taxes.id,
      });
      expect(ranged.receiptsCsv).toBe(`${CSV_HEADER}2026-03-31,,1.00,,In,Taxes/2026\r\n`);

      // Someone else's folder finds nothing, the same answer an empty folder gives.
      const theirs = await createClient(db, bob).expectOk(EXPORT, { folderId: taxes.id });
      expect(theirs.receiptsCsv).toBe(CSV_HEADER);
    });

    it('quotes what needs quoting and defuses a formula', async () => {
      await insertDocument(alice, { title: 'Dinner, with "friends"', vendor: '=HYPERLINK("x")', total: '5.00' });
      const data = await createClient(db, alice).expectOk(EXPORT);
      expect(data.receiptsCsv.split('\r\n')[1]).toBe(`,"'=HYPERLINK(""x"")",5.00,,"Dinner, with ""friends""",`);
    });

    it('refuses a range that ends before it starts, and a date that does not exist', async () => {
      const client = createClient(db, alice);
      const backwards = await client.expectError(EXPORT, { from: '2026-03-02', to: '2026-03-01' });
      expect(backwards.code).toBe(ErrorCode.BadUserInput);
      const missing = await client.expectError(EXPORT, { from: '2026-02-30' });
      expect(missing.code).toBe(ErrorCode.BadUserInput);
    });

    it('needs a session', async () => {
      expect((await createClient(db, null).expectError(EXPORT)).code).toBe(ErrorCode.Unauthenticated);
    });
  });
});

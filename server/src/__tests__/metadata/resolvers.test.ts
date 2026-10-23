import { documents } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { createClient, createTestDb, createUser, type TestDb } from '../helpers.ts';

const SET_DATE = `mutation ($id: UUID!, $date: String) {
  setDocumentDate(id: $id, date: $date) { id documentDate documentDateSource }
}`;

describe('document metadata writes', () => {
  let db: TestDb;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    db = await createTestDb();
    alice = await createUser(db, 'alice@example.com');
    bob = await createUser(db, 'bob@example.com');
  });

  async function insertDocument(userId: string, values: Partial<typeof documents.$inferInsert> = {}) {
    const [doc] = await db
      .insert(documents)
      .values({
        userId,
        title: 'Receipt',
        originalFilename: 'receipt.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        originalKey: `originals/${userId}/receipt`,
        status: 'ready',
        ...values,
      })
      .returning();
    return doc;
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
});

import { randomUUID } from 'node:crypto';
import { DocumentStatus, documents } from '@cubicecho/engrafo-db/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCUMENT_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { createClient, createTestDb, createUser, type TestDb } from '../helpers.ts';

const DUPLICATES = `
  query ($ids: [UUID!]!) {
    documentDuplicates(ids: $ids) {
      document { id title }
      checked
      duplicates { id title folderId }
    }
  }
`;

const SUM_A = 'a'.repeat(64);
const SUM_B = 'b'.repeat(64);

describe('documentDuplicates', () => {
  let db: TestDb;
  let userId: string;
  let otherId: string;

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
    otherId = await createUser(db, 'other@example.com');
  });

  /** A processed document straight through Drizzle: the pipeline is not what is under test. */
  async function seed(owner: string, title: string, checksumSha256: string | null, createdAt?: Date) {
    const id = randomUUID();
    await db.insert(documents).values({
      id,
      userId: owner,
      title,
      originalFilename: `${title}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 5,
      originalKey: `originals/${owner}/${id}`,
      checksumSha256,
      status: checksumSha256 ? DocumentStatus.Ready : DocumentStatus.Uploaded,
      ...(createdAt ? { createdAt } : {}),
    });
    return id;
  }

  const ask = (ids: string[], as = userId) => createClient(db, as).expectOk(DUPLICATES, { ids });

  it('names the caller’s other documents with the same checksum, oldest first, and not itself', async () => {
    const first = await seed(userId, 'scan', SUM_A, new Date('2026-01-01'));
    const second = await seed(userId, 'scan (2)', SUM_A, new Date('2026-02-01'));
    const third = await seed(userId, 'scan (3)', SUM_A, new Date('2026-03-01'));
    await seed(userId, 'unrelated', SUM_B);

    const data = await ask([third]);
    expect(data.documentDuplicates).toEqual([
      {
        document: { id: third, title: 'scan (3)' },
        checked: true,
        duplicates: [
          { id: first, title: 'scan', folderId: null },
          { id: second, title: 'scan (2)', folderId: null },
        ],
      },
    ]);
  });

  it('says a unique document has none', async () => {
    const id = await seed(userId, 'only', SUM_A);
    const data = await ask([id]);
    expect(data.documentDuplicates).toEqual([{ document: { id, title: 'only' }, checked: true, duplicates: [] }]);
  });

  it('never matches across users', async () => {
    const mine = await seed(userId, 'mine', SUM_A);
    await seed(otherId, 'theirs', SUM_A);
    const data = await ask([mine]);
    expect(data.documentDuplicates[0].duplicates).toEqual([]);
  });

  it('leaves out ids that are someone else’s or do not exist, rather than refusing', async () => {
    const mine = await seed(userId, 'mine', SUM_A);
    const theirs = await seed(otherId, 'theirs', SUM_A);
    const data = await ask([theirs, randomUUID(), mine]);
    expect(data.documentDuplicates.map((entry: { document: { id: string } }) => entry.document.id)).toEqual([mine]);
  });

  it('is not checked until inspect has written a checksum', async () => {
    await seed(userId, 'scan', SUM_A);
    const pending = await seed(userId, 'scan (2)', null);
    const data = await ask([pending]);
    expect(data.documentDuplicates).toEqual([
      { document: { id: pending, title: 'scan (2)' }, checked: false, duplicates: [] },
    ]);
  });

  it('answers every id in one call, in the order asked', async () => {
    const a1 = await seed(userId, 'a1', SUM_A);
    const a2 = await seed(userId, 'a2', SUM_A);
    const b1 = await seed(userId, 'b1', SUM_B);
    const data = await ask([b1, a2, a1]);
    expect(
      data.documentDuplicates.map((entry: { document: { title: string }; duplicates: { title: string }[] }) => [
        entry.document.title,
        entry.duplicates.map((doc) => doc.title),
      ]),
    ).toEqual([
      ['b1', []],
      ['a2', ['a1']],
      ['a1', ['a2']],
    ]);
  });

  it('caps how many ids one call may ask about', async () => {
    const ids = Array.from({ length: DOCUMENT_DEFAULTS.duplicateLookupMaxIds + 1 }, () => randomUUID());
    const error = await createClient(db, userId).expectError(DUPLICATES, { ids });
    expect(error.code).toBe(ErrorCode.BadUserInput);
  });

  it('needs a session', async () => {
    const error = await createClient(db, null).expectError(DUPLICATES, { ids: [] });
    expect(error.code).toBe(ErrorCode.Unauthenticated);
  });
});

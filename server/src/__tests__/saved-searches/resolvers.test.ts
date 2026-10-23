import { savedSearches } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { createClient, createTestDb, createUser, type TestDb } from '../helpers.ts';

const SAVE = `
  mutation ($name: String!, $query: String, $filter: DocumentSearchFilter) {
    saveSearch(name: $name, query: $query, filter: $filter) { id name query filters }
  }
`;
const RENAME = 'mutation ($id: UUID!, $name: String!) { renameSavedSearch(id: $id, name: $name) { id name } }';
const DELETE = 'mutation ($id: UUID!) { deleteSavedSearch(id: $id) }';
const LIST = '{ savedSearches(orderBy: { name: { direction: asc, priority: 1 } }) { name query filters } }';

const FOLDER = '00000000-0000-4000-8000-0000000000f0';

describe('saved searches', () => {
  let db: TestDb;
  let alice: string;
  let bob: string;

  let people = 0;

  // One Postgres for the file and two new people per test, so no test sees another's rows.
  beforeAll(async () => {
    db = await createTestDb();
  });
  beforeEach(async () => {
    people += 1;
    alice = await createUser(db, `alice${people}@example.com`);
    bob = await createUser(db, `bob${people}@example.com`);
  });
  const rowsOf = (userId: string) => db.select().from(savedSearches).where(eq(savedSearches.userId, userId));

  const as = (userId: string) => createClient(db, userId);

  it('saves the text and only the filters that narrow something', async () => {
    const data = await as(alice).expectOk(SAVE, {
      name: ' Receipts 2026 ',
      query: '  coffee ',
      filter: { folderId: FOLDER, kinds: ['PDF'], dateFrom: '2026-01-01', dateTo: null, hasReceipt: true },
    });
    expect(data.saveSearch).toMatchObject({
      name: 'Receipts 2026',
      query: 'coffee',
      filters: { folderId: FOLDER, kinds: ['PDF'], dateFrom: '2026-01-01', hasReceipt: true },
    });
    expect(data.saveSearch.filters).not.toHaveProperty('dateTo');
    expect(data.saveSearch.filters).not.toHaveProperty('includeSubfolders');
  });

  it('saves filters with no text, and refuses a search with neither', async () => {
    const data = await as(alice).expectOk(SAVE, { name: 'Ebooks', filter: { kinds: ['EBOOK'] } });
    expect(data.saveSearch).toMatchObject({ query: null, filters: { kinds: ['EBOOK'] } });
    const empty = await as(alice).expectError(SAVE, { name: 'Nothing', query: '   ', filter: {} });
    expect(empty.code).toBe(ErrorCode.BadUserInput);
    expect((await as(alice).expectError(SAVE, { name: '  ', query: 'x' })).code).toBe(ErrorCode.BadUserInput);
  });

  it('keeps names unique per user, ignoring case', async () => {
    await as(alice).expectOk(SAVE, { name: 'Warranties', query: 'warranty' });
    expect((await as(alice).expectError(SAVE, { name: 'warranties', query: 'x' })).code).toBe(ErrorCode.Conflict);
    // Someone else's names are theirs.
    await as(bob).expectOk(SAVE, { name: 'Warranties', query: 'warranty' });
  });

  it("lists only the caller's", async () => {
    await as(alice).expectOk(SAVE, { name: 'B', query: 'b' });
    await as(alice).expectOk(SAVE, { name: 'A', query: 'a' });
    await as(bob).expectOk(SAVE, { name: 'Bob', query: 'c' });
    const data = await as(alice).expectOk(LIST);
    expect(data.savedSearches.map((row: { name: string }) => row.name)).toEqual(['A', 'B']);
  });

  it('renames, refusing a name another of the caller’s has, and allowing a change of case', async () => {
    const { saveSearch: first } = await as(alice).expectOk(SAVE, { name: 'Unfiled', query: 'a' });
    await as(alice).expectOk(SAVE, { name: 'Taxes', query: 'b' });
    expect((await as(alice).expectOk(RENAME, { id: first.id, name: 'UNFILED' })).renameSavedSearch.name).toBe(
      'UNFILED',
    );
    expect((await as(alice).expectError(RENAME, { id: first.id, name: 'taxes' })).code).toBe(ErrorCode.Conflict);
  });

  it("answers NOT_FOUND for someone else's", async () => {
    const { saveSearch } = await as(alice).expectOk(SAVE, { name: 'Mine', query: 'a' });
    expect((await as(bob).expectError(RENAME, { id: saveSearch.id, name: 'Theirs' })).code).toBe(ErrorCode.NotFound);
    expect((await as(bob).expectError(DELETE, { id: saveSearch.id })).code).toBe(ErrorCode.NotFound);
    expect(await rowsOf(alice)).toHaveLength(1);
  });

  it('deletes', async () => {
    const { saveSearch } = await as(alice).expectOk(SAVE, { name: 'Gone', query: 'a' });
    expect((await as(alice).expectOk(DELETE, { id: saveSearch.id })).deleteSavedSearch).toBe(true);
    expect(await rowsOf(alice)).toEqual([]);
  });

  it('needs a session', async () => {
    const error = await createClient(db, null).expectError(SAVE, { name: 'X', query: 'x' });
    expect(error.code).toBe(ErrorCode.Unauthenticated);
  });
});

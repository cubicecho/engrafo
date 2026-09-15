import * as dbSchema from '@cubicecho/engrafo-db/schema';
import { getTableName, is, Table } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { contextValues, scope } from '../tenancy.ts';
import { createClient, createTestDb, createUser, type TestDb } from './helpers.ts';

// The test that fails when someone adds a table and forgets tenancy. `scope` is
// what confines every generated read to the caller; a table missing from it is
// readable across tenants, and nothing else in the codebase would say so.

const tableKeys = Object.entries(dbSchema)
  .filter(([, value]) => is(value, Table))
  .map(([key]) => key);

describe('tenancy configuration', () => {
  it('finds the tables', () => {
    expect(tableKeys.sort()).toEqual(['documents', 'processingSteps', 'users']);
  });

  it.each(tableKeys)('scopes %s to the caller', (key) => {
    expect(scope[key]).toBeTypeOf('function');
  });

  it.each(tableKeys.filter((key) => key !== 'users'))('stamps userId on %s rather than accepting it', (key) => {
    expect(contextValues[key]?.userId).toBeTypeOf('function');
  });

  it('names every table by its Drizzle key, not its SQL name', () => {
    for (const [key, value] of Object.entries(dbSchema)) {
      if (!is(value, Table)) continue;
      expect(Object.keys(scope)).toContain(key);
      expect(getTableName(value)).toBeTypeOf('string');
    }
  });
});

describe('tenancy at runtime', () => {
  let db: TestDb;
  let alice: string;
  let bob: string;
  let aliceDoc: string;

  beforeAll(async () => {
    db = await createTestDb();
    alice = await createUser(db, 'alice@example.com');
    bob = await createUser(db, 'bob@example.com');
    const [doc] = await db
      .insert(dbSchema.documents)
      .values({
        userId: alice,
        title: 'Lease',
        originalFilename: 'lease.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        originalKey: `originals/${alice}/x`,
        status: 'ready',
      })
      .returning();
    aliceDoc = doc.id;
    await db
      .insert(dbSchema.processingSteps)
      .values({ userId: alice, documentId: aliceDoc, step: 'inspect', position: 0, status: 'succeeded' });
  });

  it('lists only the caller’s documents', async () => {
    const asAlice = await createClient(db, alice).expectOk('{ documents { id processingSteps { step } } }');
    expect(asAlice.documents).toEqual([{ id: aliceDoc, processingSteps: [{ step: 'inspect' }] }]);

    const asBob = await createClient(db, bob).expectOk('{ documents { id } processingSteps { id } }');
    expect(asBob.documents).toEqual([]);
    expect(asBob.processingSteps).toEqual([]);
  });

  it('cannot be widened by a client filter', async () => {
    const data = await createClient(db, bob).expectOk(
      'query ($id: UUID!) { documents(where: { id: { eq: $id } }) { id } }',
      {
        id: aliceDoc,
      },
    );
    expect(data.documents).toEqual([]);
  });

  it('hides another user’s document from hand-written resolvers as NOT_FOUND', async () => {
    const bobClient = createClient(db, bob);
    const url = await bobClient.expectError('query ($id: UUID!) { documentFileUrl(id: $id) }', { id: aliceDoc });
    expect(url.code).toBe('NOT_FOUND');
    const rename = await bobClient.expectError('mutation ($id: UUID!) { renameDocument(id: $id, title: "x") { id } }', {
      id: aliceDoc,
    });
    expect(rename.code).toBe('NOT_FOUND');
    const del = await bobClient.expectError('mutation ($id: UUID!) { deleteDocument(id: $id) }', { id: aliceDoc });
    expect(del.code).toBe('NOT_FOUND');
  });

  it('refuses the unauthenticated', async () => {
    const error = await createClient(db, null).expectError('{ documents { id } }');
    expect(error.code).toBe('UNAUTHENTICATED');
  });

  it('generates no writes for any table', async () => {
    const result = await createClient(db, alice).run('mutation { createDocument(values: {}) { id } }');
    expect(result.errors?.[0]?.message).toMatch(/Cannot query field "createDocument"/);
  });
});

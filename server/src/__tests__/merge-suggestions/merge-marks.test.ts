import { writeFile } from 'node:fs/promises';
import { MergeSuggestionStatus, mergeSuggestions } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeDocuments } from '../../merge/merge.ts';
import { memberKey, rescoreUser } from '../../merge-suggestions/store.ts';
import { createPipelineEvents } from '../../pipeline/events.ts';
import {
  bornDigitalPdf,
  createFakeStorage,
  createTestDb,
  createUser,
  type FakeStorage,
  type TestDb,
} from '../helpers.ts';
import { at, invoicePages } from './fixtures.ts';
import { seedCandidates } from './seed.ts';

// pikepdf runs only in the Docker test stage, and what is under test here is the bookkeeping
// after it: the merged file is any PDF.
vi.mock('../../merge/pdf.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../merge/pdf.ts')>()),
  mergeToPdf: async (_parts: unknown, output: string) => writeFile(output, bornDigitalPdf('merged')),
}));

const NOW = new Date(at(0).getTime() + 24 * 60 * 60 * 1000);

describe('merging a suggested set', () => {
  let db: TestDb;
  let storage: FakeStorage;
  let userId: string;
  let ids: string[];

  beforeEach(async () => {
    db = await createTestDb();
    storage = createFakeStorage();
    userId = await createUser(db, 'owner@example.com');
    const seeded = await seedCandidates(db, storage, userId, invoicePages);
    ids = invoicePages.map((page) => seeded.ids.get(page.id) ?? '');
    for (const id of ids) {
      await storage.files.put(`originals/${userId}/${id}`, bornDigitalPdf('page'), 'application/pdf');
    }
    await rescoreUser({ db, storage }, userId, { now: NOW });
  });

  const merge = (members: string[]) =>
    mergeDocuments({ db, storage, events: createPipelineEvents() }, userId, { ids: members, title: 'Invoice' });
  const statusOf = async () =>
    (
      await db
        .select()
        .from(mergeSuggestions)
        .where(eq(mergeSuggestions.memberKey, memberKey(ids)))
    )[0]?.status;

  it('marks the suggestion merged, whatever order the pages were merged in', async () => {
    await merge([ids[1], ids[0], ids[2]]);
    expect(await statusOf()).toBe(MergeSuggestionStatus.Merged);
  });

  it('leaves it open when a different set is merged', async () => {
    await merge(ids.slice(0, 2));
    expect(await statusOf()).toBe(MergeSuggestionStatus.Open);
  });
});

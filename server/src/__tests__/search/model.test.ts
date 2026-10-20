import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { documents } from '@cubicecho/engrafo-db/schema';
import { describe, expect, it } from 'vitest';
import { modelsDir } from '../../core/config.ts';
import { SEARCH_DEFAULTS } from '../../core/defaults.ts';
import { createLocalEmbedder, EMBEDDING_REPO } from '../../search/embedder.ts';
import { indexDocument } from '../../search/index-document.ts';
import { searchDocuments } from '../../search/search.ts';
import { createFakeStorage, createTestDb, createUser } from '../helpers.ts';

// The real model, where it is installed: the Docker test stage bakes it into
// MODELS_DIR, as the runtime image does. Elsewhere this reports as skipped
// rather than downloading 50 MB in the middle of a test run.
const dir = modelsDir();
const isModelInstalled = dir !== null && existsSync(join(dir, EMBEDDING_REPO));

describe.skipIf(isModelInstalled === false)('search with the real model', () => {
  it('finds a document asked about in other words, and nothing for an unrelated question', {
    timeout: 120_000,
  }, async () => {
    const db = await createTestDb();
    const storage = createFakeStorage();
    const embedder = createLocalEmbedder({ modelsDir: dir, batchSize: SEARCH_DEFAULTS.embedBatchSize });
    const userId = await createUser(db, 'owner@example.com');

    const add = async (title: string, text: string) => {
      storage.text.objects.set(title, { body: Buffer.from(text), contentType: 'text/plain' });
      const [doc] = await db
        .insert(documents)
        .values({
          userId,
          title,
          originalFilename: `${title}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1,
          originalKey: title,
          contentKey: title,
          status: 'ready',
        })
        .returning();
      await indexDocument({ db, storage, embedder }, doc);
      return doc;
    };
    const lease = await add('Apartment', 'The tenant shall pay the landlord 950 EUR on the first day of each month.');
    await add('Car insurance', 'Your policy covers collision damage and theft of the vehicle.');

    const hits = await searchDocuments({ db, embedder }, userId, 'how much is my rent', 5);
    expect(hits[0]?.document.id).toBe(lease.id);
    expect(await searchDocuments({ db, embedder }, userId, 'a recipe for carbonara', 5)).toEqual([]);
  });
});

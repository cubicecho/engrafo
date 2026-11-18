import { randomUUID } from 'node:crypto';
import { DocumentStatus, documentChunks, documents, EMBEDDING_DIMENSIONS, folders } from '@cubicecho/engrafo-db/schema';
import type { MergeCandidate } from '../../merge-suggestions/features.ts';
import { textKey } from '../../storage/s3.ts';
import type { FakeStorage, TestDb } from '../helpers.ts';

// The scorer's fixtures as rows: each candidate becomes a ready document of the user's, its text an
// object in the fake text bucket, and its mean embedding the mean of two passages, so the average
// pgvector takes is the one the fixture names.

/** Where a seeded fixture landed. */
export interface Seeded {
  /** The document id each fixture id became. */
  ids: Map<string, string>;
  /** The folder id each fixture folder became. */
  folders: Map<string, string>;
}

/**
 * Pads a fixture's short vector to the stored dimensions, which leaves every cosine as it was.
 *
 * @param vector - A few dimensions.
 * @returns `EMBEDDING_DIMENSIONS` numbers.
 */
export function padded(vector: readonly number[]): number[] {
  return [...vector, ...new Array<number>(EMBEDDING_DIMENSIONS - vector.length).fill(0)];
}

/**
 * Files fixtures as one user's documents.
 *
 * @param db - The test database.
 * @param storage - The fake buckets; each text goes in `text`.
 * @param userId - The owner.
 * @param fixtures - The candidates, whose ids and folder ids are names, not UUIDs.
 * @param seeded - What an earlier call made, so a later page lands in the same folders.
 * @returns The fixture ids and folders mapped to the rows made for them.
 */
export async function seedCandidates(
  db: TestDb,
  storage: FakeStorage,
  userId: string,
  fixtures: readonly MergeCandidate[],
  seeded: Seeded = { ids: new Map(), folders: new Map() },
): Promise<Seeded> {
  for (const fixture of fixtures) {
    const folderId = fixture.folderId === null ? null : await folderFor(db, userId, fixture.folderId, seeded);
    const id = randomUUID();
    const text = fixture.textHead;
    const key = text ? textKey(userId, id) : null;
    if (key) {
      await storage.text.put(key, text, 'text/plain; charset=utf-8');
    }
    await db.insert(documents).values({
      id,
      userId,
      folderId,
      title: fixture.id,
      originalFilename: fixture.originalFilename,
      mimeType: fixture.mimeType,
      sizeBytes: 1,
      originalKey: `originals/${userId}/${id}`,
      contentKey: key,
      contentBytes: key ? Buffer.byteLength(text) : null,
      documentDate: fixture.documentDate,
      vendor: fixture.vendor,
      status: DocumentStatus.Ready,
      createdAt: fixture.createdAt,
    });
    if (fixture.meanEmbedding) {
      await insertPassages(db, userId, id, fixture.meanEmbedding);
    }
    seeded.ids.set(fixture.id, id);
  }
  return seeded;
}

/**
 * Two passages either side of `mean`, so their average is it.
 *
 * @param db - The test database.
 * @param userId - The owner the passages carry.
 * @param documentId - The document they are of.
 * @param mean - The fixture's vector.
 * @param firstPosition - Where they start, after any passages the document already has.
 */
export async function insertPassages(
  db: TestDb,
  userId: string,
  documentId: string,
  mean: readonly number[],
  firstPosition = 0,
) {
  const scaled = (factor: number) => padded(mean.map((value) => value * factor));
  await db.insert(documentChunks).values(
    [scaled(0.5), scaled(1.5)].map((embedding, index) => ({
      userId,
      documentId,
      position: firstPosition + index,
      content: `passage ${firstPosition + index}`,
      embedding,
      embeddingModel: 'fake',
    })),
  );
}

async function folderFor(db: TestDb, userId: string, name: string, seeded: Seeded): Promise<string> {
  const existing = seeded.folders.get(name);
  if (existing) {
    return existing;
  }
  const [row] = await db.insert(folders).values({ userId, name }).returning();
  seeded.folders.set(name, row.id);
  return row.id;
}

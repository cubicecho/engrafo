import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus, documentChunks, documents } from '@cubicecho/engrafo-db/schema';
import { and, eq, gte, inArray, type SQL, sql } from 'drizzle-orm';
import { MERGE_SUGGESTION_DEFAULTS, type MergeSuggestionSettings } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { createLimiter } from '../core/limiter.ts';
import { MS_PER_SECOND, SECONDS_PER_DAY } from '../core/wire.ts';
import { readTextEnd, readTextStart } from '../pipeline/content.ts';
import { DocumentKind, filterConditions } from '../search/filters.ts';
import type { Storage, StorageSet } from '../storage/s3.ts';
import { notTrashed } from '../trash/trash.ts';
import type { MergeCandidate } from './features.ts';

// What the scorer is handed: every recent document a merge could take, with only the ends of its
// text and the mean of its passages' embeddings. Read per user, and the passages filtered by that
// user here: `document_chunks` is outside the GraphQL schema, so tenancy.ts never scopes it.

/** What loading candidates reads: the documents' rows and passages, and the text bucket. */
export interface CandidateDeps {
  db: DB;
  storage: StorageSet;
}

/** When a rescore is, and what it is scored by. */
export interface RescoreOptions {
  /** The moment the lookback counts back from. */
  now?: Date;
  settings?: MergeSuggestionSettings;
}

/**
 * The documents a suggestion may hold: filed, finished, a PDF or an image (the merge's own rule),
 * and filed since `since`.
 *
 * @param since - The start of the lookback.
 * @returns The condition on `documents`, for a `where`.
 */
export function isMergeableRecent(since: Date): SQL | undefined {
  return and(
    eq(documents.status, DocumentStatus.Ready),
    notTrashed(),
    filterConditions({ kinds: [DocumentKind.Pdf, DocumentKind.Image] }),
    gte(documents.createdAt, since),
  );
}

/**
 * The start of the lookback.
 *
 * @param now - The moment it counts back from.
 * @param settings - `lookbackDays`.
 * @returns `lookbackDays` before `now`.
 */
export function lookbackStart(now: Date, settings: MergeSuggestionSettings): Date {
  return new Date(now.getTime() - settings.lookbackDays * SECONDS_PER_DAY * MS_PER_SECOND);
}

/**
 * Loads one user's recent mergeable documents as the scorer reads them.
 *
 * @param deps - The database and the buckets.
 * @param userId - Whose documents. Nobody else's rows or passages are read.
 * @param options - The moment the lookback counts from, and the settings.
 * @returns One candidate per document, in no particular order. A document with no text has empty
 *   ends, and one with no passages a null embedding.
 */
export async function loadCandidates(
  deps: CandidateDeps,
  userId: string,
  { now = new Date(), settings = MERGE_SUGGESTION_DEFAULTS }: RescoreOptions = {},
): Promise<MergeCandidate[]> {
  const rows = await deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), isMergeableRecent(lookbackStart(now, settings))));
  if (rows.length === 0) {
    return [];
  }

  const embeddings = await meanEmbeddings(
    deps.db,
    userId,
    rows.map((row) => row.id),
  );
  const limit = createLimiter(settings.textReadConcurrency);
  return Promise.all(
    rows.map((row) =>
      limit(async () => ({
        id: row.id,
        createdAt: row.createdAt,
        originalFilename: row.originalFilename,
        folderId: row.folderId,
        mimeType: row.mimeType,
        documentDate: row.documentDate,
        vendor: row.vendor,
        ...(await textEnds(deps.storage.text, row, settings.aiContextChars)),
        meanEmbedding: embeddings.get(row.id) ?? null,
      })),
    ),
  );
}

/** Each document's mean passage embedding, computed by pgvector. A document with no passages is left out. */
async function meanEmbeddings(db: DB, userId: string, documentIds: string[]): Promise<Map<string, number[]>> {
  const means = await db
    .select({
      documentId: documentChunks.documentId,
      mean: sql<number[]>`avg(${documentChunks.embedding})`.mapWith(documentChunks.embedding),
    })
    .from(documentChunks)
    .where(and(eq(documentChunks.userId, userId), inArray(documentChunks.documentId, documentIds)))
    .groupBy(documentChunks.documentId);
  return new Map(means.map(({ documentId, mean }) => [documentId, mean]));
}

/** The first and last `chars` of a document's text. A text that cannot be read counts as none. */
async function textEnds(
  bucket: Storage,
  doc: Document,
  chars: number,
): Promise<Pick<MergeCandidate, 'textHead' | 'textTail'>> {
  // Empty text stores no object, so there is a key exactly when there are bytes.
  if (!doc.contentKey || !doc.contentBytes) {
    return { textHead: '', textTail: '' };
  }
  try {
    const [textHead, textTail] = await Promise.all([
      readTextStart(bucket, doc.contentKey, chars),
      readTextEnd(bucket, doc.contentKey, doc.contentBytes, chars),
    ]);
    return { textHead, textTail };
  } catch (error) {
    console.warn(`[merge-suggestions] Could not read the text of ${doc.id}: ${errorMessage(error)}`);
    return { textHead: '', textTail: '' };
  }
}

import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus, documentChunks, documents } from '@cubicecho/engrafo-db/schema';
import { and, cosineDistance, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { SEARCH_DEFAULTS } from '../core/defaults.ts';
import { notTrashed } from '../trash/trash.ts';
import type { Embedder } from './embedder.ts';
import { filterConditions, matchesNothing, type SearchFilter } from './filters.ts';

// Hybrid retrieval, as mcp-ragdown does it: the embedding finds a passage that
// answers in other words, the words find an exact name or number an embedding
// blurs, and reciprocal rank fusion merges the two lists. Then passages become
// documents: a document ranks by its best passage, and a title match adds a vote.
//
// Every query here filters by the caller's id itself. The index is not in the
// GraphQL schema, so tenancy.ts's row scope never sees it. A filter is ANDed
// into all three reads the same way, so the fusion only ever sees allowed rows.

/** One document a search found. */
export interface SearchHit {
  document: Document;
  /** Part of the best passage, around the first word of the query it contains. */
  snippet: string;
  /** The fused score. Only its order means anything: it is not comparable across queries. */
  score: number;
}

/** The query as Postgres's words, read the way a search box is: quotes, `or`, `-word`. */
const toTsQuery = (query: string) => sql`websearch_to_tsquery('simple', ${query})`;
/** Exactly the expression the GIN index in db/src/models/document-chunks.ts is built on, or it is not used. */
const CHUNK_WORDS = sql`to_tsvector('simple', ${documentChunks.content})`;

interface Candidate {
  documentId: string;
  content: string;
}

/**
 * Searches one user's documents.
 *
 * @param deps - The database and the embedder the index was built with.
 * @param userId - Whose documents. Nobody else's are read.
 * @param query - What was typed.
 * @param limit - How many documents to return at most.
 * @param [options.minCosine] - The floor for a passage found by meaning alone.
 * @param [options.folderIds] - Only documents filed in these folders, as MCP reads only the shared
 *   ones. Left out, every document of the user's; empty, none.
 * @param [options.filter] - What the caller narrowed the search to: a folder, kinds, a date range,
 *   receipts. ANDed with `folderIds` when both are given.
 * @returns The documents, best first.
 */
export async function searchDocuments(
  { db, embedder }: { db: DB; embedder: Embedder },
  userId: string,
  query: string,
  limit: number,
  {
    minCosine = SEARCH_DEFAULTS.minCosine,
    folderIds,
    filter = {},
  }: { minCosine?: number; folderIds?: readonly string[]; filter?: SearchFilter } = {},
): Promise<SearchHit[]> {
  if (folderIds?.length === 0 || matchesNothing(filter)) {
    return [];
  }
  const narrowed = and(folderIds ? inArray(documents.folderId, [...folderIds]) : undefined, filterConditions(filter));
  // A trashed document keeps its passages, so a restore is searchable at once; every read here
  // leaves them out instead.
  const ownDocument = and(eq(documents.userId, userId), notTrashed(), narrowed);
  // Passages carry their user and nothing else of their document's, so the trash and any narrowing
  // are a subquery on documents, inside each read rather than over the fused list.
  const ownChunk = and(
    eq(documentChunks.userId, userId),
    inArray(documentChunks.documentId, db.select({ id: documents.id }).from(documents).where(ownDocument)),
  );
  const pool = SEARCH_DEFAULTS.candidatePoolSize;
  const [queryVector = []] = await embedder.embed([query]);
  const tsQuery = toTsQuery(query);

  const distance = cosineDistance(documentChunks.embedding, queryVector);
  const rank = sql<number>`ts_rank_cd(${CHUNK_WORDS}, ${tsQuery})`;
  const chunkColumns = {
    id: documentChunks.id,
    documentId: documentChunks.documentId,
    content: documentChunks.content,
  };

  const [byMeaning, byWords, byTitle] = await Promise.all([
    // An exact scan of this user's passages, with no vector index: a personal
    // archive is thousands of passages, which Postgres scans in milliseconds,
    // and an approximate index filtered by user can drop the very rows asked for.
    db
      .select({ ...chunkColumns, distance })
      .from(documentChunks)
      .where(ownChunk)
      .orderBy(distance)
      .limit(pool),
    db
      .select({ ...chunkColumns, rank })
      .from(documentChunks)
      .where(and(ownChunk, sql`${CHUNK_WORDS} @@ ${tsQuery}`))
      .orderBy(desc(rank))
      .limit(pool),
    db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          ownDocument,
          ne(documents.status, DocumentStatus.PendingUpload),
          sql`to_tsvector('simple', ${documents.title}) @@ ${tsQuery}`,
        ),
      )
      .limit(pool),
  ]);

  const vote = (rankIndex: number) => 1 / (SEARCH_DEFAULTS.rrfK + rankIndex + 1);

  // Passage scores, fused.
  const passages = new Map<string, Candidate & { score: number }>();
  const add = (row: { id: string } & Candidate, rankIndex: number) => {
    const entry = passages.get(row.id) ?? { documentId: row.documentId, content: row.content, score: 0 };
    entry.score += vote(rankIndex);
    passages.set(row.id, entry);
  };
  byMeaning.filter((row) => 1 - Number(row.distance) >= minCosine).forEach(add);
  byWords.forEach(add);

  // Documents, by their best passage.
  const found = new Map<string, { score: number; best: Candidate | null }>();
  for (const passage of passages.values()) {
    const current = found.get(passage.documentId);
    if (current === undefined || passage.score > current.score) {
      found.set(passage.documentId, { score: passage.score, best: passage });
    }
  }
  byTitle.forEach(({ id }, rankIndex) => {
    const current = found.get(id) ?? { score: 0, best: null };
    current.score += vote(rankIndex);
    found.set(id, current);
  });

  const ranked = [...found.entries()].sort(([, a], [, b]) => b.score - a.score).slice(0, limit);
  if (ranked.length === 0) {
    return [];
  }

  const ids = ranked.map(([id]) => id);
  const rows = await db
    .select()
    .from(documents)
    .where(and(ownDocument, inArray(documents.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));

  return ranked.flatMap(([id, { score, best }]) => {
    const document = byId.get(id);
    // Deleted or trashed between the two reads.
    if (document === undefined) {
      return [];
    }
    return [{ document, score, snippet: best ? snippet(best.content, query, SEARCH_DEFAULTS.snippetChars) : '' }];
  });
}

/**
 * The part of a passage worth showing: a window around the first word of the query it contains,
 * or its start when it shares none (a match by meaning).
 *
 * @param content - The passage.
 * @param query - What was typed.
 * @param size - The window, in characters.
 */
export function snippet(content: string, query: string, size: number): string {
  if (content.length <= size) {
    return content;
  }
  const lower = content.toLowerCase();
  const words = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 1);
  const hits = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0);
  const at = hits.length > 0 ? Math.min(...hits) : 0;

  // Some of the window before the word, so it reads in context.
  let start = Math.max(0, Math.min(at - Math.floor(size * SEARCH_DEFAULTS.snippetLeadFraction), content.length - size));
  let end = Math.min(content.length, start + size);
  // Whole words at both ends.
  if (start > 0) {
    const space = content.indexOf(' ', start);
    start = space >= 0 && space < at ? space + 1 : start;
  }
  if (end < content.length) {
    const space = content.lastIndexOf(' ', end);
    end = space > start ? space : end;
  }
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

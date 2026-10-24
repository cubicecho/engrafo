import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus, documents } from '@cubicecho/engrafo-db/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { notTrashed } from '../trash/trash.ts';
import { filterConditions, matchesNothing, type SearchFilter } from './filters.ts';

/** One page of a filtered list. */
export interface BrowsePage {
  documents: Document[];
  /** Whether there are more after this page. */
  hasMore: boolean;
}

/**
 * The caller's documents that match a filter, with no search to rank them: the newest by the date
 * on the document first, then the undated ones, each by when they were uploaded.
 *
 * @param deps - The database.
 * @param deps.db - The database.
 * @param userId - Whose documents. Every read here filters by it, as the search does.
 * @param filter - What the list is narrowed to. An empty filter is the whole archive, a page at a time.
 * @param page - Which page.
 * @param page.first - How many documents to return.
 * @param page.offset - How many to skip.
 * @returns The page, and whether another follows it.
 *
 * @remarks
 * Offset paging rather than a cursor: the order runs over a nullable date, which a cursor has to
 * spell out case by case, and a personal archive is thousands of rows. A document still waiting
 * for its bytes is not a document yet (`pending_upload`), so it is left out.
 */
export async function browseDocuments(
  { db }: { db: DB },
  userId: string,
  filter: SearchFilter,
  { first, offset }: { first: number; offset: number },
): Promise<BrowsePage> {
  if (matchesNothing(filter)) {
    return { documents: [], hasMore: false };
  }
  const rows = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        ne(documents.status, DocumentStatus.PendingUpload),
        notTrashed(),
        filterConditions(filter),
      ),
    )
    .orderBy(sql`${documents.documentDate} desc nulls last`, desc(documents.createdAt), desc(documents.id))
    // One more than asked for says whether there is another page, without a count.
    .limit(first + 1)
    .offset(offset);
  return { documents: rows.slice(0, first), hasMore: rows.length > first };
}

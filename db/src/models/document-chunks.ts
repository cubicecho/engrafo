import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex, uuid, vector } from 'drizzle-orm/pg-core';

import { documents } from './documents.ts';
import { users } from './users.ts';

/** The size of every stored embedding. The model in server/src/search/embedder.ts must produce it. */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * The search index: a document's extracted text in passages, each with its embedding and its
 * words, written by the pipeline's `index` step and read only by search.
 *
 * This is the one table that holds document text. `documents` still does not, so a list of a
 * thousand stays as cheap as it was; the passages are here because a search has to rank them in
 * SQL, which an object in the text bucket cannot be.
 */
export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // Where the passage falls in the document, from 0.
    position: integer('position').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    // Which model made `embedding`. Vectors from two models are not comparable,
    // so a change of model is visible here rather than as quietly worse results.
    embeddingModel: text('embedding_model').notNull(),
  },
  (t) => [
    uniqueIndex('uq_document_chunks_document_position').on(t.documentId, t.position),
    index('idx_document_chunks_user_id').on(t.userId),
    // The words, as an expression index rather than a column: drizzle-graphql
    // types every table, excluded or not, and has no type for tsvector. A query
    // must use exactly this expression (SEARCH_WORDS in server/src/search) to
    // use the index. `simple`, not `english`: OCR runs in whatever languages the
    // instance installs, and English stemming over German text finds nothing.
    // The keyword side is for exact words; meaning is the embedding's job.
    index('idx_document_chunks_words').using('gin', sql`to_tsvector('simple', ${t.content})`),
  ],
);

/** A passage as read. */
export type DocumentChunk = typeof documentChunks.$inferSelect;
/** A passage as inserted. */
export type NewDocumentChunk = typeof documentChunks.$inferInsert;

/**
 * The Drizzle keys of the search index's tables, which the GraphQL schema leaves out: an
 * embedding is 384 numbers nobody should page through, and search has its own query.
 */
export const SEARCH_TABLES = ['documentChunks'] as const;

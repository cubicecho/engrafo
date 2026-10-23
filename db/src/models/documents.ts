import { sql } from 'drizzle-orm';
import { bigint, boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { folders } from './folders.ts';
import { TOP_LEVEL } from './top-level.ts';
import { users } from './users.ts';

/**
 * Where a document is in its life. `pending_upload` exists because the bytes go
 * straight from the browser to S3: the row is written first so the object key is
 * the server's to choose, and it only becomes `uploaded` once the server has seen
 * the object land.
 */
export const documentStatus = pgEnum('document_status', [
  'pending_upload',
  'uploaded',
  'processing',
  'ready',
  'failed',
]);

/**
 * One row per uploaded file: its metadata and the keys of its objects. The bytes and the
 * extracted text live in the buckets, never here.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Null is the top level. Restrict, not cascade: a folder's documents have
    // objects in the buckets, so the server deletes them before the folder.
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'restrict' }),
    // Also the document's name in its folder, so it is unique there and has no `/`.
    title: text('title').notNull(),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    // Null until the inspect step has read the stored object: the browser's
    // claim about the file is not a checksum.
    checksumSha256: text('checksum_sha256'),
    originalKey: text('original_key').notNull(),
    // The OCR'd PDF/A, when the ocr step produced one. The original is never
    // replaced, same as Paperless.
    archiveKey: text('archive_key'),
    // Extracted text is an object in the text bucket, not a column: it can run
    // to megabytes and nothing here ever queries it. Postgres keeps the pointer
    // and the size so a list stays cheap.
    contentKey: text('content_key'),
    contentBytes: bigint('content_bytes', { mode: 'number' }),
    ocrRequested: boolean('ocr_requested').notNull().default(true),
    status: documentStatus('status').notNull().default('pending_upload'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('idx_documents_user_id').on(t.userId),
    index('idx_documents_user_created').on(t.userId, t.createdAt),
    index('idx_documents_user_checksum').on(t.userId, t.checksumSha256),
    index('idx_documents_status').on(t.status),
    index('idx_documents_folder_id').on(t.folderId),
    uniqueIndex('uq_documents_user_folder_title').on(
      t.userId,
      sql`coalesce(${t.folderId}, ${TOP_LEVEL})`,
      sql`lower(${t.title})`,
    ),
  ],
);

/** A document row as read. */
export type Document = typeof documents.$inferSelect;
/** A document row as inserted. */
export type NewDocument = typeof documents.$inferInsert;
/** One value of the `documentStatus` enum. */
export type DocumentStatus = (typeof documentStatus.enumValues)[number];
/** The statuses by name, for code that sets or compares one. */
export const DocumentStatus = {
  PendingUpload: 'pending_upload',
  Uploaded: 'uploaded',
  Processing: 'processing',
  Ready: 'ready',
  Failed: 'failed',
} as const satisfies Record<string, DocumentStatus>;

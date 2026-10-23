import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
 * Who filled in a field read from a document's content. `extracted` is the pipeline's guess and
 * is replaced whenever the document is processed again; `user` is an edit, which no run touches.
 * Null while the field has never been filled in either way.
 */
export const fieldSource = pgEnum('field_source', ['extracted', 'user']);

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
    // The date on the document (a receipt's, a letter's), not when it was uploaded: a calendar
    // day with no time and no zone, which is what is printed on paper.
    documentDate: date('document_date', { mode: 'string' }),
    documentDateSource: fieldSource('document_date_source'),
    // A receipt's fields. The date is `documentDate`, not a column of its own.
    vendor: text('vendor'),
    // Exact decimal, as written: `numeric` with no fixed scale, so 12.50 EUR, 1200 JPY and
    // 1.250 BHD all keep their digits. Not minor units, which need the currency to mean
    // anything, and a receipt often names an amount and no currency. Never a float.
    total: numeric('total'),
    // ISO 4217, upper case.
    currency: text('currency'),
    // One source for all three: an edit to any of them is the user taking the receipt over.
    receiptSource: fieldSource('receipt_source'),
    ocrRequested: boolean('ocr_requested').notNull().default(true),
    // Someone asked, from the document's page, for the vision model to read it. With the model on
    // "auto" every document OCR runs on is read anyway; this is what reaches the rest.
    visionRequested: boolean('vision_requested').notNull().default(false),
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
    index('idx_documents_user_document_date').on(t.userId, t.documentDate),
    check('ck_documents_currency', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('ck_documents_total', sql`${t.total} >= 0`),
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
/** One value of the `fieldSource` enum. */
export type FieldSource = (typeof fieldSource.enumValues)[number];
/** The sources by name. */
export const FieldSource = {
  Extracted: 'extracted',
  User: 'user',
} as const satisfies Record<string, FieldSource>;
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

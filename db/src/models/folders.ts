import { sql } from 'drizzle-orm';
import { type AnyPgColumn, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { TOP_LEVEL } from './top-level.ts';
import { users } from './users.ts';

/**
 * A folder a user files documents into. Folders nest through `parentId`; a null
 * parent is the top level, where documents with no folder sit too.
 *
 * A row rather than a path string so a folder can be empty, and so a rename or a
 * move is one row and not a rewrite of every path below it.
 */
export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Deleting a folder takes its subfolders with it. The documents in them are
    // the server's to delete first, because their objects are in the buckets.
    parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Case-insensitive, as names are compared everywhere else. A folder and a
    // document beside it are kept apart by the server, which no index can do.
    uniqueIndex('uq_folders_user_parent_name').on(
      t.userId,
      sql`coalesce(${t.parentId}, ${TOP_LEVEL})`,
      sql`lower(${t.name})`,
    ),
    index('idx_folders_user_id').on(t.userId),
    index('idx_folders_parent_id').on(t.parentId),
  ],
);

/** A folder row as read. */
export type Folder = typeof folders.$inferSelect;
/** A folder row as inserted. */
export type NewFolder = typeof folders.$inferInsert;

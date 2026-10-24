import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.ts';

/**
 * What a saved search narrows to: `DocumentSearchFilter` as the server checked it, with the fields
 * that narrow nothing left out. Stored as JSON rather than a column per filter so a filter added
 * later needs no migration, and so an old row reads as "that filter was not set".
 */
export interface SavedSearchFilters {
  folderId?: string;
  includeSubfolders?: boolean;
  kinds?: string[];
  dateFrom?: string;
  dateTo?: string;
  hasReceipt?: boolean;
}

/**
 * A search a user named, to come back to from the sidebar: the text typed and the filters set,
 * which the documents page reads from its query string. The query is null for filters alone.
 */
export const savedSearches = pgTable(
  'saved_searches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    query: text('query'),
    filters: jsonb('filters').$type<SavedSearchFilters>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Case-insensitive, as folder names are: two rows a person cannot tell apart in the sidebar.
    uniqueIndex('uq_saved_searches_user_name').on(t.userId, sql`lower(${t.name})`),
    index('idx_saved_searches_user_id').on(t.userId),
  ],
);

/** A saved search as read. */
export type SavedSearch = typeof savedSearches.$inferSelect;

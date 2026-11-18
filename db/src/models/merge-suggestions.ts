import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users.ts';

/**
 * What became of a suggested merge. `open` is waiting on the person; `dismissed` and `merged` are
 * what they decided, kept with the scores they had so the weights can be tuned against them, and
 * so the same set is never proposed again.
 */
export const mergeSuggestionStatus = pgEnum('merge_suggestion_status', ['open', 'dismissed', 'merged']);

/**
 * One signal behind a suggestion, as the scorer wrote it: which signal, the words shown for it,
 * and the points it added (negative when it counted against). Mirrors the server's `MergeReason`.
 */
export interface StoredMergeReason {
  signal: string;
  text: string;
  points: number;
}

/**
 * Documents that look like one scan filed as several, written by the server's merge suggester and
 * never by a client. The members are an array rather than a join table because a suggestion is
 * one decision about one set, replaced whole when it is scored again.
 */
export const mergeSuggestions = pgTable(
  'merge_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // In page order: the order a merge would put them in.
    documentIds: uuid('document_ids').array().notNull(),
    // The members' ids sorted and joined, so one set has one identity whatever its page order.
    // This is what a dismissal is remembered by.
    memberKey: text('member_key').notNull(),
    // Between 0 and 1: the weakest step in the page order.
    confidence: doublePrecision('confidence').notNull(),
    reasons: jsonb('reasons').$type<StoredMergeReason[]>().notNull().default([]),
    // Whether the model has confirmed or doubted it, once one is set up.
    aiChecked: boolean('ai_checked').notNull().default(false),
    status: mergeSuggestionStatus('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uq_merge_suggestions_user_member_key').on(t.userId, t.memberKey),
    index('idx_merge_suggestions_user_status').on(t.userId, t.status),
  ],
);

/** A suggestion as read. */
export type MergeSuggestion = typeof mergeSuggestions.$inferSelect;
/** A suggestion as inserted. */
export type NewMergeSuggestion = typeof mergeSuggestions.$inferInsert;
/** One value of the `mergeSuggestionStatus` enum. */
export type MergeSuggestionStatus = (typeof mergeSuggestionStatus.enumValues)[number];
/** The statuses by name, for code that sets or compares one. */
export const MergeSuggestionStatus = {
  Open: 'open',
  Dismissed: 'dismissed',
  Merged: 'merged',
} as const satisfies Record<string, MergeSuggestionStatus>;

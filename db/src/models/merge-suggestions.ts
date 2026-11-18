import {
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
 * One adjacent step of a suggestion, in page order, and the rules' confidence (0–1) that `toId`
 * continues `fromId`. Mirrors the server's `MergeLink`.
 */
export interface StoredMergeLink {
  fromId: string;
  toId: string;
  heuristic: number;
}

/**
 * What the model answered about one adjacent step: whether `toId` continues `fromId`, how sure it
 * was (0–1), and why. Kept for as long as the two stay adjacent in that order, whatever the
 * rules' score does meanwhile. Mirrors the server's `MergeVerdict`.
 */
export interface StoredMergeVerdict {
  fromId: string;
  toId: string;
  continues: boolean;
  confidence: number;
  reason: string;
  /** The model that answered. */
  model: string;
  /** When it answered, as an ISO timestamp. */
  checkedAt: string;
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
    // The rules' side and the model's are kept apart, so a rescore replaces one and keeps the
    // other. `links` is each adjacent step's rules score, in page order; `ai_verdicts` the model's
    // answers about those steps.
    links: jsonb('links').$type<StoredMergeLink[]>().notNull().default([]),
    aiVerdicts: jsonb('ai_verdicts').$type<StoredMergeVerdict[]>().notNull().default([]),
    // Derived from the two, and written with them, so a read needs no arithmetic: the weakest step
    // by the rules alone, and the weakest once each verdict has moved its step (0–1 both).
    heuristicConfidence: doublePrecision('heuristic_confidence').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    // The rules' reasons and one per verdict, the strongest for first.
    reasons: jsonb('reasons').$type<StoredMergeReason[]>().notNull().default([]),
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

/**
 * The Drizzle keys of the suggestion tables, which the GraphQL schema leaves out: a row is shown
 * only while its members are all still there to merge and the model has not ruled it out, which a
 * generated read cannot check, so the server's own reads are the only door.
 */
export const SUGGESTION_TABLES = ['mergeSuggestions'] as const;

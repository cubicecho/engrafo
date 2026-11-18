import type { DB } from '@cubicecho/engrafo-db';
import {
  DocumentStatus,
  documents,
  type MergeSuggestion,
  MergeSuggestionStatus,
  mergeSuggestions,
} from '@cubicecho/engrafo-db/schema';
import { and, desc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { MERGE_SUGGESTION_DEFAULTS } from '../core/defaults.ts';
import type { Tx } from '../folders/names.ts';
import { notTrashed } from '../trash/trash.ts';
import { type CandidateDeps, loadCandidates, type RescoreOptions } from './candidates.ts';
import { groupCandidates, type MergeGroup } from './group.ts';

// Suggestions are stored, not computed on read: the badge and the document page need an answer
// that is quick and stays put between reads. A rescore replaces the open ones with what the scorer
// sees now, and leaves what the person decided alone: a set they dismissed or merged is never
// proposed again, and its row keeps the scores it had, as the record to tune the weights against.

/**
 * One identity per member set, whatever its page order.
 *
 * @param documentIds - The members, in any order.
 * @returns The ids sorted and joined: what `member_key` holds.
 */
export function memberKey(documentIds: readonly string[]): string {
  return [...documentIds].sort().join(',');
}

/** What reconciling needs to know of a stored suggestion. */
export type StoredSuggestion = Pick<MergeSuggestion, 'id' | 'memberKey' | 'status'>;

/** What a rescore writes. */
export interface Reconciliation {
  /** Sets never suggested before, inserted as open. */
  inserts: MergeGroup[];
  /** Open suggestions found again, given their new order and scores. */
  updates: Array<{ id: string; group: MergeGroup }>;
  /** Open suggestions not found this time: a member was trashed, changed or has aged out. */
  deletes: string[];
}

/**
 * Decides what a rescore writes. Pure: the stored rows and the new groups are all it reads.
 *
 * @param stored - The user's open suggestions, and any of theirs whose set was proposed again.
 * @param groups - What the scorer proposes now.
 * @returns The inserts, updates and deletes. A dismissed or merged set is in none of them.
 */
export function reconcile(stored: readonly StoredSuggestion[], groups: readonly MergeGroup[]): Reconciliation {
  const storedByKey = new Map(stored.map((row) => [row.memberKey, row]));
  const proposedKeys = new Set(groups.map((group) => memberKey(group.documentIds)));
  const inserts: MergeGroup[] = [];
  const updates: Reconciliation['updates'] = [];
  for (const group of groups) {
    const existing = storedByKey.get(memberKey(group.documentIds));
    if (existing === undefined) {
      inserts.push(group);
      continue;
    }
    const isOpen = existing.status === MergeSuggestionStatus.Open;
    if (isOpen) {
      updates.push({ id: existing.id, group });
    }
  }
  const deletes = stored
    .filter((row) => row.status === MergeSuggestionStatus.Open && proposedKeys.has(row.memberKey) === false)
    .map((row) => row.id);
  return { inserts, updates, deletes };
}

/** What a rescore changed, as counts, for the log. */
export interface RescoreResult {
  inserted: number;
  updated: number;
  deleted: number;
}

/**
 * Scores one user's recent documents and brings their stored suggestions in line, in one
 * transaction.
 *
 * @param deps - The database and the buckets.
 * @param userId - Whose documents and suggestions.
 * @param options - The moment the lookback counts from, and the settings.
 * @returns How many suggestions were inserted, updated and deleted.
 */
export async function rescoreUser(
  deps: CandidateDeps,
  userId: string,
  options: RescoreOptions = {},
): Promise<RescoreResult> {
  const settings = options.settings ?? MERGE_SUGGESTION_DEFAULTS;
  const groups = groupCandidates(await loadCandidates(deps, userId, options), settings);
  const keys = groups.map((group) => memberKey(group.documentIds));

  return deps.db.transaction(async (tx) => {
    const stored = await tx
      .select({ id: mergeSuggestions.id, memberKey: mergeSuggestions.memberKey, status: mergeSuggestions.status })
      .from(mergeSuggestions)
      .where(
        and(
          eq(mergeSuggestions.userId, userId),
          or(
            eq(mergeSuggestions.status, MergeSuggestionStatus.Open),
            keys.length > 0 ? inArray(mergeSuggestions.memberKey, keys) : undefined,
          ),
        ),
      );
    const plan = reconcile(stored, groups);
    await writePlan(tx, userId, plan);
    return { inserted: plan.inserts.length, updated: plan.updates.length, deleted: plan.deletes.length };
  });
}

/**
 * Writes a reconciliation. Every write is limited to open rows, or skips a set that is already
 * stored, so a merge or a dismissal that lands meanwhile is never undone.
 */
async function writePlan(tx: Tx, userId: string, plan: Reconciliation): Promise<void> {
  const ownOpen = and(eq(mergeSuggestions.userId, userId), eq(mergeSuggestions.status, MergeSuggestionStatus.Open));
  if (plan.inserts.length > 0) {
    await tx
      .insert(mergeSuggestions)
      .values(plan.inserts.map((group) => ({ userId, ...scoredFields(group) })))
      .onConflictDoNothing();
  }
  for (const { id, group } of plan.updates) {
    await tx
      .update(mergeSuggestions)
      .set(scoredFields(group))
      .where(and(eq(mergeSuggestions.id, id), ownOpen));
  }
  if (plan.deletes.length > 0) {
    await tx.delete(mergeSuggestions).where(and(inArray(mergeSuggestions.id, plan.deletes), ownOpen));
  }
}

/** The columns a group fills in, whether it is new or found again. */
function scoredFields(group: MergeGroup) {
  return {
    documentIds: group.documentIds,
    memberKey: memberKey(group.documentIds),
    confidence: group.confidence,
    reasons: group.reasons,
  };
}

/**
 * Whether every member of a suggestion is still its owner's, filed and ready. A row can go stale
 * between rescores: a member trashed, purged or sent back through the pipeline.
 *
 * @returns The condition on `merge_suggestions`, for a `where`.
 */
export function membersAreLive(): SQL {
  return sql`(select count(*) from ${documents}
              where ${documents.id} = any(${mergeSuggestions.documentIds})
                and ${documents.userId} = ${mergeSuggestions.userId}
                and ${documents.status} = ${DocumentStatus.Ready}
                and ${notTrashed()}) = cardinality(${mergeSuggestions.documentIds})`;
}

/**
 * The caller's open suggestions whose members are all still there to merge.
 *
 * @param db - The connection.
 * @param userId - The caller.
 * @returns The suggestions, the surest first.
 */
export async function loadOpenSuggestions(db: DB, userId: string): Promise<MergeSuggestion[]> {
  return db
    .select()
    .from(mergeSuggestions)
    .where(
      and(
        eq(mergeSuggestions.userId, userId),
        eq(mergeSuggestions.status, MergeSuggestionStatus.Open),
        membersAreLive(),
      ),
    )
    .orderBy(desc(mergeSuggestions.confidence));
}

/**
 * Records that the caller merged a suggested set, so it is never proposed again.
 *
 * @param db - The connection.
 * @param userId - The caller.
 * @param documentIds - What was merged, in any order. A set nobody suggested changes nothing.
 */
export async function markMerged(db: DB | Tx, userId: string, documentIds: readonly string[]): Promise<void> {
  await db
    .update(mergeSuggestions)
    .set({ status: MergeSuggestionStatus.Merged })
    .where(and(eq(mergeSuggestions.userId, userId), eq(mergeSuggestions.memberKey, memberKey(documentIds))));
}

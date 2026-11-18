import type { DB } from '@cubicecho/engrafo-db';
import {
  DocumentStatus,
  documents,
  type MergeSuggestion,
  MergeSuggestionStatus,
  mergeSuggestions,
} from '@cubicecho/engrafo-db/schema';
import { and, desc, eq, gte, inArray, or, type SQL, sql } from 'drizzle-orm';
import { MERGE_SUGGESTION_DEFAULTS, type MergeSuggestionSettings } from '../core/defaults.ts';
import type { Tx } from '../folders/names.ts';
import { notTrashed } from '../trash/trash.ts';
import { type CandidateDeps, loadCandidates, type RescoreOptions } from './candidates.ts';
import { groupCandidates, type MergeGroup } from './group.ts';
import { addVerdict, combineScores, type MergeVerdict, ruleReasonsOf, verdictsForLinks } from './verdicts.ts';

// Suggestions are stored, not computed on read: the badge and the document page need an answer
// that is quick and stays put between reads. A rescore replaces the open ones with what the scorer
// sees now, and leaves what the person decided alone: a set they dismissed or merged is never
// proposed again, and its row keeps the scores it had, as the record to tune the weights against.
// The model's verdicts outlive a rescore: one is about two pages either side of a break, so it is
// kept for as long as those two are still adjacent, in that order, in an open suggestion.

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
export type StoredSuggestion = Pick<MergeSuggestion, 'id' | 'memberKey' | 'status' | 'aiVerdicts'>;

/** A group as a rescore writes it, with the verdicts that still apply to its steps. */
export interface PlannedSuggestion {
  group: MergeGroup;
  verdicts: MergeVerdict[];
}

/** What a rescore writes. */
export interface Reconciliation {
  /** Sets never suggested before, inserted as open. */
  inserts: PlannedSuggestion[];
  /** Open suggestions found again, given their new order and scores. */
  updates: Array<PlannedSuggestion & { id: string }>;
  /** Open suggestions not found this time: a member was trashed, changed or has aged out. */
  deletes: string[];
}

/**
 * Decides what a rescore writes. Pure: the stored rows and the new groups are all it reads.
 *
 * @param stored - The user's open suggestions, and any of theirs whose set was proposed again.
 * @param groups - What the scorer proposes now.
 * @returns The inserts, updates and deletes. A dismissed or merged set is in none of them. Each
 *   group keeps every open suggestion's verdict whose step is still one of its links.
 *
 * @remarks
 * A verdict follows its two documents, not its row: a set that gained or lost a page is a new
 * row, and takes the verdicts of the steps it still has from the open row it replaces. Open rows
 * all come from one rescore, whose groups share no document, so no step is in two of them.
 */
export function reconcile(stored: readonly StoredSuggestion[], groups: readonly MergeGroup[]): Reconciliation {
  const storedByKey = new Map(stored.map((row) => [row.memberKey, row]));
  const proposedKeys = new Set(groups.map((group) => memberKey(group.documentIds)));
  const open = stored.filter((row) => row.status === MergeSuggestionStatus.Open);
  const openVerdicts = open.flatMap((row) => row.aiVerdicts);
  const inserts: PlannedSuggestion[] = [];
  const updates: Reconciliation['updates'] = [];
  for (const group of groups) {
    const planned = { group, verdicts: verdictsForLinks(group.links, openVerdicts) };
    const existing = storedByKey.get(memberKey(group.documentIds));
    if (existing === undefined) {
      inserts.push(planned);
      continue;
    }
    const isOpen = existing.status === MergeSuggestionStatus.Open;
    if (isOpen) {
      updates.push({ id: existing.id, ...planned });
    }
  }
  const deletes = open.filter((row) => proposedKeys.has(row.memberKey) === false).map((row) => row.id);
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
    // Locked, so a verdict the model check writes meanwhile waits for this, and then finds the row
    // as it now is, rather than being overwritten by verdicts read before it landed.
    const stored = await tx
      .select({
        id: mergeSuggestions.id,
        memberKey: mergeSuggestions.memberKey,
        status: mergeSuggestions.status,
        aiVerdicts: mergeSuggestions.aiVerdicts,
      })
      .from(mergeSuggestions)
      .where(
        and(
          eq(mergeSuggestions.userId, userId),
          or(
            eq(mergeSuggestions.status, MergeSuggestionStatus.Open),
            keys.length > 0 ? inArray(mergeSuggestions.memberKey, keys) : undefined,
          ),
        ),
      )
      .for('update');
    const plan = reconcile(stored, groups);
    await writePlan(tx, userId, plan, settings);
    return { inserted: plan.inserts.length, updated: plan.updates.length, deleted: plan.deletes.length };
  });
}

/**
 * Writes a reconciliation. Every write is limited to open rows, or skips a set that is already
 * stored, so a merge or a dismissal that lands meanwhile is never undone.
 */
async function writePlan(
  tx: Tx,
  userId: string,
  plan: Reconciliation,
  settings: MergeSuggestionSettings,
): Promise<void> {
  const ownOpen = and(eq(mergeSuggestions.userId, userId), eq(mergeSuggestions.status, MergeSuggestionStatus.Open));
  if (plan.inserts.length > 0) {
    await tx
      .insert(mergeSuggestions)
      .values(plan.inserts.map((planned) => ({ userId, ...scoredFields(planned, settings) })))
      .onConflictDoNothing();
  }
  for (const { id, ...planned } of plan.updates) {
    await tx
      .update(mergeSuggestions)
      .set(scoredFields(planned, settings))
      .where(and(eq(mergeSuggestions.id, id), ownOpen));
  }
  if (plan.deletes.length > 0) {
    await tx.delete(mergeSuggestions).where(and(inArray(mergeSuggestions.id, plan.deletes), ownOpen));
  }
}

/** The columns a group fills in, whether it is new or found again. */
function scoredFields({ group, verdicts }: PlannedSuggestion, settings: MergeSuggestionSettings) {
  return {
    documentIds: group.documentIds,
    memberKey: memberKey(group.documentIds),
    links: group.links,
    aiVerdicts: verdicts,
    ...combineScores(
      { documentIds: group.documentIds, links: group.links, ruleReasons: group.reasons, verdicts },
      settings,
    ),
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
 * Whether a suggestion is sure enough to show. The rules never store one below `minConfidence`,
 * so a row under it is one the model said does not continue: kept open, so its verdict is there
 * when the rules find the set again, but not put to the person.
 *
 * @param settings - `minConfidence`.
 * @returns The condition on `merge_suggestions`, for a `where`.
 */
export function isShown(settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS): SQL {
  return gte(mergeSuggestions.confidence, settings.minConfidence);
}

/** Which of the caller's shown suggestions a read wants. */
export interface ShownSuggestionsOptions {
  /** Only those with this document among their members. */
  documentId?: string | undefined;
  /** `minConfidence`. */
  settings?: MergeSuggestionSettings | undefined;
}

/**
 * The rows a person is shown: the caller's, open, every member still there to merge, and not ruled
 * out by the model. Every read for the person goes through it, so none can show what the store
 * hides.
 */
function shownTo(userId: string, { documentId, settings = MERGE_SUGGESTION_DEFAULTS }: ShownSuggestionsOptions) {
  return and(
    eq(mergeSuggestions.userId, userId),
    eq(mergeSuggestions.status, MergeSuggestionStatus.Open),
    documentId === undefined ? undefined : sql`${documentId}::uuid = any(${mergeSuggestions.documentIds})`,
    membersAreLive(),
    isShown(settings),
  );
}

/**
 * The caller's open suggestions whose members are all still there to merge, and that the model
 * has not ruled out.
 *
 * @param db - The connection.
 * @param userId - The caller.
 * @param options - A document they must contain, and `minConfidence`.
 * @returns The suggestions, the surest first, then the newest.
 */
export async function loadOpenSuggestions(
  db: DB,
  userId: string,
  options: ShownSuggestionsOptions = {},
): Promise<MergeSuggestion[]> {
  return db
    .select()
    .from(mergeSuggestions)
    .where(shownTo(userId, options))
    .orderBy(desc(mergeSuggestions.confidence), desc(mergeSuggestions.createdAt), mergeSuggestions.id);
}

/**
 * How many suggestions `loadOpenSuggestions` would return, for the sidebar's badge, without the rows.
 *
 * @param db - The connection.
 * @param userId - The caller.
 * @param settings - `minConfidence`.
 * @returns The count.
 */
export async function countOpenSuggestions(
  db: DB,
  userId: string,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mergeSuggestions)
    .where(shownTo(userId, { settings }));
  return row?.count ?? 0;
}

/** What `dismissSuggestion` did. */
export type Dismissal =
  /** It was open and is dismissed now; the scores it had, for the log. */
  | { status: 'dismissed'; scores: Pick<MergeSuggestion, 'confidence' | 'heuristicConfidence'> }
  /** It was dismissed already. */
  | { status: 'already' }
  /** Not the caller's, merged, or no such row. */
  | { status: 'missing' };

/**
 * Records that the person does not want a suggested set merged, so it is never proposed again.
 *
 * @param db - The connection.
 * @param userId - The caller. Only their rows are touched.
 * @param id - The suggestion, already checked to be a UUID.
 * @returns Whether it was dismissed now, was already, or is not one they can dismiss. A merged set
 *   is the last: what was done with it is decided.
 */
export async function dismissSuggestion(db: DB, userId: string, id: string): Promise<Dismissal> {
  const own = and(eq(mergeSuggestions.id, id), eq(mergeSuggestions.userId, userId));
  const [scores] = await db
    .update(mergeSuggestions)
    .set({ status: MergeSuggestionStatus.Dismissed })
    .where(and(own, eq(mergeSuggestions.status, MergeSuggestionStatus.Open)))
    .returning({ confidence: mergeSuggestions.confidence, heuristicConfidence: mergeSuggestions.heuristicConfidence });
  if (scores) {
    return { status: 'dismissed', scores };
  }
  const [already] = await db
    .select({ id: mergeSuggestions.id })
    .from(mergeSuggestions)
    .where(and(own, eq(mergeSuggestions.status, MergeSuggestionStatus.Dismissed)));
  return already ? { status: 'already' } : { status: 'missing' };
}

/** The suggestion a verdict was asked for, as it was when the question was put. */
export interface AskedSuggestion {
  id: string;
  memberKey: string;
}

/**
 * Stores the model's answer about one step and recomputes the suggestion's confidence, in one
 * transaction holding the row. Written only while the suggestion is still open, still the same
 * set, and still has that step, so a rescore or a dismissal that landed meanwhile wins.
 *
 * @param db - The connection.
 * @param userId - The suggestion's owner.
 * @param asked - Which suggestion, and its `member_key` when the question was put.
 * @param verdict - The answer.
 * @param settings - `aiWeight`.
 * @returns Whether it was written.
 */
export async function recordVerdict(
  db: DB,
  userId: string,
  asked: AskedSuggestion,
  verdict: MergeVerdict,
  settings: MergeSuggestionSettings = MERGE_SUGGESTION_DEFAULTS,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(mergeSuggestions)
      .where(
        and(
          eq(mergeSuggestions.id, asked.id),
          eq(mergeSuggestions.userId, userId),
          eq(mergeSuggestions.status, MergeSuggestionStatus.Open),
          eq(mergeSuggestions.memberKey, asked.memberKey),
        ),
      )
      .for('update');
    if (!row) {
      return false;
    }
    const verdicts = addVerdict(row.links, row.aiVerdicts, verdict);
    if (verdicts === null) {
      return false;
    }
    const sides = {
      documentIds: row.documentIds,
      links: row.links,
      ruleReasons: ruleReasonsOf(row.reasons),
      verdicts,
    };
    await tx
      .update(mergeSuggestions)
      .set({ aiVerdicts: verdicts, ...combineScores(sides, settings) })
      .where(eq(mergeSuggestions.id, row.id));
    return true;
  });
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

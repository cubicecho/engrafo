import type { DB } from '@cubicecho/engrafo-db';
import {
  type Document,
  DocumentStatus,
  documents,
  type ProcessingStep,
  processingSteps,
} from '@cubicecho/engrafo-db/schema';
import { and, asc, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { PROCESSING_DEFAULTS } from '../core/defaults.ts';
import { MS_PER_SECOND, SECONDS_PER_HOUR } from '../core/wire.ts';
import { notTrashed } from '../trash/trash.ts';

// What the pipeline is doing, read from the rows it keeps. There is no queue behind the runner
// (runner.ts), and the rows already say everything this page needs: a document is `uploaded`
// from the moment it is handed to the runner until a slot frees for it, then `processing` until
// its last step, then `ready` or `failed`. So nothing here asks the runner, and the page is as
// right after a restart as before it.

/** The four states the page groups documents by. */
export const ProcessingState = {
  Running: 'RUNNING',
  Queued: 'QUEUED',
  Failed: 'FAILED',
  Finished: 'FINISHED',
} as const;
export type ProcessingState = (typeof ProcessingState)[keyof typeof ProcessingState];

const STATUS_BY_STATE = {
  [ProcessingState.Running]: DocumentStatus.Processing,
  [ProcessingState.Queued]: DocumentStatus.Uploaded,
  [ProcessingState.Failed]: DocumentStatus.Failed,
  [ProcessingState.Finished]: DocumentStatus.Ready,
} as const;

/** One document on the page, with every step row of its run. */
export interface ProcessingEntry {
  document: Document;
  /** In pipeline order. */
  steps: ProcessingStep[];
  /** When its last step ended: the run's end for a finished or failed one. */
  finishedAt: Date | null;
}

/** How many documents are in each state. */
export type ProcessingCounts = Record<'running' | 'queued' | 'failed' | 'finished', number>;

/** The latest step end of each document, for "finished lately" and its order. */
const lastFinished = () =>
  sql<
    Date | string | null
  >`(select max(${processingSteps.finishedAt}) from ${processingSteps} where ${processingSteps.documentId} = ${documents.id})`;

/**
 * The conditions a state's documents meet: the caller's, not in the trash, in that status, and
 * for "finished", done within the window.
 */
function stateConditions(userId: string, state: ProcessingState, now: Date): SQL | undefined {
  return and(
    eq(documents.userId, userId),
    notTrashed(),
    eq(documents.status, STATUS_BY_STATE[state]),
    // A bare Date has no column type to bind by here, so it goes over as text and is cast.
    state === ProcessingState.Finished
      ? sql`${lastFinished()} >= ${finishedSince(now).toISOString()}::timestamptz`
      : undefined,
  );
}

/** The start of the "finished" window. */
function finishedSince(now: Date): Date {
  return new Date(now.getTime() - PROCESSING_DEFAULTS.finishedWithinHours * SECONDS_PER_HOUR * MS_PER_SECOND);
}

/**
 * How many of the caller's documents are in each state.
 *
 * @param db - The connection.
 * @param userId - The caller.
 * @param now - The clock, for the "finished" window.
 */
export async function processingCounts(db: DB, userId: string, now: Date): Promise<ProcessingCounts> {
  const byStatus = await db
    .select({ status: documents.status, n: count() })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        notTrashed(),
        inArray(documents.status, [DocumentStatus.Processing, DocumentStatus.Uploaded, DocumentStatus.Failed]),
      ),
    )
    .groupBy(documents.status);
  const [finished] = await db
    .select({ n: count() })
    .from(documents)
    .where(stateConditions(userId, ProcessingState.Finished, now));
  const of = (status: string) => byStatus.find((row) => row.status === status)?.n ?? 0;
  return {
    running: of(DocumentStatus.Processing),
    queued: of(DocumentStatus.Uploaded),
    failed: of(DocumentStatus.Failed),
    finished: finished?.n ?? 0,
  };
}

/**
 * The caller's documents in one state, with their steps.
 *
 * @param db - The connection.
 * @param userId - The caller.
 * @param state - Which state.
 * @param now - The clock, for the "finished" window.
 * @returns At most `PROCESSING_DEFAULTS.listLimit`. Running and queued in the order they were
 *   handed over, oldest first, as the runner takes them; failed and finished newest first.
 */
export async function processingEntries(
  db: DB,
  userId: string,
  state: ProcessingState,
  now: Date,
): Promise<ProcessingEntry[]> {
  const waiting = state === ProcessingState.Running || state === ProcessingState.Queued;
  const rows = await db
    .select({ document: documents, finishedAt: lastFinished() })
    .from(documents)
    .where(stateConditions(userId, state, now))
    .orderBy(
      waiting ? asc(documents.updatedAt) : desc(sql`coalesce(${lastFinished()}, ${documents.updatedAt})`),
      asc(documents.id),
    )
    .limit(PROCESSING_DEFAULTS.listLimit);
  if (rows.length === 0) {
    return [];
  }
  const steps = await db
    .select()
    .from(processingSteps)
    .where(
      inArray(
        processingSteps.documentId,
        rows.map((row) => row.document.id),
      ),
    )
    .orderBy(asc(processingSteps.position));
  return rows.map((row) => ({
    document: row.document,
    steps: steps.filter((step) => step.documentId === row.document.id),
    // A raw subquery comes back as the driver's text, not a Date.
    finishedAt: row.finishedAt === null ? null : new Date(row.finishedAt),
  }));
}

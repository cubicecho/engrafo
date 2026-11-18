import type { DB } from '@cubicecho/engrafo-db';
import { documents } from '@cubicecho/engrafo-db/schema';
import { MERGE_SUGGESTION_DEFAULTS, type MergeSuggestionSettings } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND } from '../core/wire.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import type { StorageSet } from '../storage/s3.ts';
import { type AiCheckResult, checkUser } from './ai-check.ts';
import { isMergeableRecent, lookbackStart } from './candidates.ts';
import { type RescoreResult, rescoreUser } from './store.ts';

// The job that writes suggested merges. Not a pipeline step: a step would send every finished
// document back through `catchUp()`, and the job looks across a user's documents, not at one. It
// waits for a user's runs to go quiet, so a scan batch is scored once, after its last page is in.
// A timer in the process, like the trash purger's, because there is one server. After each
// rescore it asks the model about the steps the rules are unsure of, when one is set up.

/** What the suggester is built from. */
export interface MergeSuggesterOptions {
  db: DB;
  storage: StorageSet;
  /** Where `document.processed` arrives. */
  events: PipelineEvents;
  settings?: MergeSuggestionSettings;
  /** What time it is. A test hands in its own clock. */
  now?: () => Date;
  /** Rescores one user. Defaults to `rescoreUser`; a test hands in one it can hold open. */
  rescore?: (userId: string) => Promise<RescoreResult>;
  /**
   * Asks the model about one user's unsure steps, after each rescore. Defaults to `checkUser`,
   * with the failures it remembers kept here across passes and the stop signal handed in.
   */
  check?: (userId: string) => Promise<AiCheckResult>;
  log?: (message: string) => void;
}

/** The suggester, started by the boot and stopped on shutdown. */
export interface MergeSuggester {
  /** Says a user's documents changed: their rescore waits until `quietSeconds` pass with no other. */
  notify(userId: string): void;
  /**
   * Rescores one user now, with the model check after it, rather than after `quietSeconds`: what
   * the person asks for with "Check again". A rescore of theirs already running is not run beside:
   * this one follows it, and any number asked for meanwhile are that one run.
   *
   * @returns Once that run has finished, so the caller reads what it wrote. A failure is a log
   *   line, as it is for a run an event started.
   */
  rescoreNow(userId: string): Promise<void>;
  /**
   * Rescores, at once, every user with a mergeable document filed within `lookbackDays`, so what
   * finished while the server was down is scored.
   *
   * @returns How many users were rescored.
   */
  catchUp(): Promise<number>;
  /** Resolves once no rescore or model check is running. For tests. */
  idle(): Promise<void>;
  /** Cancels every waiting rescore, abandons the model's questions, and waits for what is running. */
  stop(): Promise<void>;
}

/**
 * Builds the suggester and subscribes it to `document.processed`.
 *
 * @param options - The database, buckets, emitter and settings.
 * @returns The suggester. Nothing runs until an event arrives or `catchUp` is called.
 *
 * @remarks
 * One rescore at a time per user, with its model check after it: one asked for while another runs
 * is run once after it.
 */
export function createMergeSuggester({
  db,
  storage,
  events,
  settings = MERGE_SUGGESTION_DEFAULTS,
  now = () => new Date(),
  rescore = (userId) => rescoreUser({ db, storage }, userId, { now: now(), settings }),
  check,
  log = console.log,
}: MergeSuggesterOptions): MergeSuggester {
  const stopping = new AbortController();
  const failedSteps = new Map<string, Date>();
  const checkModel =
    check ??
    ((userId: string) =>
      checkUser({ db, storage, failedSteps }, userId, { now: now(), settings, log, signal: stopping.signal }));
  const quietMs = settings.quietSeconds * MS_PER_SECOND;
  const timers = new Map<string, NodeJS.Timeout>();
  const running = new Map<string, Promise<void>>();
  const runAgain = new Set<string>();
  let isStopping = false;

  function run(userId: string): void {
    if (isStopping) {
      return;
    }
    if (running.has(userId)) {
      runAgain.add(userId);
      return;
    }
    // Started inside a promise, so even a rescore that throws before its first await is a log line.
    const task = Promise.resolve()
      .then(() => rescoreThenCheck(userId))
      .finally(() => {
        running.delete(userId);
        if (runAgain.delete(userId)) {
          run(userId);
        }
      });
    running.set(userId, task);
  }

  async function rescoreThenCheck(userId: string): Promise<void> {
    try {
      const { inserted, updated, deleted } = await rescore(userId);
      const changedAnything = inserted + updated + deleted > 0;
      if (changedAnything) {
        log(`[merge-suggestions] ${userId}: ${inserted} new, ${updated} rescored, ${deleted} dropped`);
      }
    } catch (error) {
      log(`[merge-suggestions] rescore of ${userId} failed: ${errorMessage(error)}`);
      return;
    }
    if (isStopping) {
      return;
    }
    try {
      const { asked, recorded } = await checkModel(userId);
      if (asked > 0) {
        log(`[merge-suggestions] ${userId}: asked the model about ${asked} steps, recorded ${recorded}`);
      }
    } catch (error) {
      log(`[merge-suggestions] model check of ${userId} failed: ${errorMessage(error)}`);
    }
  }

  function notify(userId: string): void {
    if (isStopping) {
      return;
    }
    clearTimeout(timers.get(userId));
    const timer = setTimeout(() => {
      timers.delete(userId);
      run(userId);
    }, quietMs);
    // A waiting rescore must not keep a process alive that is otherwise done.
    timer.unref();
    timers.set(userId, timer);
  }

  async function idle(): Promise<void> {
    while (running.size > 0) {
      await Promise.all(running.values());
    }
  }

  // Ready or failed: a document that failed on a re-run has left the candidates, and its open
  // suggestion has to go.
  events.on('document.processed', ({ userId }) => notify(userId));

  return {
    notify,

    async rescoreNow(userId) {
      if (isStopping) {
        return;
      }
      // The run asked for now stands in for the one the timer would start.
      clearTimeout(timers.get(userId));
      timers.delete(userId);
      run(userId);
      // Until the user's runs are done, the one after a running one included: that one is this.
      for (let task = running.get(userId); task !== undefined; task = running.get(userId)) {
        await task;
      }
    },

    async catchUp() {
      try {
        const owners = await db
          .selectDistinct({ userId: documents.userId })
          .from(documents)
          .where(isMergeableRecent(lookbackStart(now(), settings)));
        for (const { userId } of owners) {
          run(userId);
        }
        return owners.length;
      } catch (error) {
        log(`[merge-suggestions] catch-up failed: ${errorMessage(error)}`);
        return 0;
      }
    },

    idle,

    async stop() {
      isStopping = true;
      stopping.abort();
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      runAgain.clear();
      await idle();
    },
  };
}

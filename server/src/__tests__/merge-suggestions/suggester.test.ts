import { DocumentStatus } from '@cubicecho/engrafo-db/schema';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MERGE_SUGGESTION_DEFAULTS } from '../../core/defaults.ts';
import type { RescoreResult } from '../../merge-suggestions/store.ts';
import { createMergeSuggester, type MergeSuggesterOptions } from '../../merge-suggestions/suggester.ts';
import { createPipelineEvents, type PipelineEvents } from '../../pipeline/events.ts';
import { createFakeStorage, createTestDb, createUser, type TestDb } from '../helpers.ts';
import { at, candidate } from './fixtures.ts';
import { seedCandidates } from './seed.ts';

const QUIET_MS = MERGE_SUGGESTION_DEFAULTS.quietSeconds * 1000;
const NOTHING: RescoreResult = { inserted: 0, updated: 0, deleted: 0 };

/** A rescore a test finishes by hand, and every user it was started for, in order. */
function heldRescore() {
  const started: string[] = [];
  const pending: Array<() => void> = [];
  const rescore = (userId: string) => {
    started.push(userId);
    return new Promise<RescoreResult>((resolve) => pending.push(() => resolve(NOTHING)));
  };
  /** Finishes the oldest rescore still running. */
  const finishNext = async () => {
    pending.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { started, rescore, finishNext };
}

describe('the merge suggester', () => {
  let db: TestDb;
  let events: PipelineEvents;
  let logged: string[];

  beforeAll(async () => {
    db = await createTestDb();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    events = createPipelineEvents();
    logged = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Every test here hands in its own rescore, so the database is never read.
  const suggester = (rescore: MergeSuggesterOptions['rescore']) =>
    createMergeSuggester({
      db,
      storage: createFakeStorage(),
      events,
      rescore,
      log: (message) => logged.push(message),
    });

  it('waits for a user’s documents to go quiet, restarting on each one', async () => {
    const held = heldRescore();
    suggester(held.rescore).notify('alice');
    await vi.advanceTimersByTimeAsync(QUIET_MS / 2);
    events.emit('document.processed', { documentId: 'd2', userId: 'alice', status: DocumentStatus.Ready });
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(held.started).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(held.started).toEqual(['alice']);
  });

  it('listens for documents that failed as well as those that are ready, per user', async () => {
    const held = heldRescore();
    suggester(held.rescore);
    events.emit('document.processed', { documentId: 'd1', userId: 'alice', status: DocumentStatus.Ready });
    events.emit('document.processed', { documentId: 'd2', userId: 'bob', status: DocumentStatus.Failed });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(held.started.sort()).toEqual(['alice', 'bob']);
  });

  it('runs one rescore at a time per user, and once more after for whatever arrived meanwhile', async () => {
    const held = heldRescore();
    const job = suggester(held.rescore);
    job.notify('alice');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(held.started).toEqual(['alice']);

    // Two batches go quiet while the first rescore is still running: one more run covers both.
    job.notify('alice');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    job.notify('alice');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(held.started).toEqual(['alice']);

    await held.finishNext();
    expect(held.started).toEqual(['alice', 'alice']);
    await held.finishNext();
    await job.idle();
    expect(held.started).toEqual(['alice', 'alice']);
  });

  it('logs a failed rescore and carries on', async () => {
    let calls = 0;
    const job = suggester(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('database went away');
      }
      return { inserted: 1, updated: 0, deleted: 0 };
    });
    job.notify('alice');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await job.idle();
    expect(logged).toEqual(['[merge-suggestions] rescore of alice failed: database went away']);

    job.notify('alice');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await job.idle();
    expect(calls).toBe(2);
    expect(logged[1]).toMatch(/^\[merge-suggestions\] alice: 1 new/);
  });

  it('stops: cancels what is waiting and waits for what is running', async () => {
    const held = heldRescore();
    const job = suggester(held.rescore);
    job.notify('alice');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    job.notify('alice');
    job.notify('bob');

    let stopped = false;
    const stopping = job.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(stopped).toBe(false);

    await held.finishNext();
    await stopping;
    expect(stopped).toBe(true);
    expect(held.started).toEqual(['alice']);

    job.notify('alice');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(held.started).toEqual(['alice']);
  });
});

describe('the merge suggester at boot', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('rescores every user with a mergeable document from the lookback, and no one else', async () => {
    const storage = createFakeStorage();
    const now = new Date(at(0).getTime() + 24 * 60 * 60 * 1000);
    const recent = await createUser(db, 'recent@example.com');
    const old = await createUser(db, 'old@example.com');
    const notes = await createUser(db, 'notes@example.com');
    await createUser(db, 'empty@example.com');
    await seedCandidates(db, storage, recent, [candidate({ id: 'scan', createdAt: at(0) })]);
    await seedCandidates(db, storage, old, [
      candidate({ id: 'scan', createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }),
    ]);
    await seedCandidates(db, storage, notes, [candidate({ id: 'notes', createdAt: at(0), mimeType: 'text/plain' })]);

    const started: string[] = [];
    const job = createMergeSuggester({
      db,
      storage,
      events: createPipelineEvents(),
      now: () => now,
      rescore: async (userId) => {
        started.push(userId);
        return NOTHING;
      },
    });

    expect(await job.catchUp()).toBe(1);
    await job.idle();
    expect(started).toEqual([recent]);
  });
});

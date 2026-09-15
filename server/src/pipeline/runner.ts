import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DB } from '@cubicecho/engrafo-db';
import { type Document, documents, processingSteps } from '@cubicecho/engrafo-db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { StorageSet } from '../storage/s3.ts';
import type { PipelineEvents } from './events.ts';
import type { PipelineConfig, PipelineStep } from './types.ts';

// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 rc driver union
type AnyDb = any;

export interface PipelineOptions {
  db: DB;
  storage: StorageSet;
  events: PipelineEvents;
  steps: PipelineStep[];
  config: PipelineConfig;
  log?: (message: string, error?: unknown) => void;
}

export interface Pipeline {
  /** Runs one document to completion or failure. Resolves either way; failure is recorded, not thrown. */
  run(documentId: string): Promise<void>;
  /** Re-emits every document a previous process left unfinished. */
  resume(): Promise<number>;
  /** Resolves once nothing is queued or running. For tests and graceful shutdown. */
  idle(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A counting semaphore. OCR is CPU-bound, and without a limit a folder dropped
 * on the upload form forks one ocrmypdf per file at once.
 */
function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

export function createPipeline({ db, storage, events, steps, config, log = console.error }: PipelineOptions): Pipeline {
  const database = db as AnyDb;
  const limit = createLimiter(config.concurrency);
  // Queued as well as running: a document emitted twice before it starts (a
  // double-clicked retry, a resume racing a late completion) runs once.
  const inFlight = new Map<string, Promise<void>>();

  async function setStep(documentId: string, step: string, values: Record<string, unknown>) {
    await database
      .update(processingSteps)
      .set(values)
      .where(and(eq(processingSteps.documentId, documentId), eq(processingSteps.step, step)));
  }

  async function failDocument(documentId: string, message: string) {
    await database.update(documents).set({ status: 'failed', error: message }).where(eq(documents.id, documentId));
  }

  async function execute(documentId: string): Promise<void> {
    const [found] = await database.select().from(documents).where(eq(documents.id, documentId));
    // Deleted while queued, or still waiting on its upload: nothing to do.
    if (!found || found.status === 'pending_upload' || found.status === 'ready') return;
    let doc: Document = found;

    // Rows are normally written by completeDocumentUpload. Inserting any that
    // are missing here is what lets a step added in a later release reach
    // documents that were mid-pipeline when the server upgraded.
    if (steps.length > 0) {
      await database
        .insert(processingSteps)
        .values(steps.map((step, position) => ({ userId: doc.userId, documentId, step: step.name, position })))
        .onConflictDoNothing();
    }

    const rows: Array<{ step: string; status: string; attempts: number }> = await database
      .select()
      .from(processingSteps)
      .where(eq(processingSteps.documentId, documentId));
    const done = new Set(
      rows.filter((row) => row.status === 'succeeded' || row.status === 'skipped').map((r) => r.step),
    );

    await database.update(documents).set({ status: 'processing', error: null }).where(eq(documents.id, documentId));

    const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-'));
    try {
      for (const step of steps) {
        if (done.has(step.name)) continue;

        if (!step.enabled(doc, config)) {
          await setStep(documentId, step.name, { status: 'skipped', error: null, finishedAt: new Date() });
          continue;
        }

        const attempts = (rows.find((row) => row.step === step.name)?.attempts ?? 0) + 1;
        await setStep(documentId, step.name, {
          status: 'running',
          attempts,
          error: null,
          startedAt: new Date(),
          finishedAt: null,
        });

        try {
          const patch = await step.run({ doc, db, storage, config, tmpDir });
          if (patch && Object.keys(patch).length > 0) {
            const [updated] = await database
              .update(documents)
              .set(patch)
              .where(eq(documents.id, documentId))
              .returning();
            if (!updated) return; // deleted mid-run
            doc = updated;
          }
          await setStep(documentId, step.name, { status: 'succeeded', finishedAt: new Date() });
        } catch (error) {
          const message = errorMessage(error);
          await setStep(documentId, step.name, { status: 'failed', error: message, finishedAt: new Date() });
          await failDocument(documentId, `${step.name}: ${message}`);
          return;
        }
      }

      await database.update(documents).set({ status: 'ready' }).where(eq(documents.id, documentId));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  function run(documentId: string): Promise<void> {
    const existing = inFlight.get(documentId);
    if (existing) return existing;

    const task = limit(() => execute(documentId))
      .catch(async (error) => {
        // A step's own failure is recorded inside execute. Reaching here means
        // the bookkeeping itself broke (the database went away); try once to say
        // so on the document, so it does not sit at "processing" forever.
        log(`[pipeline] ${documentId} crashed`, error);
        await failDocument(documentId, errorMessage(error)).catch(() => {});
      })
      .finally(() => inFlight.delete(documentId));
    inFlight.set(documentId, task);
    return task;
  }

  events.on('document.uploaded', ({ documentId }) => {
    void run(documentId);
  });

  return {
    run,

    async resume() {
      const unfinished: Array<{ id: string }> = await database
        .select({ id: documents.id })
        .from(documents)
        .where(inArray(documents.status, ['uploaded', 'processing']));
      for (const { id } of unfinished) events.emit('document.uploaded', { documentId: id });
      return unfinished.length;
    },

    async idle() {
      while (inFlight.size > 0) await Promise.all(inFlight.values());
    },
  };
}

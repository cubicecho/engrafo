import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DB } from '@cubicecho/engrafo-db';
import {
  type Document,
  DocumentStatus,
  documents,
  type NewProcessingStep,
  processingSteps,
  StepStatus,
} from '@cubicecho/engrafo-db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { errorMessage } from '../core/errors.ts';
import type { StorageSet } from '../storage/s3.ts';
import type { PipelineEvents } from './events.ts';
import type { PipelineConfig, PipelineStep } from './types.ts';

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
  /** Resolves once nothing is queued or running. For tests. */
  idle(): Promise<void>;
  /**
   * Stops taking documents and stops recording failures, for shutdown.
   *
   * @remarks
   * A step cut off by the process ending did not fail, and marking it failed
   * would leave the document waiting on a person. Left as it is, the next boot's
   * `resume()` runs it again.
   */
  stop(): void;
}

/**
 * A counting semaphore. OCR is CPU-bound, and without a limit a folder dropped
 * on the upload form forks one ocrmypdf per file at once.
 */
function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
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
  const limit = createLimiter(config.concurrency);
  // Queued as well as running: a document emitted twice before it starts (a
  // double-clicked retry, a resume racing a late completion) runs once.
  const inFlight = new Map<string, Promise<void>>();
  let isStopping = false;

  async function setStep(documentId: string, step: string, values: Partial<NewProcessingStep>) {
    await db
      .update(processingSteps)
      .set(values)
      .where(and(eq(processingSteps.documentId, documentId), eq(processingSteps.step, step)));
  }

  async function failDocument(documentId: string, message: string) {
    await db
      .update(documents)
      .set({ status: DocumentStatus.Failed, error: message })
      .where(eq(documents.id, documentId));
  }

  async function execute(documentId: string): Promise<void> {
    const [found] = await db.select().from(documents).where(eq(documents.id, documentId));
    // Deleted while queued, or still waiting on its upload: nothing to do.
    if (!found || found.status === DocumentStatus.PendingUpload || found.status === DocumentStatus.Ready) {
      return;
    }
    let doc: Document = found;

    // Rows are normally written by completeDocumentUpload. Inserting any that
    // are missing here is what lets a step added in a later release reach
    // documents that were mid-pipeline when the server upgraded.
    if (steps.length > 0) {
      await db
        .insert(processingSteps)
        .values(steps.map((step, position) => ({ userId: doc.userId, documentId, step: step.name, position })))
        .onConflictDoNothing();
    }

    const rows = await db.select().from(processingSteps).where(eq(processingSteps.documentId, documentId));
    const done = new Set(
      rows.filter((row) => row.status === StepStatus.Succeeded || row.status === StepStatus.Skipped).map((r) => r.step),
    );

    await db
      .update(documents)
      .set({ status: DocumentStatus.Processing, error: null })
      .where(eq(documents.id, documentId));

    const tmpDir = await mkdtemp(join(tmpdir(), 'engrafo-'));
    try {
      for (const step of steps) {
        if (done.has(step.name)) {
          continue;
        }

        if (!step.enabled(doc, config)) {
          await setStep(documentId, step.name, { status: StepStatus.Skipped, error: null, finishedAt: new Date() });
          continue;
        }

        const attempts = (rows.find((row) => row.step === step.name)?.attempts ?? 0) + 1;
        await setStep(documentId, step.name, {
          status: StepStatus.Running,
          attempts,
          error: null,
          startedAt: new Date(),
          finishedAt: null,
        });

        try {
          const patch = await step.run({ doc, db, storage, config, tmpDir });
          if (patch && Object.keys(patch).length > 0) {
            const [updated] = await db.update(documents).set(patch).where(eq(documents.id, documentId)).returning();
            if (!updated) {
              return; // deleted mid-run
            }
            doc = updated;
          }
          await setStep(documentId, step.name, { status: StepStatus.Succeeded, finishedAt: new Date() });
        } catch (error) {
          if (isStopping) {
            return;
          }
          const message = errorMessage(error);
          await setStep(documentId, step.name, { status: StepStatus.Failed, error: message, finishedAt: new Date() });
          await failDocument(documentId, `${step.name}: ${message}`);
          return;
        }
      }

      await db.update(documents).set({ status: DocumentStatus.Ready }).where(eq(documents.id, documentId));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  function run(documentId: string): Promise<void> {
    if (isStopping) {
      return Promise.resolve();
    }
    const existing = inFlight.get(documentId);
    if (existing) {
      return existing;
    }

    const task = limit(() => execute(documentId))
      .catch(async (error) => {
        if (isStopping) {
          return;
        }
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
      const unfinished = await db
        .select({ id: documents.id })
        .from(documents)
        .where(inArray(documents.status, [DocumentStatus.Uploaded, DocumentStatus.Processing]));
      for (const { id } of unfinished) {
        events.emit('document.uploaded', { documentId: id });
      }
      return unfinished.length;
    },

    async idle() {
      while (inFlight.size > 0) {
        await Promise.all(inFlight.values());
      }
    },

    stop() {
      isStopping = true;
    },
  };
}

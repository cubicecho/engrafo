import { EventEmitter } from 'node:events';
import type { DocumentStatus } from '@cubicecho/engrafo-db/schema';

/** How a run can end. */
export type ProcessedStatus = typeof DocumentStatus.Ready | typeof DocumentStatus.Failed;

/**
 * The pipeline's trigger and its one report. A mutation emits `document.uploaded` and returns;
 * the runner listens in the same process, and emits `document.processed` when a run settles the
 * document `ready` or `failed`, which is what the merge suggester waits on. There is deliberately
 * no queue behind it: `processing_steps` holds the state, so a restart loses nothing but the
 * in-flight step, which boot resumes. Swapping in a real queue later means replacing this file
 * and the listeners, not the steps.
 */
export interface PipelineEventMap {
  'document.uploaded': [{ documentId: string }];
  'document.processed': [{ documentId: string; userId: string; status: ProcessedStatus }];
}

/** The emitter mutations and the runner share. */
export type PipelineEvents = EventEmitter<PipelineEventMap>;

/**
 * Builds the emitter that connects mutations to the runner.
 *
 * @returns A new emitter with no listeners. `createPipeline` adds the one that runs documents.
 */
export function createPipelineEvents(): PipelineEvents {
  return new EventEmitter<PipelineEventMap>();
}

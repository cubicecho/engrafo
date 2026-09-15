import { EventEmitter } from 'node:events';

/**
 * The pipeline's only trigger, for now. A mutation emits and returns; the runner
 * listens in the same process. There is deliberately no queue behind it —
 * `processing_steps` holds the state, so a restart loses nothing but the
 * in-flight step, which boot resumes. Swapping in a real queue later means
 * replacing this file and the listener, not the steps.
 */
export interface PipelineEventMap {
  'document.uploaded': [{ documentId: string }];
}

export type PipelineEvents = EventEmitter<PipelineEventMap>;

export function createPipelineEvents(): PipelineEvents {
  return new EventEmitter<PipelineEventMap>();
}

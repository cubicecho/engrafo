import type { DB } from '@cubicecho/engrafo-db';
import type { PipelineEvents } from './pipeline/events.ts';
import type { StorageSet } from './storage/s3.ts';

/**
 * What every resolver — generated or hand-written — is handed. `userId` is the
 * only thing that says who the caller is: it comes from the request's Bearer
 * token and nothing downstream may take it from an argument.
 */
export interface Context {
  db: DB;
  userId: string | null;
  storage: StorageSet;
  /** How a mutation tells the pipeline there is work, without waiting for it. */
  events: PipelineEvents;
  /** Whether the ocr step can run on this instance: allowed by config and ocrmypdf found at boot. */
  ocrAvailable: boolean;
}

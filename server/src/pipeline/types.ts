import type { DB, Document } from '@cubicecho/engrafo-db';
import type { StorageSet } from '../storage/s3.ts';

export interface PipelineConfig {
  /** OCR allowed by config and ocrmypdf present. */
  ocrAvailable: boolean;
  ocrLanguages: string;
  concurrency: number;
}

export interface StepContext {
  doc: Document;
  db: DB;
  storage: StorageSet;
  config: PipelineConfig;
  /** Scratch space for this run, removed when the run ends however it ends. */
  tmpDir: string;
}

/** The columns a step may write back onto its document. */
export type DocumentPatch = Partial<
  Pick<Document, 'checksumSha256' | 'mimeType' | 'archiveKey' | 'contentKey' | 'contentBytes'>
>;

/**
 * One stage of processing. Steps run in the order of `STEPS`, each at most once
 * successfully per document; a step that throws fails the document and stops the
 * run, and retry picks up from it.
 */
export interface PipelineStep {
  name: string;
  /** False marks the step `skipped` rather than running it. Sees the document as earlier steps left it. */
  enabled(doc: Document, config: PipelineConfig): boolean;
  run(context: StepContext): Promise<DocumentPatch | undefined>;
}

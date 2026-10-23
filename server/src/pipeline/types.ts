import type { DB, Document } from '@cubicecho/engrafo-db';
import type { DateOrder } from '../core/defaults.ts';
import type { Embedder } from '../search/embedder.ts';
import type { StorageSet } from '../storage/s3.ts';

/** The settings every run is handed, decided once at boot. */
export interface PipelineConfig {
  /** OCR allowed by config and ocrmypdf present. */
  ocrAvailable: boolean;
  /** pdftotext present, so a PDF's own text layer can be read. */
  pdfTextAvailable: boolean;
  /** Tesseract language codes joined with `+`. */
  ocrLanguages: string;
  /** How many documents run at once. */
  concurrency: number;
  /** How the metadata step reads an ambiguous numeric date. */
  dateOrder: DateOrder;
}

/** What a step's `run` is given. */
export interface StepContext {
  /** The document as earlier steps left it. */
  doc: Document;
  db: DB;
  storage: StorageSet;
  config: PipelineConfig;
  /** Turns passages into vectors for the search index. */
  embedder: Embedder;
  /** Scratch space for this run, removed when the run ends however it ends. */
  tmpDir: string;
}

/** The columns a step may write back onto its document. */
export type DocumentPatch = Partial<
  Pick<
    Document,
    | 'checksumSha256'
    | 'mimeType'
    | 'archiveKey'
    | 'contentKey'
    | 'contentBytes'
    | 'documentDate'
    | 'documentDateSource'
    | 'vendor'
    | 'total'
    | 'currency'
    | 'receiptSource'
  >
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

import type { DB, Document } from '@cubicecho/engrafo-db';
import type { DateOrder } from '../core/defaults.ts';
import type { Embedder } from '../search/embedder.ts';
import type { StorageSet } from '../storage/s3.ts';
import type { VisionConfig } from '../vision/settings.ts';
import type { ThumbnailTools } from './thumbnail.ts';

/** The settings every run is handed, decided once at boot. */
export interface PipelineConfig {
  /** OCR allowed by config and ocrmypdf present. */
  ocrAvailable: boolean;
  /** pdftotext present, so a PDF's own text layer can be read. */
  pdfTextAvailable: boolean;
  /** Which of pdftoppm and Pillow are here, for the thumbnail step. */
  thumbnailTools: ThumbnailTools;
  /** Tesseract language codes joined with `+`. */
  ocrLanguages: string;
  /** How many documents run at once. */
  concurrency: number;
  /** How the metadata step reads an ambiguous numeric date. */
  dateOrder: DateOrder;
}

/**
 * What one run's steps see: the boot settings, and what the admin has set in the app, read as the
 * run starts so a change reaches the next document without a restart.
 */
export interface RunConfig extends PipelineConfig {
  /** The vision model, or null when none is set up. */
  vision: VisionConfig | null;
}

/** What a step's `run` is given. */
export interface StepContext {
  /** The document as earlier steps left it. */
  doc: Document;
  db: DB;
  storage: StorageSet;
  config: RunConfig;
  /** Turns passages into vectors for the search index. */
  embedder: Embedder;
  /** Scratch space for this run, removed when the run ends however it ends. */
  tmpDir: string;
  /**
   * Records how far the step has got, which the document page shows while it runs: `done` of
   * `total` units (the vision step's are pages). Optional to call; a step that never does shows
   * as running with no count.
   */
  reportProgress(done: number, total: number): Promise<void>;
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
    | 'contentFormat'
    | 'thumbnailKey'
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
  enabled(doc: Document, config: RunConfig): boolean;
  run(context: StepContext): Promise<DocumentPatch | undefined>;
}

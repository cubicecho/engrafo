import { inspectStep } from './steps/inspect.ts';
import { ocrStep } from './steps/ocr.ts';
import { pdfTextStep } from './steps/pdf-text.ts';
import { textStep } from './steps/text.ts';
import type { PipelineStep } from './types.ts';

/**
 * The pipeline, in order. Adding a step is a file in steps/ and an entry here;
 * documents already mid-pipeline pick it up, since the runner fills in any step
 * rows they are missing.
 */
// pdf-text is last, not beside text: a document mid-pipeline when this release
// lands already has rows at positions 0-2, and a new step takes the next one.
// It runs only when ocr does not, so the order between the two decides nothing.
export const STEPS: PipelineStep[] = [inspectStep, textStep, ocrStep, pdfTextStep];

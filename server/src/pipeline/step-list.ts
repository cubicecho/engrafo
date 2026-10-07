import { inspectStep } from './steps/inspect.ts';
import { ocrStep } from './steps/ocr.ts';
import { textStep } from './steps/text.ts';
import type { PipelineStep } from './types.ts';

/**
 * The pipeline, in order. Adding a step is a file in steps/ and an entry here;
 * documents already mid-pipeline pick it up, since the runner fills in any step
 * rows they are missing.
 */
export const STEPS: PipelineStep[] = [inspectStep, textStep, ocrStep];

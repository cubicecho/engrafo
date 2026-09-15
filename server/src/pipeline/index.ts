import { inspectStep } from './steps/inspect.ts';
import { ocrStep } from './steps/ocr.ts';
import { textStep } from './steps/text.ts';
import type { PipelineStep } from './types.ts';

export { createPipelineEvents, type PipelineEvents } from './events.ts';
export { createPipeline, type Pipeline } from './runner.ts';
export type { PipelineConfig, PipelineStep } from './types.ts';

/**
 * The pipeline, in order. Adding a step is a file in steps/ and a line here;
 * documents already mid-pipeline pick it up, since the runner fills in any step
 * rows they are missing.
 */
export const STEPS: PipelineStep[] = [inspectStep, textStep, ocrStep];

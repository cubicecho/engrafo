import { ebookStep } from './steps/ebook.ts';
import { indexStep } from './steps/index.ts';
import { inspectStep } from './steps/inspect.ts';
import { metadataStep } from './steps/metadata.ts';
import { ocrStep } from './steps/ocr.ts';
import { pdfTextStep } from './steps/pdf-text.ts';
import { textStep } from './steps/text.ts';
import { visionStep } from './steps/vision.ts';
import type { PipelineStep } from './types.ts';

/**
 * The pipeline, in order. Adding a step is a file in steps/ and an entry here;
 * documents already mid-pipeline pick it up, since the runner fills in any step
 * rows they are missing.
 */
// pdf-text is last, not beside text: a document mid-pipeline when this release
// lands already has rows at positions 0-2, and a new step takes the next one.
// It runs only when ocr does not, so the order between the two decides nothing.
// index is after every step that can produce text, and new for the same reason.
// ebook breaks that rule because it has to: it produces text, so it goes before
// index. A document mid-pipeline when it lands gets its row at index's position,
// which only ties the two in the timeline, and no document there is an ebook.
// metadata breaks it the same way: it reads the text every step before it may have produced, so
// it goes after them and before index. A document mid-pipeline when it lands, or a finished one
// caught up at boot, gets its row at index's position too, and runs it before index regardless:
// the runner goes by this list, and positions only order the timeline.
// vision breaks it for the reason ebook does: it produces text, replacing what ocr or pdf-text
// read, so it goes after them and before metadata and index, which read that text. A document
// mid-pipeline when it lands gets its row at index's position and runs it in this list's order.
// A finished one caught up at boot has its row marked skipped, since no model is set up until the
// admin sets one after the upgrade, so turning "auto" on later does not re-read the archive.
export const STEPS: PipelineStep[] = [
  inspectStep,
  textStep,
  ocrStep,
  pdfTextStep,
  ebookStep,
  visionStep,
  metadataStep,
  indexStep,
];

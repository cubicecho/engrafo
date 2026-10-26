/** What the timeline says about one pipeline step: its name, what it does, and why it would be skipped. */
export interface StepInfo {
  /** The step's name in the reader's words: "Vision model" rather than `vision`. */
  label: string;
  /** One line on what the step does when it runs. */
  description: string;
  /** Why a step ends up `skipped`, said instead of `description` once it has. */
  skipped: string;
  /**
   * What the step counts when it reports progress, as a capitalised noun: `Page`. A step with one
   * says which item it is on ("Page 3 of 12"); one without says only how many are done.
   */
  unit?: string;
}

// Keyed by the name the server stores on every `processing_steps` row (server/src/pipeline/steps).
const STEPS: Readonly<Record<string, StepInfo>> = Object.freeze({
  inspect: {
    label: 'Inspect',
    description: 'Checks the file type and its checksum',
    skipped: 'Nothing to inspect',
  },
  text: {
    label: 'Text',
    description: 'Reads plain text, Markdown, CSV and web pages',
    skipped: 'Not a text file',
  },
  ocr: {
    label: 'OCR',
    description: 'Recognises the text in a scan or an image',
    skipped: 'OCR was not asked for, or is not available',
  },
  'pdf-text': {
    label: 'PDF text',
    description: 'Reads the text layer a PDF already has',
    skipped: 'Not a PDF, or OCR already read it',
  },
  ebook: {
    label: 'Ebook',
    description: "Reads an ebook's chapters",
    skipped: 'Not an ebook',
  },
  vision: {
    label: 'Vision model',
    description: 'Reads the pages with a vision model',
    skipped: 'No vision model is set up, or it was not asked for',
    unit: 'Page',
  },
  metadata: {
    label: 'Metadata',
    description: 'Finds the date on the document and any receipt',
    skipped: 'No text to read it from',
  },
  index: {
    label: 'Search index',
    description: 'Makes the text searchable',
    skipped: 'No text to index',
  },
});

/**
 * What to call a pipeline step and what to say about it.
 *
 * @param step - The step's stored name, such as `ocr` or `vision`.
 * @returns Its label and descriptions. A name this bundle has never heard of (a server newer
 *   than the app) comes back as itself, with nothing said about it.
 */
export function stepInfo(step: string): StepInfo {
  // Own keys only: a step called `constructor` must not find Object's.
  return (Object.hasOwn(STEPS, step) ? STEPS[step] : undefined) ?? { label: step, description: '', skipped: '' };
}

/** How far a running step has got, in the words the timeline and the tab say it. */
export interface StepProgress {
  /** "Page 3 of 12", or "3 of 12" for a step that names no unit. */
  line: string;
  /** "Page 3/12", for a tab. */
  short: string;
}

/**
 * Words for a step's reported progress.
 *
 * @param step - The step's stored name.
 * @param done - How many units are finished.
 * @param total - How many there are.
 * @returns What to say. A step with a unit names the one it is on, the one after the last done,
 *   so the first page reads "Page 1" while it is being read, not "Page 0".
 */
export function stepProgress(step: string, done: number, total: number): StepProgress {
  const { unit } = stepInfo(step);
  if (unit === undefined) {
    return { line: `${done} of ${total}`, short: `${done}/${total}` };
  }
  const current = Math.min(done + 1, total);
  return { line: `${unit} ${current} of ${total}`, short: `${unit} ${current}/${total}` };
}

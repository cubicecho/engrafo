/** What the timeline says about one pipeline step: its name, what it does, and why it would be skipped. */
export interface StepInfo {
  /** The step's name in the reader's words: "Vision model" rather than `vision`. */
  label: string;
  /** One line on what the step does when it runs. */
  description: string;
  /** Why a step ends up `skipped`, said instead of `description` once it has. */
  skipped: string;
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

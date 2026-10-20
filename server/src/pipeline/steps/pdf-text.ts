import { join } from 'node:path';
import { storeContent } from '../content.ts';
import { readPdfText } from '../pdf-text.ts';
import type { PipelineStep } from '../types.ts';
import { ocrStep } from './ocr.ts';

/**
 * A PDF's own text, when OCR is not going to run: it was not asked for, or is unavailable here.
 * When OCR does run, it reads the text layer of what it produced, so this step stands aside.
 */
export const pdfTextStep: PipelineStep = {
  name: 'pdf-text',
  enabled: (doc, config) =>
    doc.mimeType === 'application/pdf' && config.pdfTextAvailable && ocrStep.enabled(doc, config) === false,
  async run({ doc, storage, tmpDir }) {
    const input = join(tmpDir, 'original.pdf');
    await storage.files.download(doc.originalKey, input);
    return storeContent(storage, doc, await readPdfText(input));
  },
};

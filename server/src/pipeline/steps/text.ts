import { text } from 'node:stream/consumers';
import { storeContent } from '../content.ts';
import type { PipelineStep } from '../types.ts';

/** A text file is its own content; there is nothing to recognise. */
export const textStep: PipelineStep = {
  name: 'text',
  enabled: (doc) => doc.mimeType === 'text/plain',
  async run({ doc, storage }) {
    const content = await text(await storage.files.getStream(doc.originalKey));
    return storeContent(storage, doc, content);
  },
};

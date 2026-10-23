import { text } from 'node:stream/consumers';
import { storeContent } from '../content.ts';
import { isText } from '../mime.ts';
import type { PipelineStep } from '../types.ts';

/** A text or Markdown file is its own content; there is nothing to recognise. */
export const textStep: PipelineStep = {
  name: 'text',
  enabled: (doc) => isText(doc.mimeType),
  async run({ doc, storage }) {
    const content = await text(await storage.files.getStream(doc.originalKey));
    return storeContent(storage, doc, content);
  },
};

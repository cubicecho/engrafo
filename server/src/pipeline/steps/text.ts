import { text } from 'node:stream/consumers';
import { storeContent } from '../content.ts';
import { htmlText } from '../html-text.ts';
import { HTML_MIME_TYPE, isText } from '../mime.ts';
import type { PipelineStep } from '../types.ts';

/**
 * A file that is text already is its own content; there is nothing to recognise. A web page's
 * markup is taken off first, so what is stored and searched is what the page said, and its
 * headings become Markdown headings.
 */
// HTML comes here rather than to a step of its own: a new step would put every
// finished document back through the pipeline at upgrade, for a row each.
export const textStep: PipelineStep = {
  name: 'text',
  enabled: (doc) => isText(doc.mimeType) || doc.mimeType === HTML_MIME_TYPE,
  async run({ doc, storage }) {
    const content = await text(await storage.files.getStream(doc.originalKey));
    return storeContent(storage, doc, doc.mimeType === HTML_MIME_TYPE ? htmlText(content) : content);
  },
};

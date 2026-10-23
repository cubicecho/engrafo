import { join } from 'node:path';
import { storeContent } from '../content.ts';
import { bookText, readEpub } from '../epub.ts';
import { EPUB_MIME_TYPE } from '../mime.ts';
import type { PipelineStep } from '../types.ts';

/**
 * An ebook's text, with each chapter's name above it. Named for ebooks rather than EPUB because
 * a step's name is stored on every document's rows, and other formats are meant to come here too.
 */
export const ebookStep: PipelineStep = {
  name: 'ebook',
  enabled: (doc) => doc.mimeType === EPUB_MIME_TYPE,
  async run({ doc, storage, tmpDir }) {
    const epub = join(tmpDir, 'original.epub');
    await storage.files.download(doc.originalKey, epub);
    return storeContent(storage, doc, bookText(await readEpub(epub)));
  },
};

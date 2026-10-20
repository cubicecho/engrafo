import { indexDocument } from '../../search/index-document.ts';
import type { PipelineStep } from '../types.ts';

/**
 * Puts the document's text in the search index. Last, after every step that can produce text,
 * and always run: a document whose new text is empty must lose the passages it had.
 */
export const indexStep: PipelineStep = {
  name: 'index',
  enabled: () => true,
  async run({ doc, db, storage, embedder }) {
    await indexDocument({ db, storage, embedder }, doc);
    return undefined;
  },
};

import { text } from 'node:stream/consumers';
import { type Document, FieldSource } from '@cubicecho/engrafo-db/schema';
import { METADATA_DEFAULTS } from '../../core/defaults.ts';
import { findDocumentDate } from '../../metadata/document-date.ts';
import type { DocumentPatch, PipelineConfig, PipelineStep } from '../types.ts';

/**
 * The fields the pipeline fills in from a document's text, minus any the user has set.
 *
 * @param doc - The document, whose `*Source` columns say what is the user's.
 * @param content - Its text, empty when it has none.
 * @param config - The run's settings: the date order.
 * @param today - Today as `YYYY-MM-DD`.
 * @returns The patch. A field the user set is left out of it entirely, so no run overwrites an
 *   edit; an extracted one is always in it, null when this text has none, so a re-run whose new
 *   text has no date does not keep the last run's.
 */
export function metadataPatch(
  doc: Document,
  content: string,
  config: Pick<PipelineConfig, 'dateOrder'>,
  today: string,
): DocumentPatch {
  const patch: DocumentPatch = {};
  if (doc.documentDateSource !== FieldSource.User) {
    const documentDate = findDocumentDate(content.slice(0, METADATA_DEFAULTS.dateScanChars), {
      order: config.dateOrder,
      today,
      oldestYear: METADATA_DEFAULTS.oldestYear,
      futureToleranceDays: METADATA_DEFAULTS.futureToleranceDays,
    });
    patch.documentDate = documentDate;
    patch.documentDateSource = documentDate ? FieldSource.Extracted : null;
  }
  return patch;
}

/**
 * Reads the document's date from its text. After every step that produces text, and before
 * `index`, though nothing the index does reads it: see step-list.ts for why it is not last.
 */
export const metadataStep: PipelineStep = {
  name: 'metadata',
  enabled: () => true,
  async run({ doc, storage, config }) {
    const content = doc.contentKey ? await text(await storage.text.getStream(doc.contentKey)) : '';
    return metadataPatch(doc, content, config, new Date().toISOString().slice(0, 10));
  },
};

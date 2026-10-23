import { text } from 'node:stream/consumers';
import { type Document, FieldSource } from '@cubicecho/engrafo-db/schema';
import { METADATA_DEFAULTS } from '../../core/defaults.ts';
import { findDocumentDate } from '../../metadata/document-date.ts';
import { extractReceipt, NO_RECEIPT, type ReceiptExtractor, type ReceiptFields } from '../../metadata/receipt.ts';
import { hasHeadings } from '../mime.ts';
import type { DocumentPatch, PipelineConfig, PipelineStep } from '../types.ts';

/** What reads a receipt. The rules today; a model-based extractor goes here and nowhere else. */
const RECEIPT_EXTRACTOR: ReceiptExtractor = extractReceipt;

/**
 * Whether a document could be a receipt at all. An ebook or a Markdown note that says "Total:
 * 12.50" somewhere is still not one, and an expense export should not find it.
 */
function mayBeReceipt(doc: Document): boolean {
  return hasHeadings(doc.mimeType) === false;
}

/**
 * The fields the pipeline fills in from a document's text, minus any the user has set.
 *
 * @param doc - The document, whose `*Source` columns say what is the user's.
 * @param content - Its text, empty when it has none.
 * @param config - The run's settings: the date order.
 * @param today - Today as `YYYY-MM-DD`.
 * @param receipt - What the receipt extractor read from the same text.
 * @returns The patch. A field the user set is left out of it entirely, so no run overwrites an
 *   edit; an extracted one is always in it, null when this text has none, so a re-run whose new
 *   text has no date does not keep the last run's.
 */
export function metadataPatch(
  doc: Document,
  content: string,
  config: Pick<PipelineConfig, 'dateOrder'>,
  today: string,
  receipt: ReceiptFields = NO_RECEIPT,
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
  // The three receipt fields are one decision: an edit to any of them takes the receipt over.
  if (doc.receiptSource !== FieldSource.User) {
    const found = mayBeReceipt(doc) ? receipt : NO_RECEIPT;
    const isFound = found.vendor !== null || found.total !== null || found.currency !== null;
    patch.vendor = found.vendor;
    patch.total = found.total;
    patch.currency = found.currency;
    patch.receiptSource = isFound ? FieldSource.Extracted : null;
  }
  return patch;
}

/**
 * Reads the document's date, and a receipt's vendor, total and currency, from its text. After
 * every step that produces text, and before `index`, though nothing the index does reads them:
 * see step-list.ts for why it is not last.
 */
export const metadataStep: PipelineStep = {
  name: 'metadata',
  enabled: () => true,
  async run({ doc, storage, config }) {
    const content = doc.contentKey ? await text(await storage.text.getStream(doc.contentKey)) : '';
    const receipt = mayBeReceipt(doc) ? await RECEIPT_EXTRACTOR(content) : NO_RECEIPT;
    return metadataPatch(doc, content, config, new Date().toISOString().slice(0, 10), receipt);
  },
};

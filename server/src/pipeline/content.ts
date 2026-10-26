import type { Document } from '@cubicecho/engrafo-db';
import { ContentFormat } from '@cubicecho/engrafo-db/schema';
import { type StorageSet, textKey } from '../storage/s3.ts';
import { hasHeadings } from './mime.ts';
import type { DocumentPatch } from './types.ts';

/**
 * Puts extracted text in the text bucket.
 *
 * @param storage - The two buckets; only `text` is written.
 * @param doc - The document the text came from, which names the key.
 * @param content - The extracted text, trimmed before it is stored.
 * @param format - How the text is written. Left out, it is the document type's: Markdown for the
 *   types whose text is stored with headings, plain for the rest. Only the vision step, whose
 *   output the admin chooses, says otherwise.
 * @returns What Postgres keeps: the key, the size in bytes and the format; the key and size null,
 *   and the format plain, when the text is empty.
 *
 * @remarks
 * Empty text stores nothing, so a document that yielded none has a null key rather than a
 * zero-length object.
 */
export async function storeContent(
  storage: StorageSet,
  doc: Document,
  content: string,
  format: ContentFormat = hasHeadings(doc.mimeType) ? ContentFormat.Markdown : ContentFormat.Plain,
): Promise<DocumentPatch> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { contentKey: null, contentBytes: null, contentFormat: ContentFormat.Plain };
  }

  const key = textKey(doc.userId, doc.id);
  await storage.text.put(key, trimmed, textContentType(format));
  return { contentKey: key, contentBytes: Buffer.byteLength(trimmed), contentFormat: format };
}

/**
 * The media type stored text is served as.
 *
 * @param format - How it is written.
 * @returns `text/markdown` or `text/plain`, both UTF-8, which is all `storeContent` writes.
 */
export function textContentType(format: ContentFormat): string {
  return format === ContentFormat.Markdown ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';
}

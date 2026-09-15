import type { Document } from '@cubicecho/engrafo-db';
import { type StorageSet, textKey } from '../storage/s3.ts';
import type { DocumentPatch } from './types.ts';

/**
 * Puts extracted text in the text bucket and hands back what Postgres keeps: the
 * key and the byte count. Empty text stores nothing, so a document that yielded
 * none has a null key rather than a zero-length object.
 */
export async function storeContent(storage: StorageSet, doc: Document, content: string): Promise<DocumentPatch> {
  const trimmed = content.trim();
  if (!trimmed) return { contentKey: null, contentBytes: null };

  const key = textKey(doc.userId, doc.id);
  await storage.text.put(key, trimmed, 'text/plain; charset=utf-8');
  return { contentKey: key, contentBytes: Buffer.byteLength(trimmed) };
}

import { text } from 'node:stream/consumers';
import type { DB } from '@cubicecho/engrafo-db';
import { type Document, documentChunks } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { SEARCH_DEFAULTS } from '../core/defaults.ts';
import { hasHeadings } from '../pipeline/mime.ts';
import type { StorageSet } from '../storage/s3.ts';
import { chunkSections, chunkText, embeddingText, type Passage } from './chunk.ts';
import type { Embedder } from './embedder.ts';

/**
 * Replaces a document's passages in the search index with ones cut from its current text.
 *
 * @param deps - Where the text is, where the index is, and what embeds it.
 * @param doc - The document as the earlier steps left it.
 * @returns How many passages it now has. Zero for a document with no text, which is then
 *   findable by title alone.
 *
 * @remarks
 * Embedding happens before the transaction, which only swaps the rows: a search running
 * meanwhile sees the old passages or the new ones, never none.
 */
export async function indexDocument(
  { db, storage, embedder }: { db: DB; storage: StorageSet; embedder: Embedder },
  doc: Document,
): Promise<number> {
  const content = doc.contentKey ? await text(await storage.text.getStream(doc.contentKey)) : '';
  // Only Markdown and an ebook's text are written with headings. A scan's line that happens to
  // start with "# " is just a line.
  const passages: Passage[] = hasHeadings(doc.mimeType)
    ? chunkSections(content, SEARCH_DEFAULTS.chunkMaxChars)
    : chunkText(content, SEARCH_DEFAULTS.chunkMaxChars).map((passage) => ({ heading: null, content: passage }));
  const vectors =
    passages.length > 0
      ? await embedder.embed(passages.map((p) => embeddingText(doc.title, p.content, p.heading)))
      : [];

  await db.transaction(async (tx) => {
    await tx.delete(documentChunks).where(eq(documentChunks.documentId, doc.id));
    if (passages.length > 0) {
      await tx.insert(documentChunks).values(
        passages.map(({ content }, position) => ({
          userId: doc.userId,
          documentId: doc.id,
          position,
          content,
          embedding: vectors[position] ?? [],
          embeddingModel: embedder.model,
        })),
      );
    }
  });
  return passages.length;
}

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus, documents } from '@cubicecho/engrafo-db/schema';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { DOCUMENT_DEFAULTS, MERGE_DEFAULTS } from '../core/defaults.ts';
import { badInput, conflict, notFound } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import {
  completePendingDocument,
  createUploadSchema,
  insertPendingDocument,
  titleSchema,
} from '../documents/create.ts';
import { freeName, lockNames, ownedParent } from '../folders/names.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import { pngHasTransparency, toOpaquePng } from '../pipeline/image.ts';
import { isOcrable, needsPngForOcr } from '../pipeline/mime.ts';
import type { StorageSet } from '../storage/s3.ts';
import { notTrashed, trashDocument } from '../trash/trash.ts';
import { type MergePart, MergeRefusedError, mergeToPdf } from './pdf.ts';

// Merging is a way a document comes into being, so it goes the one way every other does: the
// merged PDF is built on the server, then filed with `insertPendingDocument`, stored, and handed to
// `completePendingDocument`, as the watched folder files a file. The name rule, the checksum and
// the whole pipeline come with that — OCR reads only the pages that have no text yet
// (`--skip-text`), and the merged text is indexed for search like any upload's.
//
// The originals are kept unless the caller says otherwise, and then they go to the trash, not
// away: a merge that put pages in the wrong order is undone by restoring them.

const PDF_MIME_TYPE = 'application/pdf';

/** What `mergeDocuments` is asked to do. */
export const mergeInputSchema = z.object({
  ids: z
    .array(z.uuid('That is not a document id.'))
    .min(2, 'Choose at least two documents to merge.')
    .max(MERGE_DEFAULTS.maxDocuments, `Merge at most ${MERGE_DEFAULTS.maxDocuments} documents at a time.`)
    .refine((ids) => new Set(ids).size === ids.length, 'A document is listed twice.'),
  title: titleSchema,
  folderId: z.string().optional().nullable(),
  trashOriginals: z.boolean().optional().nullable(),
});

/** A merge request, as `mergeInputSchema` parses it. */
export type MergeInput = z.infer<typeof mergeInputSchema>;

/** What a merge reaches: the database, the buckets, and the pipeline it hands the result to. */
export interface MergeDeps {
  db: DB;
  storage: StorageSet;
  events: PipelineEvents;
}

/**
 * The caller's documents, in the order asked for, each one a merge can take.
 *
 * @throws NOT_FOUND when any is not the caller's, is in the trash or never finished uploading;
 *   BAD_USER_INPUT when one has no pages (text, Markdown, CSV, HTML, an EPUB); CONFLICT when one is
 *   still being processed, since its searchable PDF is not written yet.
 */
async function loadSources(db: DB, userId: string, ids: readonly string[]): Promise<Document[]> {
  const rows = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        inArray(documents.id, [...ids]),
        notTrashed(),
        ne(documents.status, DocumentStatus.PendingUpload),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const doc = byId.get(id);
    if (!doc) {
      throw notFound('Document not found');
    }
    if (isOcrable(doc.mimeType) === false) {
      throw badInput(`“${doc.title}” cannot be merged: only PDFs and images have pages.`);
    }
    if (doc.status !== DocumentStatus.Ready && doc.status !== DocumentStatus.Failed) {
      throw conflict(`“${doc.title}” is still being processed. Merge it once it is ready.`);
    }
    return doc;
  });
}

/**
 * One document's pages, downloaded into `dir`: its OCR archive when it has one, which is the
 * searchable, straightened copy, else the original. An image with transparency, a WebP or a GIF
 * is laid on white first, as OCR does, since img2pdf refuses an alpha channel.
 */
async function preparePart(storage: StorageSet, doc: Document, dir: string, index: number): Promise<MergePart> {
  if (doc.archiveKey || doc.mimeType === PDF_MIME_TYPE) {
    const path = join(dir, `${index}.pdf`);
    await storage.files.download(doc.archiveKey ?? doc.originalKey, path);
    return { path, kind: 'pdf', title: doc.title };
  }
  const path = join(dir, `${index}.image`);
  await storage.files.download(doc.originalKey, path);
  if (needsPngForOcr(doc.mimeType) || (doc.mimeType === 'image/png' && (await pngHasTransparency(path)))) {
    const png = join(dir, `${index}.png`);
    await toOpaquePng(path, png);
    return { path: png, kind: 'image', title: doc.title };
  }
  return { path, kind: 'image', title: doc.title };
}

/** A file's size and sha256, read once. */
async function fingerprint(path: string): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return { sizeBytes: (await stat(path)).size, sha256: hash.digest('hex') };
}

/**
 * Merges the caller's PDFs and images, in the order given, into one PDF filed as a new document.
 *
 * @param deps - The database, the buckets and the pipeline.
 * @param userId - The caller.
 * @param raw - The request, unparsed: `ids` in page order, the new `title`, the `folderId` to file
 *   it in (null or left out for the top level) and whether to put the originals in the trash.
 * @returns The new document, queued for processing.
 * @throws BAD_USER_INPUT for a request that breaks the rules above, a source that cannot be read, or
 *   a result past `MAX_UPLOAD_BYTES`; NOT_FOUND and CONFLICT as `loadSources` says.
 *
 * @remarks
 * The title is numbered like an upload's when something in the folder has it. When the originals
 * go to the trash, the one whose name the merged copy was numbered around is gone, so the merged
 * copy takes the title asked for after all.
 */
export async function mergeDocuments(deps: MergeDeps, userId: string, raw: unknown): Promise<Document> {
  const { db, storage, events } = deps;
  const input = parseOrThrow(mergeInputSchema, raw);
  const sources = await loadSources(db, userId, input.ids);
  // Asked before any bytes move, so a folder that is not the caller's costs nothing.
  const folderId = await ownedParent(db, userId, input.folderId);

  const dir = await mkdtemp(join(tmpdir(), 'engrafo-merge-'));
  try {
    const parts: MergePart[] = [];
    for (const [index, doc] of sources.entries()) {
      parts.push(await preparePart(storage, doc, dir, index));
    }
    const output = join(dir, 'merged.pdf');
    try {
      await mergeToPdf(parts, output);
    } catch (error) {
      if (error instanceof MergeRefusedError) {
        throw badInput(`Could not merge ${error.message}`);
      }
      throw error;
    }

    const { sizeBytes, sha256 } = await fingerprint(output);
    const upload = parseOrThrow(createUploadSchema(), {
      filename: `${input.title}.pdf`,
      mimeType: PDF_MIME_TYPE,
      sizeBytes,
      title: input.title,
      folderId,
      // Asked for on any source, it is wanted on the pages that came from it.
      ocr: sources.some((doc) => doc.ocrRequested),
    });
    const pending = await insertPendingDocument(db, userId, upload, sha256);
    let filed: Document;
    try {
      await storage.files.putFile(pending.originalKey, output, PDF_MIME_TYPE);
      filed = (await completePendingDocument(db, storage, events, pending)) ?? pending;
    } catch (error) {
      // Never a half-filed document: the row is the server's own, so it is taken back.
      await storage.files.delete([pending.originalKey]);
      await db.delete(documents).where(eq(documents.id, pending.id));
      throw error;
    }

    if (input.trashOriginals !== true) {
      return filed;
    }
    return db.transaction(async (tx) => {
      await lockNames(tx, userId);
      for (const doc of sources) {
        await trashDocument(tx, doc);
      }
      if (filed.title === input.title) {
        return filed;
      }
      const free = await freeName(tx, userId, filed.folderId, input.title, DOCUMENT_DEFAULTS.titleMaxLength);
      if (free !== input.title) {
        return filed;
      }
      const [renamed] = await tx.update(documents).set({ title: free }).where(eq(documents.id, filed.id)).returning();
      return renamed ?? filed;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus, documents } from '@cubicecho/engrafo-db/schema';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lte, type SQL, sql } from 'drizzle-orm';
import type { GraphQLError } from 'graphql';
import { DOCUMENT_DEFAULTS } from '../core/defaults.ts';
import { notFound } from '../core/errors.ts';
import { freeName, lockNames, type Tx } from '../folders/names.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import type { StorageSet } from '../storage/s3.ts';

// The trash. Deleting a document stamps `deleted_at` and nothing else: its row, its objects in
// both buckets and its search passages all stay, so a restore is one column back to null and the
// document is exactly as it was, searchable at once. Every read outside this file leaves a trashed
// row out — the generated ones through `scope` in tenancy.ts, the hand-written ones through
// `notTrashed()` — and the objects go only when the document is purged: by hand, by emptying the
// trash, or by `purgeExpired` once it has sat there for the retention period.

/**
 * The condition every read of `documents` outside the trash ANDs in: filed documents only.
 *
 * @returns `deleted_at is null`.
 */
export function notTrashed(): SQL {
  return isNull(documents.deletedAt);
}

/** Hides a missing document, someone else's and one not in the trash behind one answer. */
export function trashedNotFound(): GraphQLError {
  return notFound('Document not found in the trash');
}

/**
 * Deletes every object the documents have, in both buckets.
 *
 * @param storage - The buckets.
 * @param docs - The documents whose files go. Their rows are the caller's to delete, afterwards.
 *
 * @remarks
 * Objects before rows: a row without its file is visible and fixable by deleting again, while a
 * file without its row is invisible storage nobody pays attention to.
 */
export async function deleteStoredFiles(storage: StorageSet, docs: readonly Document[]): Promise<void> {
  await storage.files.delete(
    docs.flatMap((doc) => [doc.originalKey, doc.archiveKey]).filter((key): key is string => Boolean(key)),
  );
  await storage.text.delete(docs.map((doc) => doc.contentKey).filter((key): key is string => Boolean(key)));
}

/**
 * Puts one filed document in the trash. Its folder is kept, so a restore puts it back there.
 *
 * @param db - The connection.
 * @param doc - The document, already loaded as the caller's.
 */
export async function trashDocument(db: DB | Tx, doc: Document): Promise<void> {
  await db
    .update(documents)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(documents.id, doc.id), notTrashed()));
}

/**
 * Takes every document out of folders that are about to be deleted: the filed ones go to the
 * trash, and those already there lose their folder too, so the folder rows can go
 * (`folder_id` is ON DELETE RESTRICT). A restore files them at the top level.
 *
 * @param tx - The transaction the folders are deleted in, holding `lockNames`.
 * @param userId - The caller.
 * @param folderIds - The folder and everything under it.
 */
export async function trashFolderContents(tx: Tx, userId: string, folderIds: readonly string[]): Promise<void> {
  if (folderIds.length === 0) {
    return;
  }
  await tx
    .update(documents)
    .set({ folderId: null, deletedAt: sql`coalesce(${documents.deletedAt}, now())` })
    .where(and(eq(documents.userId, userId), inArray(documents.folderId, [...folderIds])));
}

/**
 * The caller's trash, most recently deleted first.
 *
 * @param db - The connection.
 * @param userId - Whose.
 */
export async function trashedDocuments(db: DB, userId: string): Promise<Document[]> {
  return db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), isNotNull(documents.deletedAt)))
    .orderBy(desc(documents.deletedAt), asc(documents.title));
}

/**
 * How many documents the caller has in the trash.
 *
 * @param db - The connection.
 * @param userId - Whose.
 */
export async function trashCount(db: DB, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(documents)
    .where(and(eq(documents.userId, userId), isNotNull(documents.deletedAt)));
  return row?.n ?? 0;
}

/**
 * Takes a document out of the trash, back into the folder it was in, or the top level when that
 * folder was deleted with it. Its name is numbered (`scan (2)`) when something has taken it since.
 * A document trashed before its pipeline finished is sent through it again from where it stopped.
 *
 * @param deps - The database and the events the pipeline listens on.
 * @param userId - The caller.
 * @param id - The document, which must be the caller's and in the trash, or NOT_FOUND.
 * @returns The restored document.
 */
export async function restoreDocument(
  { db, events }: { db: DB; events: PipelineEvents },
  userId: string,
  id: string,
): Promise<Document> {
  const restored = await db.transaction(async (tx) => {
    await lockNames(tx, userId);
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId), isNotNull(documents.deletedAt)));
    if (!doc) {
      throw trashedNotFound();
    }
    const title = await freeName(tx, userId, doc.folderId, doc.title, DOCUMENT_DEFAULTS.titleMaxLength);
    const [updated] = await tx
      .update(documents)
      .set({ deletedAt: null, title })
      .where(eq(documents.id, doc.id))
      .returning();
    return updated;
  });
  // The runner skips a trashed document, so one trashed mid-pipeline stopped where it was.
  if (restored.status === DocumentStatus.Uploaded || restored.status === DocumentStatus.Processing) {
    events.emit('document.uploaded', { documentId: restored.id });
  }
  return restored;
}

/**
 * Deletes trashed documents for good: their objects in both buckets, then their rows, which take
 * their steps and search passages with them.
 *
 * @param deps - The database and the buckets.
 * @param where - Which trashed documents: the caller's, one of them, or every one deleted before a time.
 * @returns How many were purged.
 *
 * @remarks
 * One transaction, with the rows locked before their objects are deleted, so a restore of one of
 * them either finishes first, and it is no longer in the trash to purge, or waits and finds it gone.
 */
export async function purgeTrash(
  { db, storage }: { db: DB; storage: StorageSet },
  where: { userId?: string; id?: string; deletedBefore?: Date },
): Promise<number> {
  return db.transaction(async (tx) => {
    const doomed = await tx
      .select()
      .from(documents)
      .where(
        and(
          isNotNull(documents.deletedAt),
          where.userId === undefined ? undefined : eq(documents.userId, where.userId),
          where.id === undefined ? undefined : eq(documents.id, where.id),
          where.deletedBefore === undefined ? undefined : lte(documents.deletedAt, where.deletedBefore),
        ),
      )
      .for('update');
    if (doomed.length === 0) {
      return 0;
    }
    await deleteStoredFiles(storage, doomed);
    await tx.delete(documents).where(
      inArray(
        documents.id,
        doomed.map((doc) => doc.id),
      ),
    );
    return doomed.length;
  });
}

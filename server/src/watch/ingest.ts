import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus, documents, folders } from '@cubicecho/engrafo-db/schema';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { GraphQLError } from 'graphql';
import { maxUploadBytes } from '../core/config.ts';
import { errorMessage } from '../core/errors.ts';
import { BYTES_PER_MEBIBYTE } from '../core/wire.ts';
import { completePendingDocument, createUploadSchema, insertPendingDocument } from '../documents/create.ts';
import { assertNameFree, folderNameSchema, lockNames } from '../folders/names.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import {
  ACCEPTED_MIME_TYPES,
  CSV_MIME_TYPE,
  HTML_MIME_TYPE,
  isAcceptedMimeType,
  MARKDOWN_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
  SNIFF_BYTES,
  sniffMimeType,
} from '../pipeline/mime.ts';
import type { StorageSet } from '../storage/s3.ts';
import type { WatchedFile } from './files.ts';

// One file from the watched directory into the archive, through the same two
// calls a browser upload makes: insert the pending row, store the object, then
// `completePendingDocument` heads it and starts the pipeline. The difference is
// who PUTs the bytes — here the server's own client, from the file on disk.
//
// The file's sha256 goes into the row before its bytes are stored, which is
// what makes a crash harmless. Died after the insert: the next pass finds the
// pending row by checksum and finishes it. Died after completing, before the
// delete: the next pass finds a filed document with that checksum and only
// removes the file. Either way the archive gets the file once.

/**
 * A file that will not be filed as it is: of a type the pipeline cannot read, too large, empty,
 * or in a directory whose name cannot be a folder's. It stays where it is, and is tried again
 * only once it changes.
 */
export class Rejected extends Error {}

/** What filing a file needs. */
export interface IngestDeps {
  db: DB;
  storage: StorageSet;
  events: PipelineEvents;
}

/** What became of a file. */
export type IngestResult =
  /** Filed as a new document, which the pipeline now has. */
  | { kind: 'filed'; doc: Document }
  /** Its bytes were already in the archive, so nothing was added. */
  | { kind: 'duplicate'; doc: Document }
  /** Shutdown began before anything was written. */
  | { kind: 'stopped' };

/** The types with no magic bytes, by the extension that says them. */
const TEXT_EXTENSIONS: Record<string, string> = {
  '.txt': PLAIN_TEXT_MIME_TYPE,
  '.md': MARKDOWN_MIME_TYPE,
  '.markdown': MARKDOWN_MIME_TYPE,
  '.csv': CSV_MIME_TYPE,
  '.html': HTML_MIME_TYPE,
  '.htm': HTML_MIME_TYPE,
};

/**
 * Reads a file once, for its sha256 and the bytes its type is sniffed from.
 *
 * @param path - The file.
 * @returns The hex digest and the first `SNIFF_BYTES` bytes.
 */
async function readFingerprint(path: string): Promise<{ sha256: string; head: Buffer }> {
  const hash = createHash('sha256');
  const head: Buffer[] = [];
  let headLength = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer: Buffer = chunk;
    hash.update(buffer);
    if (headLength < SNIFF_BYTES) {
      head.push(buffer);
      headLength += buffer.length;
    }
  }
  return { sha256: hash.digest('hex'), head: Buffer.concat(head) };
}

/**
 * The folder a file's directories stand for, made where missing. The import rebuilds a backup's folders
 * with it too.
 *
 * @param db - The database.
 * @param userId - Whose folders.
 * @param dirs - The directory names from the watched directory down, outermost first.
 * @returns The innermost folder's id, or null for a file at the top.
 * @throws {@link Rejected} when a name breaks the folder name rule, or a document already has it.
 *
 * @remarks
 * An existing folder is matched ignoring case, as every name here is. Under the name lock, so a
 * folder the app makes at the same moment is either seen here or waits for this to finish.
 */
export async function ensureFolders(db: DB, userId: string, dirs: readonly string[]): Promise<string | null> {
  if (dirs.length === 0) {
    return null;
  }
  return db.transaction(async (tx) => {
    await lockNames(tx, userId);
    let parentId: string | null = null;
    for (const dir of dirs) {
      const parsed = folderNameSchema.safeParse(dir);
      if (parsed.success === false) {
        throw new Rejected(`"${dir}" cannot be a folder's name: ${parsed.error.issues[0]?.message}`);
      }
      const name = parsed.data;
      const [existing] = await tx
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.userId, userId),
            parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId),
            eq(sql`lower(${folders.name})`, name.toLowerCase()),
          ),
        );
      if (existing) {
        parentId = existing.id;
        continue;
      }
      try {
        await assertNameFree(tx, userId, parentId, name);
      } catch (error) {
        throw new Rejected(`folder "${name}": ${errorMessage(error)}`);
      }
      const [created]: { id: string }[] = await tx
        .insert(folders)
        .values({ userId, parentId, name })
        .returning({ id: folders.id });
      parentId = created.id;
    }
    return parentId;
  });
}

/**
 * Files one file from the watched directory into a user's archive. The file itself is left
 * alone; removing it is the caller's call, once this has resolved.
 *
 * @param deps - The database, the buckets and the pipeline's events.
 * @param userId - Whose archive.
 * @param file - The file, as the listing saw it.
 * @param isStopping - Asked before anything is written, so shutdown does not start a file.
 * @returns What became of it.
 * @throws {@link Rejected} for a file that will not be filed as it is. Anything else is a
 *   failure worth trying again (storage or the database being unreachable).
 */
export async function ingestFile(
  deps: IngestDeps,
  userId: string,
  file: WatchedFile,
  isStopping: () => boolean,
): Promise<IngestResult> {
  const { db, storage, events } = deps;
  if (file.sizeBytes === 0) {
    throw new Rejected('the file is empty');
  }
  const max = maxUploadBytes();
  if (file.sizeBytes > max) {
    // Before reading it: hashing a file only to refuse it is wasted minutes on a NAS.
    throw new Rejected(`the file is larger than the ${Math.floor(max / BYTES_PER_MEBIBYTE)} MiB limit`);
  }

  const { sha256, head } = await readFingerprint(file.path);
  const claimed = TEXT_EXTENSIONS[extname(file.name).toLowerCase()] ?? '';
  const mimeType = await sniffMimeType(head, claimed);
  if (mimeType === null || isAcceptedMimeType(mimeType) === false) {
    throw new Rejected(
      `unsupported file type${mimeType ? ` (${mimeType})` : ''}; accepted: ${ACCEPTED_MIME_TYPES.join(', ')}`,
    );
  }
  const parsed = createUploadSchema().safeParse({ filename: file.name, mimeType, sizeBytes: file.sizeBytes });
  if (parsed.success === false) {
    throw new Rejected(parsed.error.issues[0]?.message ?? 'invalid file');
  }

  const known = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.checksumSha256, sha256)))
    .orderBy(asc(documents.createdAt));
  const filed = known.find((doc) => doc.status !== DocumentStatus.PendingUpload);
  if (filed) {
    return { kind: 'duplicate', doc: filed };
  }
  if (isStopping()) {
    return { kind: 'stopped' };
  }

  // A pending row with this checksum is this watcher's own, from a pass that
  // stopped partway: finish it rather than add a second.
  const doc =
    known[0] ??
    (await insertPendingDocument(
      db,
      userId,
      { ...parsed.data, folderId: await ensureFolders(db, userId, file.dirs) },
      sha256,
    ));

  await storage.files.putFile(doc.originalKey, file.path, mimeType);
  try {
    const completed = await completePendingDocument(db, storage, events, doc);
    if (completed) {
      return { kind: 'filed', doc: completed };
    }
  } catch (error) {
    if (error instanceof GraphQLError) {
      // The object is not the size the row says: the file changed under the
      // copy. Forget this attempt; the file's new bytes are a new attempt.
      await storage.files.delete([doc.originalKey]);
      await db.delete(documents).where(eq(documents.id, doc.id));
      throw new Error(`the file changed while it was being stored (${error.message})`);
    }
    throw error;
  }
  // Another pass completed it first.
  const [current] = await db.select().from(documents).where(eq(documents.id, doc.id));
  return { kind: 'filed', doc: current ?? doc };
}

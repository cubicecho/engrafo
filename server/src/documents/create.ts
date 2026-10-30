import { randomUUID } from 'node:crypto';
import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus, documents, processingSteps } from '@cubicecho/engrafo-db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { maxUploadBytes, ocrDefault } from '../core/config.ts';
import { DOCUMENT_DEFAULTS, FOLDER_DEFAULTS } from '../core/defaults.ts';
import { badInput } from '../core/errors.ts';
import { BYTES_PER_MEBIBYTE } from '../core/wire.ts';
import { ensureFolderPath, freeName, lockNames, ownedParent } from '../folders/names.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import { ACCEPTED_MIME_TYPES, isAcceptedMimeType } from '../pipeline/mime.ts';
import { STEPS } from '../pipeline/step-list.ts';
import { originalKey, type StorageSet } from '../storage/s3.ts';

// How a document comes into being, whoever brings the bytes. The browser path
// (`createDocumentUpload` + a presigned PUT + `completeDocumentUpload`) and the
// watched folder (a PUT with the server's own client) both go through these two
// functions, so the row, the name rule and the check that the object landed are
// written once.

// A title is also the document's name in its folder, and a `/` in it would draw
// as a folder in the tree.
export const titleSchema = z
  .string()
  .trim()
  .min(1, 'Title cannot be empty.')
  .max(DOCUMENT_DEFAULTS.titleMaxLength, 'Title is too long.')
  .refine((title) => title.includes('/') === false, 'A title cannot contain "/".');

/**
 * What a new document has to declare before its bytes exist. Built per call, since
 * `MAX_UPLOAD_BYTES` is read at call time.
 *
 * @returns The schema `createDocumentUpload`'s input and the watcher's files are both checked with.
 */
export function createUploadSchema() {
  const max = maxUploadBytes();
  return z.object({
    filename: z
      .string()
      .trim()
      .min(1, 'Filename cannot be empty.')
      .max(DOCUMENT_DEFAULTS.filenameMaxLength, 'Filename is too long.'),
    mimeType: z.string().refine(isAcceptedMimeType, {
      message: `Unsupported file type. Accepted: ${ACCEPTED_MIME_TYPES.join(', ')}.`,
    }),
    sizeBytes: z
      .number()
      .int()
      .positive('The file is empty.')
      .max(max, `The file is larger than the ${Math.floor(max / BYTES_PER_MEBIBYTE)} MiB limit.`),
    title: titleSchema.optional().nullable(),
    ocr: z.boolean().optional().nullable(),
    folderId: z.string().optional().nullable(),
    // A folder upload's directories, under `folderId`. Each name is checked as it is made.
    folderPath: z
      .array(z.string())
      .max(FOLDER_DEFAULTS.uploadPathMaxDepth, 'The folder is nested too deeply.')
      .optional()
      .nullable(),
  });
}

/** A new document's declaration, as `createUploadSchema` parses it. */
export type UploadInput = z.infer<ReturnType<typeof createUploadSchema>>;

/**
 * The title a file gets when none is given: its name without the extension.
 *
 * @param filename - The file's name.
 * @returns A title with no `/`, cut to the longest a title may be.
 */
export function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, '');
  return (withoutExtension || filename).replaceAll('/', '-').slice(0, DOCUMENT_DEFAULTS.titleMaxLength);
}

/**
 * Inserts a `pending_upload` row for a file that is about to be stored.
 *
 * @param db - The database.
 * @param userId - Whose archive it goes into.
 * @param input - The declaration, already parsed with `createUploadSchema`.
 * @param [checksumSha256] - The file's sha256, when the server has read the file itself. The
 *   inspect step writes the same value again; the watcher sets it early so a file it was filing
 *   when the process died is recognised on the next pass.
 * @returns The row. Its `originalKey` is where the bytes go.
 *
 * @remarks
 * Under the caller's name lock: a clash with something in the folder gets a number rather than a
 * refusal, since the same filename twice is an everyday upload.
 */
export async function insertPendingDocument(
  db: DB,
  userId: string,
  input: UploadInput,
  checksumSha256: string | null = null,
): Promise<Document> {
  const id = randomUUID();
  return db.transaction(async (tx) => {
    await lockNames(tx, userId);
    // Made in the same transaction as the row, so a refused upload leaves no empty folder behind.
    const folderId = await ensureFolderPath(
      tx,
      userId,
      await ownedParent(tx, userId, input.folderId),
      input.folderPath ?? [],
    );
    const title = await freeName(
      tx,
      userId,
      folderId,
      input.title ?? titleFromFilename(input.filename),
      DOCUMENT_DEFAULTS.titleMaxLength,
    );
    const [inserted] = await tx
      .insert(documents)
      .values({
        id,
        userId,
        folderId,
        title,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksumSha256,
        originalKey: originalKey(userId, id),
        ocrRequested: input.ocr ?? ocrDefault(),
        status: DocumentStatus.PendingUpload,
      })
      .returning();
    return inserted;
  });
}

/**
 * Turns a `pending_upload` row into a document: checks the object really landed, at the size
 * declared, then queues its steps and starts the pipeline.
 *
 * @param db - The database.
 * @param storage - The buckets.
 * @param events - What the pipeline listens on.
 * @param doc - The pending row, as read.
 * @returns The updated row, or null when another call completed it first.
 * @throws BAD_USER_INPUT when the object is missing or its size is not the one declared.
 *
 * @remarks
 * The row was written on the uploader's word and the object is the only evidence, so it is
 * headed again here whoever uploaded it.
 */
export async function completePendingDocument(
  db: DB,
  storage: StorageSet,
  events: PipelineEvents,
  doc: Document,
): Promise<Document | null> {
  const stored = await storage.files.head(doc.originalKey);
  if (!stored) {
    throw badInput('The upload has not arrived yet.');
  }
  if (stored.size !== doc.sizeBytes) {
    throw badInput(`The stored file is ${stored.size} bytes, but the upload declared ${doc.sizeBytes}.`);
  }

  // Conditional on the status it was read with, so two concurrent completes
  // start the pipeline once.
  const [updated] = await db
    .update(documents)
    .set({ status: DocumentStatus.Uploaded })
    .where(and(eq(documents.id, doc.id), eq(documents.status, DocumentStatus.PendingUpload)))
    .returning();
  if (!updated) {
    return null;
  }

  await db
    .insert(processingSteps)
    .values(STEPS.map((step, position) => ({ userId: doc.userId, documentId: doc.id, step: step.name, position })))
    .onConflictDoNothing();

  events.emit('document.uploaded', { documentId: doc.id });
  return updated;
}

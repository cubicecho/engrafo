import { randomUUID } from 'node:crypto';
import {
  type Document,
  DocumentStatus,
  documentChunks,
  documents,
  processingSteps,
  StepStatus,
} from '@cubicecho/engrafo-db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLError, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import { maxUploadBytes, ocrDefault, version } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { DOCUMENT_DEFAULTS } from '../core/defaults.ts';
import { badInput, conflict, notFound, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { BYTES_PER_MEBIBYTE } from '../core/wire.ts';
import { assertNameFree, freeName, lockNames, ownedParent, type Tx } from '../folders/names.ts';
import { ACCEPTED_MIME_TYPES, isAcceptedMimeType } from '../pipeline/mime.ts';
import { STEPS } from '../pipeline/step-list.ts';
import { originalKey, type StorageSet } from '../storage/s3.ts';

// Every write to a document. Reads — `documents`, `document`, and the
// `processingSteps` relation — are generated and scoped in tenancy.ts.
//
// An upload is two calls around a browser-to-S3 PUT the server never sees:
// `createDocumentUpload` picks the key and signs a URL for exactly that file,
// `completeDocumentUpload` checks the object really landed and starts the
// pipeline. The row exists from the first call so the key is the server's to
// choose — a client naming its own key could overwrite someone else's object.

const DOCUMENTS_SDL = parse(`
  enum DocumentFileVariant {
    "The file as uploaded."
    ORIGINAL
    "The OCR'd PDF/A, when OCR ran."
    ARCHIVE
    "The extracted plain text, when there is any."
    TEXT
  }

  input CreateDocumentUploadInput {
    filename: String!
    mimeType: String!
    sizeBytes: Float!
    "Defaults to the filename without its extension."
    title: String
    "Defaults to the instance's OCR_DEFAULT."
    ocr: Boolean
    "The folder to file it in. Left out, the top level."
    folderId: UUID
  }

  type HttpHeader {
    name: String!
    value: String!
  }

  type DocumentUpload {
    document: Document!
    "PUT the file body here, with \`uploadHeaders\`, then call completeDocumentUpload."
    uploadUrl: String!
    uploadHeaders: [HttpHeader!]!
  }

  type ServerConfig {
    "The release this instance is running."
    version: String!
    maxUploadBytes: Float!
    acceptedMimeTypes: [String!]!
    "Whether the ocr step can run here: enabled, and ocrmypdf installed."
    ocrAvailable: Boolean!
    ocrDefault: Boolean!
  }

  extend type Query {
    serverConfig: ServerConfig!
    "A short-lived URL for one of a document's files."
    documentFileUrl(id: UUID!, variant: DocumentFileVariant! = ORIGINAL, download: Boolean! = false): String!
  }

  extend type Mutation {
    createDocumentUpload(input: CreateDocumentUploadInput!): DocumentUpload!
    "Confirms the PUT landed and starts processing. Safe to call twice."
    completeDocumentUpload(id: UUID!): Document!
    "Re-runs a failed document from the step that failed."
    retryDocumentProcessing(id: UUID!): Document!
    """
    Runs every step again on a document that is ready or failed, as if it had just been uploaded.
    \`ocr\` turns OCR on or off for this and later runs; left out, the document keeps its setting.
    """
    reprocessDocument(id: UUID!, ocr: Boolean): Document!
    "Renames the document. Refused when something in its folder already has the title."
    renameDocument(id: UUID!, title: String!): Document!
    "Files the document in another folder, or at the top level when \`folderId\` is null."
    moveDocument(id: UUID!, folderId: UUID): Document!
    "Deletes the document and its stored files."
    deleteDocument(id: UUID!): Boolean!
  }
`);

/** The values of the SDL's `DocumentFileVariant`, by name. */
const DocumentFileVariant = {
  Original: 'ORIGINAL',
  Archive: 'ARCHIVE',
  Text: 'TEXT',
} as const;
type DocumentFileVariant = (typeof DocumentFileVariant)[keyof typeof DocumentFileVariant];

/** Hides a missing document and someone else's behind one answer. */
function documentNotFound(): GraphQLError {
  return notFound('Document not found');
}

// A title is also the document's name in its folder, and a `/` in it would draw
// as a folder in the tree.
const titleSchema = z
  .string()
  .trim()
  .min(1, 'Title cannot be empty.')
  .max(DOCUMENT_DEFAULTS.titleMaxLength, 'Title is too long.')
  .refine((title) => title.includes('/') === false, 'A title cannot contain "/".');

function createUploadSchema() {
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
  });
}

function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, '');
  return (withoutExtension || filename).replaceAll('/', '-').slice(0, DOCUMENT_DEFAULTS.titleMaxLength);
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
 * A document the caller owns, or NOT_FOUND. Hand-written resolvers sit outside
 * the generated ones, so they do not inherit `scope` and have to state ownership
 * themselves.
 */
export async function loadOwned(context: Context, id: string, db: Context['db'] | Tx = context.db): Promise<Document> {
  const userId = requireAuth(context);
  if (!z.uuid().safeParse(id).success) {
    throw documentNotFound();
  }
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)));
  if (!doc) {
    throw documentNotFound();
  }
  return doc;
}

/**
 * Adds every document write to the schema, with `serverConfig` and `documentFileUrl`.
 *
 * @param schema - The generated schema, which must already have a Mutation type.
 * @returns The extended schema.
 *
 * @remarks
 * Hand-written resolvers do not inherit `scope`, so each one states ownership itself, through
 * `loadOwned` or `requireAuth`.
 */
export function applyDocumentsExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, DOCUMENTS_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();

  queries.serverConfig.resolve = (_parent: unknown, _args: unknown, context: Context) => ({
    version: version(),
    maxUploadBytes: maxUploadBytes(),
    acceptedMimeTypes: ACCEPTED_MIME_TYPES,
    ocrAvailable: context.ocrAvailable,
    ocrDefault: context.ocrAvailable && ocrDefault(),
  });

  queries.documentFileUrl.resolve = async (
    _parent: unknown,
    args: { id: string; variant: DocumentFileVariant; download: boolean },
    context: Context,
  ) => {
    const doc = await loadOwned(context, args.id);
    if (doc.status === DocumentStatus.PendingUpload) {
      throw documentNotFound();
    }
    if (args.variant === DocumentFileVariant.Archive) {
      if (!doc.archiveKey) {
        throw documentNotFound();
      }
      return context.storage.files.presignGet(doc.archiveKey, {
        filename: `${titleFromFilename(doc.originalFilename)}.pdf`,
        contentType: 'application/pdf',
        download: args.download,
      });
    }
    if (args.variant === DocumentFileVariant.Text) {
      // The text lives in its own bucket, so this URL is signed by the other
      // Storage — same credentials, different bucket in the path.
      if (!doc.contentKey) {
        throw documentNotFound();
      }
      return context.storage.text.presignGet(doc.contentKey, {
        filename: `${titleFromFilename(doc.originalFilename)}.txt`,
        contentType: 'text/plain; charset=utf-8',
        download: args.download,
      });
    }
    return context.storage.files.presignGet(doc.originalKey, {
      filename: doc.originalFilename,
      contentType: doc.mimeType,
      download: args.download,
    });
  };

  mutations.createDocumentUpload.resolve = async (_parent: unknown, args: { input: unknown }, context: Context) => {
    const userId = requireAuth(context);
    const input = parseOrThrow(createUploadSchema(), args.input);

    const id = randomUUID();
    const key = originalKey(userId, id);
    const doc = await context.db.transaction(async (tx) => {
      await lockNames(tx, userId);
      const folderId = await ownedParent(tx, userId, input.folderId);
      // A clash gets a number rather than a refusal: the same filename twice is
      // an everyday upload, and the title can be changed afterwards.
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
          originalKey: key,
          ocrRequested: input.ocr ?? ocrDefault(),
          status: DocumentStatus.PendingUpload,
        })
        .returning();
      return inserted;
    });

    const uploadUrl = await context.storage.files.presignPut(key, {
      contentType: input.mimeType,
      contentLength: input.sizeBytes,
    });
    return { document: doc, uploadUrl, uploadHeaders: [{ name: 'Content-Type', value: input.mimeType }] };
  };

  mutations.completeDocumentUpload.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const doc = await loadOwned(context, args.id);
    if (doc.status !== DocumentStatus.PendingUpload) {
      return doc;
    }

    const stored = await context.storage.files.head(doc.originalKey);
    if (!stored) {
      throw badInput('The upload has not arrived yet.');
    }
    if (stored.size !== doc.sizeBytes) {
      throw badInput(`The stored file is ${stored.size} bytes, but the upload declared ${doc.sizeBytes}.`);
    }

    const db = context.db;
    // Conditional on the status it was read with, so two concurrent completes
    // start the pipeline once.
    const [updated] = await db
      .update(documents)
      .set({ status: DocumentStatus.Uploaded })
      .where(and(eq(documents.id, doc.id), eq(documents.status, DocumentStatus.PendingUpload)))
      .returning();
    if (!updated) {
      return loadOwned(context, args.id);
    }

    await db
      .insert(processingSteps)
      .values(STEPS.map((step, position) => ({ userId: doc.userId, documentId: doc.id, step: step.name, position })))
      .onConflictDoNothing();

    context.events.emit('document.uploaded', { documentId: doc.id });
    return updated;
  };

  mutations.retryDocumentProcessing.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const doc = await loadOwned(context, args.id);
    if (doc.status !== DocumentStatus.Failed) {
      throw badInput('Only a failed document can be retried.');
    }

    // Claim the document first, and reset its steps only once the claim is won.
    // Two retries can both read `failed` above; the one that loses must not put
    // steps back to `queued` under the run the winner has already started. One
    // transaction, so a crash between the two leaves neither half behind.
    const updated = await context.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(documents)
        .set({ status: DocumentStatus.Uploaded, error: null })
        .where(and(eq(documents.id, doc.id), eq(documents.status, DocumentStatus.Failed)))
        .returning();
      if (!claimed) {
        return null;
      }
      await tx
        .update(processingSteps)
        .set({ status: StepStatus.Queued, error: null, startedAt: null, finishedAt: null })
        .where(and(eq(processingSteps.documentId, doc.id), eq(processingSteps.status, StepStatus.Failed)));
      return claimed;
    });
    if (updated === null) {
      return loadOwned(context, args.id);
    }

    context.events.emit('document.uploaded', { documentId: doc.id });
    return updated;
  };

  mutations.reprocessDocument.resolve = async (
    _parent: unknown,
    args: { id: string; ocr?: boolean | null },
    context: Context,
  ) => {
    const doc = await loadOwned(context, args.id);
    if (doc.status === DocumentStatus.PendingUpload) {
      throw badInput('The upload has not finished yet.');
    }
    if (doc.status !== DocumentStatus.Ready && doc.status !== DocumentStatus.Failed) {
      throw conflict('This document is already being processed.');
    }
    if (args.ocr === true && context.ocrAvailable === false) {
      throw badInput('OCR is not available on this server.');
    }
    const ocrRequested = typeof args.ocr === 'boolean' ? args.ocr : doc.ocrRequested;

    // Claimed and reset in one transaction, conditional on the status it was
    // read with, so two re-runs at once start one run, as with retry. What the
    // last run produced is forgotten: a run that now produces no archive or no
    // text must not leave the old one showing.
    const updated = await context.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(documents)
        .set({
          status: DocumentStatus.Uploaded,
          error: null,
          ocrRequested,
          archiveKey: null,
          contentKey: null,
          contentBytes: null,
        })
        .where(and(eq(documents.id, doc.id), inArray(documents.status, [DocumentStatus.Ready, DocumentStatus.Failed])))
        .returning();
      if (!claimed) {
        return null;
      }
      await tx
        .update(processingSteps)
        .set({ status: StepStatus.Queued, error: null, startedAt: null, finishedAt: null })
        .where(eq(processingSteps.documentId, doc.id));
      // Out of search until the index step puts the new text back.
      await tx.delete(documentChunks).where(eq(documentChunks.documentId, doc.id));
      return claimed;
    });
    if (updated === null) {
      return loadOwned(context, args.id);
    }

    // Before the run starts, since it writes its new files under the same keys.
    if (doc.archiveKey) {
      await context.storage.files.delete([doc.archiveKey]);
    }
    if (doc.contentKey) {
      await context.storage.text.delete([doc.contentKey]);
    }

    context.events.emit('document.uploaded', { documentId: doc.id });
    return updated;
  };

  mutations.renameDocument.resolve = async (
    _parent: unknown,
    args: { id: string; title: string },
    context: Context,
  ) => {
    const userId = requireAuth(context);
    const title = parseOrThrow(titleSchema, args.title);
    return context.db.transaction(async (tx) => {
      await lockNames(tx, userId);
      // Read under the lock, so the folder checked is the one it is in now.
      const doc = await loadOwned(context, args.id, tx);
      await assertNameFree(tx, userId, doc.folderId, title, { documentId: doc.id });
      const [updated] = await tx.update(documents).set({ title }).where(eq(documents.id, doc.id)).returning();
      return updated;
    });
  };

  mutations.moveDocument.resolve = async (
    _parent: unknown,
    args: { id: string; folderId?: string | null },
    context: Context,
  ) => {
    const userId = requireAuth(context);
    return context.db.transaction(async (tx) => {
      await lockNames(tx, userId);
      const doc = await loadOwned(context, args.id, tx);
      const folderId = await ownedParent(tx, userId, args.folderId);
      if (folderId === doc.folderId) {
        return doc;
      }
      await assertNameFree(tx, userId, folderId, doc.title, { documentId: doc.id });
      const [updated] = await tx.update(documents).set({ folderId }).where(eq(documents.id, doc.id)).returning();
      return updated;
    });
  };

  mutations.deleteDocument.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const doc = await loadOwned(context, args.id);
    await deleteStoredFiles(context.storage, [doc]);
    await context.db.delete(documents).where(eq(documents.id, doc.id));
    return true;
  };

  return extended;
}

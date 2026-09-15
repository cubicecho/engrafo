import { randomUUID } from 'node:crypto';
import { type Document, documents, processingSteps } from '@cubicecho/engrafo-db/schema';
import { and, eq } from 'drizzle-orm';
import { extendSchema, GraphQLError, type GraphQLObjectType, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import { maxUploadBytes, ocrDefault } from '../config.ts';
import type { Context } from '../context.ts';
import { STEPS } from '../pipeline/index.ts';
import { ACCEPTED_MIME_TYPES, isAcceptedMimeType } from '../pipeline/mime.ts';
import { originalKey } from '../storage/s3.ts';
import { requireAuth } from './auth.ts';

// Every write to a document. Reads — `documents`, `document`, and the
// `processingSteps` relation — are generated and scoped in tenancy.ts.
//
// An upload is two calls around a browser-to-S3 PUT the server never sees:
// `createDocumentUpload` picks the key and signs a URL for exactly that file,
// `completeDocumentUpload` checks the object really landed and starts the
// pipeline. The row exists from the first call so the key is the server's to
// choose — a client naming its own key could overwrite someone else's object.

// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 rc driver union
type AnyDb = any;

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
    renameDocument(id: UUID!, title: String!): Document!
    "Deletes the document and its stored files."
    deleteDocument(id: UUID!): Boolean!
  }
`);

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

function notFound(): GraphQLError {
  return new GraphQLError('Document not found', { extensions: { code: 'NOT_FOUND' } });
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badInput(result.error.issues[0]?.message ?? 'Invalid input');
  return result.data;
}

const titleSchema = z.string().trim().min(1, 'Title cannot be empty.').max(500, 'Title is too long.');

function createUploadSchema() {
  const max = maxUploadBytes();
  return z.object({
    filename: z.string().trim().min(1, 'Filename cannot be empty.').max(1000, 'Filename is too long.'),
    mimeType: z.string().refine(isAcceptedMimeType, {
      message: `Unsupported file type. Accepted: ${ACCEPTED_MIME_TYPES.join(', ')}.`,
    }),
    sizeBytes: z
      .number()
      .int()
      .positive('The file is empty.')
      .max(max, `The file is larger than the ${Math.floor(max / 1024 / 1024)} MiB limit.`),
    title: titleSchema.optional().nullable(),
    ocr: z.boolean().optional().nullable(),
  });
}

function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, '');
  return (withoutExtension || filename).slice(0, 500);
}

/**
 * A document the caller owns, or NOT_FOUND. Hand-written resolvers sit outside
 * the generated ones, so they do not inherit `scope` and have to state ownership
 * themselves.
 */
async function loadOwned(context: Context, id: string): Promise<Document> {
  const userId = requireAuth(context);
  if (!z.uuid().safeParse(id).success) throw notFound();
  const [doc] = await (context.db as AnyDb)
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)));
  if (!doc) throw notFound();
  return doc;
}

export function applyDocumentsExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, DOCUMENTS_SDL);
  const queries = (extended.getType('Query') as GraphQLObjectType).getFields();
  const mutations = (extended.getType('Mutation') as GraphQLObjectType).getFields();

  queries.serverConfig.resolve = (_parent: unknown, _args: unknown, context: Context) => ({
    maxUploadBytes: maxUploadBytes(),
    acceptedMimeTypes: ACCEPTED_MIME_TYPES,
    ocrAvailable: context.ocrAvailable,
    ocrDefault: context.ocrAvailable && ocrDefault(),
  });

  queries.documentFileUrl.resolve = async (
    _parent: unknown,
    args: { id: string; variant: 'ORIGINAL' | 'ARCHIVE' | 'TEXT'; download: boolean },
    context: Context,
  ) => {
    const doc = await loadOwned(context, args.id);
    if (doc.status === 'pending_upload') throw notFound();
    if (args.variant === 'ARCHIVE') {
      if (!doc.archiveKey) throw notFound();
      return context.storage.files.presignGet(doc.archiveKey, {
        filename: `${titleFromFilename(doc.originalFilename)}.pdf`,
        contentType: 'application/pdf',
        download: args.download,
      });
    }
    if (args.variant === 'TEXT') {
      // The text lives in its own bucket, so this URL is signed by the other
      // Storage — same credentials, different bucket in the path.
      if (!doc.contentKey) throw notFound();
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
    const [doc] = await (context.db as AnyDb)
      .insert(documents)
      .values({
        id,
        userId,
        title: input.title ?? titleFromFilename(input.filename),
        originalFilename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        originalKey: key,
        ocrRequested: input.ocr ?? ocrDefault(),
        status: 'pending_upload',
      })
      .returning();

    const uploadUrl = await context.storage.files.presignPut(key, {
      contentType: input.mimeType,
      contentLength: input.sizeBytes,
    });
    return { document: doc, uploadUrl, uploadHeaders: [{ name: 'Content-Type', value: input.mimeType }] };
  };

  mutations.completeDocumentUpload.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const doc = await loadOwned(context, args.id);
    if (doc.status !== 'pending_upload') return doc;

    const stored = await context.storage.files.head(doc.originalKey);
    if (!stored) throw badInput('The upload has not arrived yet.');
    if (stored.size !== doc.sizeBytes) {
      throw badInput(`The stored file is ${stored.size} bytes, but the upload declared ${doc.sizeBytes}.`);
    }

    const db = context.db as AnyDb;
    // Conditional on the status it was read with, so two concurrent completes
    // start the pipeline once.
    const [updated] = await db
      .update(documents)
      .set({ status: 'uploaded' })
      .where(and(eq(documents.id, doc.id), eq(documents.status, 'pending_upload')))
      .returning();
    if (!updated) return loadOwned(context, args.id);

    await db
      .insert(processingSteps)
      .values(STEPS.map((step, position) => ({ userId: doc.userId, documentId: doc.id, step: step.name, position })))
      .onConflictDoNothing();

    context.events.emit('document.uploaded', { documentId: doc.id });
    return updated;
  };

  mutations.retryDocumentProcessing.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const doc = await loadOwned(context, args.id);
    if (doc.status !== 'failed') throw badInput('Only a failed document can be retried.');

    const db = context.db as AnyDb;
    await db
      .update(processingSteps)
      .set({ status: 'queued', error: null, startedAt: null, finishedAt: null })
      .where(and(eq(processingSteps.documentId, doc.id), eq(processingSteps.status, 'failed')));
    const [updated] = await db
      .update(documents)
      .set({ status: 'uploaded', error: null })
      .where(and(eq(documents.id, doc.id), eq(documents.status, 'failed')))
      .returning();
    if (!updated) return loadOwned(context, args.id);

    context.events.emit('document.uploaded', { documentId: doc.id });
    return updated;
  };

  mutations.renameDocument.resolve = async (
    _parent: unknown,
    args: { id: string; title: string },
    context: Context,
  ) => {
    const doc = await loadOwned(context, args.id);
    const title = parseOrThrow(titleSchema, args.title);
    const [updated] = await (context.db as AnyDb)
      .update(documents)
      .set({ title })
      .where(eq(documents.id, doc.id))
      .returning();
    if (!updated) throw notFound();
    return updated;
  };

  mutations.deleteDocument.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const doc = await loadOwned(context, args.id);
    // Objects first: a row without its file is visible and fixable by deleting
    // again, while a file without its row is invisible storage nobody pays attention to.
    await context.storage.files.delete([doc.originalKey, doc.archiveKey].filter((key): key is string => Boolean(key)));
    if (doc.contentKey) await context.storage.text.delete([doc.contentKey]);
    await (context.db as AnyDb).delete(documents).where(eq(documents.id, doc.id));
    return true;
  };

  return extended;
}

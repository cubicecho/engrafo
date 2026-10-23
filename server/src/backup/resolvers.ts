import { randomUUID } from 'node:crypto';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import { maxImportBytes } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { badInput, errorMessage, notFound, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { BYTES_PER_MEBIBYTE } from '../core/wire.ts';
import { importKey, importKeyPrefix } from '../storage/s3.ts';
import { EXPORT_PATH } from './endpoint.ts';
import { importArchive } from './import.ts';
import type { ImportJob } from './state.ts';

// The GraphQL half of backups: minting the export link, signing the import's upload, starting
// the import and reporting on it. The export's bytes never pass through GraphQL (a link streams
// them), and neither do the import's (the browser PUTs them straight to the bucket).

const BACKUP_SDL = parse(`
  type ExportLink {
    "Where the browser downloads the export: a path on this server, single use."
    path: String!
    "When the link stops working, ISO 8601."
    expiresAt: String!
  }

  type ImportUpload {
    "Pass this to importArchive once the PUT has landed."
    key: String!
    "PUT the archive here, with \`uploadHeaders\`."
    uploadUrl: String!
    uploadHeaders: [HttpHeader!]!
  }

  enum ImportState {
    RUNNING
    DONE
    FAILED
  }

  type ImportItem {
    title: String!
    reason: String!
  }

  type ImportJob {
    id: UUID!
    state: ImportState!
    "How many documents the archive lists; null until its metadata.json has been read."
    total: Int
    imported: Int!
    "Documents already in the archive, by checksum."
    skipped: [ImportItem!]!
    failed: [ImportItem!]!
    "Why the whole import stopped, when it did."
    error: String
    startedAt: String!
    finishedAt: String
  }

  extend type ServerConfig {
    "The largest archive an import accepts, in bytes."
    maxImportBytes: Float!
  }

  extend type Query {
    "The caller's most recent import, running or finished, or null."
    latestImport: ImportJob
  }

  extend type Mutation {
    "A single-use link, good for a few minutes, that downloads the caller's whole archive as a tar."
    createExportLink: ExportLink!
    "Signs a PUT for an archive to import, of exactly \`sizeBytes\`."
    createImportUpload(sizeBytes: Float!): ImportUpload!
    """
    Reads an uploaded export into the caller's archive, in the background: poll latestImport.
    Documents already there, by checksum, are skipped. The uploaded archive is deleted after.
    """
    importArchive(key: String!): ImportJob!
  }
`);

/** What an archive is declared as. The import reads its bytes, so the type is only the PUT's. */
const IMPORT_CONTENT_TYPE = 'application/x-tar';

/** A size for the limit message, in the largest unit that keeps it whole enough to read. */
function sizeLimitText(bytes: number): string {
  return `${Math.floor(bytes / BYTES_PER_MEBIBYTE)} MiB`;
}

const importUploadSchema = z.object({
  sizeBytes: z
    .number()
    .int()
    .positive('The archive is empty.')
    .refine((size) => size <= maxImportBytes(), {
      message: `The archive is larger than the ${sizeLimitText(maxImportBytes())} import limit.`,
    }),
});

/** A run as GraphQL draws it. */
function jobView(job: ImportJob) {
  return {
    id: job.id,
    state: job.state.toUpperCase(),
    total: job.total,
    imported: job.imported,
    skipped: job.skipped,
    failed: job.failed,
    error: job.error,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Adds the export link, the import's upload and run, and the import limit to the schema.
 *
 * @param schema - The schema, which must already have Mutation, ServerConfig and HttpHeader.
 * @returns The extended schema.
 *
 * @remarks
 * Nothing here reads a row through `scope`: the export and the import both filter by the
 * caller's id themselves, and an import key is the caller's only if it is under their prefix.
 */
export function applyBackupExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, BACKUP_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();
  const serverConfig = assertObjectType(extended.getType('ServerConfig')).getFields();

  serverConfig.maxImportBytes.resolve = () => maxImportBytes();

  queries.latestImport.resolve = (_parent: unknown, _args: unknown, context: Context) => {
    const job = context.backups.imports.latest(requireAuth(context));
    return job ? jobView(job) : null;
  };

  mutations.createExportLink.resolve = (_parent: unknown, _args: unknown, context: Context) => {
    const { token, expiresAt } = context.backups.links.mint(requireAuth(context));
    return { path: `${EXPORT_PATH}/${token}`, expiresAt: expiresAt.toISOString() };
  };

  mutations.createImportUpload.resolve = async (_parent: unknown, args: unknown, context: Context) => {
    const userId = requireAuth(context);
    const { sizeBytes } = parseOrThrow(importUploadSchema, args);
    const key = importKey(userId, randomUUID());
    const uploadUrl = await context.storage.files.presignPut(key, {
      contentType: IMPORT_CONTENT_TYPE,
      contentLength: sizeBytes,
    });
    return { key, uploadUrl, uploadHeaders: [{ name: 'Content-Type', value: IMPORT_CONTENT_TYPE }] };
  };

  mutations.importArchive.resolve = async (_parent: unknown, args: { key: string }, context: Context) => {
    const userId = requireAuth(context);
    const { db, storage, events } = context;
    // Someone else's key and no key at all are one answer.
    const stored = args.key.startsWith(importKeyPrefix(userId)) ? await storage.files.head(args.key) : null;
    if (stored === null) {
      throw notFound('That upload is not there. Upload the archive again.');
    }
    if (stored.size > maxImportBytes()) {
      await storage.files.delete([args.key]);
      throw badInput(`The archive is larger than the ${sizeLimitText(maxImportBytes())} import limit.`);
    }
    const forget = () =>
      storage.files.delete([args.key]).catch((error: unknown) => {
        console.error(`[backup] could not delete ${args.key} after its import: ${errorMessage(error)}`);
      });
    try {
      const job = context.backups.imports.start(userId, async (running) => {
        try {
          await importArchive({ db, storage, events }, userId, await storage.files.getStream(args.key), running);
        } finally {
          await forget();
        }
      });
      return jobView(job);
    } catch (error) {
      // Refused because another is running: this upload would only sit in the bucket.
      await forget();
      throw error;
    }
  };

  return extended;
}

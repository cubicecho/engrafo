import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { pipeline, Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus, documents, FieldSource } from '@cubicecho/engrafo-db/schema';
import { and, eq, isNotNull } from 'drizzle-orm';
import { maxUploadBytes } from '../core/config.ts';
import { BACKUP_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { BYTES_PER_MEBIBYTE } from '../core/wire.ts';
import { completePendingDocument, createUploadSchema, insertPendingDocument } from '../documents/create.ts';
import { receiptSchema } from '../metadata/resolvers.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import { ACCEPTED_MIME_TYPES, isAcceptedMimeType, SNIFF_BYTES, sniffMimeType } from '../pipeline/mime.ts';
import type { StorageSet } from '../storage/s3.ts';
import { ensureFolders } from '../watch/ingest.ts';
import { folderNames, MANIFEST_NAME, type ManifestDocument, manifestSchema } from './manifest.ts';
import type { ImportJob } from './state.ts';
import { readTar, type TarEntry, TarError } from './tar.ts';

// An export read back into an archive, one pass over the tar as it streams out of the bucket.
// `metadata.json` comes first, so every original is known by its path before its bytes arrive;
// each one then goes through `insertPendingDocument` and `completePendingDocument`, the way an
// upload and the watched folder do, and the pipeline reads it again as it would a new upload.
// The archive PDFs and text files in the tar are passed over: the pipeline makes them afresh,
// with this instance's OCR, and the search index needs the text read anyway.
//
// What the user had set by hand — a date, a receipt — is written onto the row before it is
// completed, marked `user`, so the metadata step leaves it alone as it does an edit.

/** gzip's first two bytes, so a `.tar.gz` someone compressed after downloading is read too. */
const GZIP_ID1 = 0x1f;
const GZIP_ID2 = 0x8b;

/** What reading an export needs. */
export interface ImportDeps {
  db: DB;
  storage: StorageSet;
  events: PipelineEvents;
}

/** An archive refused as a whole: not an export, or one this version cannot read. */
export class ImportRefused extends Error {}

/** The stream as it was, or gunzipped when it starts as gzip. */
async function* uncompressed(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const chunks = source[Symbol.asyncIterator]();
  const first = await chunks.next();
  if (first.done) {
    return;
  }
  async function* whole(): AsyncGenerator<Uint8Array> {
    yield first.value;
    for (let next = await chunks.next(); next.done !== true; next = await chunks.next()) {
      yield next.value;
    }
  }
  const isGzip = first.value[0] === GZIP_ID1 && first.value[1] === GZIP_ID2;
  if (isGzip === false) {
    yield* whole();
    return;
  }
  // A failure anywhere in the chain destroys the gunzip stream, which the loop below throws.
  yield* pipeline(Readable.from(whole()), createGunzip(), () => {});
}

/** Reads `metadata.json` off the front of the archive and checks it. */
async function readManifest(entry: TarEntry | undefined) {
  if (entry === undefined || posix.basename(entry.name) !== MANIFEST_NAME) {
    throw new ImportRefused(`This is not an Engrafo export: it does not start with ${MANIFEST_NAME}.`);
  }
  if (entry.size > BACKUP_DEFAULTS.metadataMaxBytes) {
    throw new ImportRefused(`${MANIFEST_NAME} is larger than an import reads.`);
  }
  let json: unknown;
  try {
    json = JSON.parse((await entry.read()).toString('utf8'));
  } catch {
    throw new ImportRefused(`${MANIFEST_NAME} is not JSON.`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (parsed.success === false) {
    const [issue] = parsed.error.issues;
    throw new ImportRefused(
      `${MANIFEST_NAME} is not one this version reads (${issue?.path.join('.')}: ${issue?.message}).`,
    );
  }
  // Every path in the manifest is relative to the directory it sits in.
  const root = posix.dirname(entry.name);
  return { manifest: parsed.data, prefix: root === '.' ? '' : `${root}/` };
}

/** What is already in the user's archive, by checksum, before this import adds anything. */
interface Known {
  /** Filed documents' titles: an original with one of these checksums is skipped. */
  filed: Map<string, string>;
  /** Rows a run cut off left waiting for their bytes: finished rather than added again. */
  pending: Map<string, Document[]>;
}

async function readKnown(db: DB, userId: string): Promise<Known> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), isNotNull(documents.checksumSha256)));
  const known: Known = { filed: new Map(), pending: new Map() };
  for (const row of rows) {
    const checksum = row.checksumSha256 ?? '';
    if (row.status === DocumentStatus.PendingUpload) {
      known.pending.set(checksum, [...(known.pending.get(checksum) ?? []), row]);
    } else if (known.filed.has(checksum) === false) {
      known.filed.set(checksum, row.title);
    }
  }
  return known;
}

/** The fields an import keeps from the manifest, onto the row before it is completed. */
function preservedFields(doc: ManifestDocument): Partial<Document> {
  const fields: Partial<Document> = {};
  const createdAt = new Date(doc.createdAt);
  if (Number.isNaN(createdAt.getTime()) === false) {
    fields.createdAt = createdAt;
  }
  if (doc.documentDateSource === FieldSource.User) {
    fields.documentDate = doc.documentDate;
    fields.documentDateSource = FieldSource.User;
  }
  if (doc.receiptSource === FieldSource.User) {
    const receipt = receiptSchema.safeParse({ vendor: doc.vendor, total: doc.total, currency: doc.currency });
    if (receipt.success) {
      fields.vendor = receipt.data.vendor ?? null;
      fields.total = receipt.data.total ?? null;
      fields.currency = receipt.data.currency ?? null;
      fields.receiptSource = FieldSource.User;
    }
  }
  return fields;
}

/** What became of one original. */
type Outcome = { kind: 'imported' } | { kind: 'skipped'; reason: string };

/**
 * Files one original from the archive.
 *
 * @throws With the reason, for one that cannot be filed: too large, the wrong type, damaged, or
 *   in a folder that cannot be made.
 */
async function importOne(
  deps: ImportDeps,
  userId: string,
  known: Known,
  doc: ManifestDocument,
  entry: TarEntry,
): Promise<Outcome> {
  const { db, storage, events } = deps;
  const alreadyFiled = (checksum: string | null) => (checksum ? known.filed.get(checksum) : undefined);
  // Before reading it, when the manifest says what it is: a second run over the same archive
  // then reads nothing it has already filed.
  const listedAs = alreadyFiled(doc.checksumSha256);
  if (listedAs !== undefined) {
    return { kind: 'skipped', reason: `Already in the archive as "${listedAs}".` };
  }
  const max = maxUploadBytes();
  if (entry.size > max) {
    throw new Error(`It is larger than the ${Math.floor(max / BYTES_PER_MEBIBYTE)} MiB upload limit.`);
  }

  const body = await entry.read();
  const sha256 = createHash('sha256').update(body).digest('hex');
  if (doc.checksumSha256 && doc.checksumSha256 !== sha256) {
    throw new Error('Its bytes do not match the checksum in metadata.json: the archive is damaged.');
  }
  const storedAs = alreadyFiled(sha256);
  if (storedAs !== undefined) {
    return { kind: 'skipped', reason: `Already in the archive as "${storedAs}".` };
  }

  const mimeType = await sniffMimeType(body.subarray(0, SNIFF_BYTES), doc.mimeType);
  if (mimeType === null || isAcceptedMimeType(mimeType) === false) {
    throw new Error(
      `Unsupported file type${mimeType ? ` (${mimeType})` : ''}; accepted: ${ACCEPTED_MIME_TYPES.join(', ')}.`,
    );
  }
  const parsed = createUploadSchema().safeParse({
    filename: doc.originalFilename,
    mimeType,
    sizeBytes: body.length,
    title: doc.title,
    ocr: doc.ocrRequested,
  });
  if (parsed.success === false) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid document.');
  }

  const pending =
    known.pending.get(sha256)?.shift() ??
    (await insertPendingDocument(
      db,
      userId,
      { ...parsed.data, folderId: await ensureFolders(db, userId, folderNames(doc.folder)) },
      sha256,
    ));
  await storage.files.put(pending.originalKey, body, mimeType);
  const [row] = await db.update(documents).set(preservedFields(doc)).where(eq(documents.id, pending.id)).returning();
  await completePendingDocument(db, storage, events, row ?? pending);
  return { kind: 'imported' };
}

/**
 * Reads an export into a user's archive, recording on `job` what became of each document.
 *
 * @param deps - The database, the buckets and the pipeline's events.
 * @param userId - Whose archive it fills. The manifest's ids are never used: every row is new.
 * @param source - The tar's bytes, or a gzip of them.
 * @param job - Where the counts go, as they happen.
 * @throws {@link ImportRefused} for something that is not an export; a stream error as it is.
 *
 * @remarks
 * A document is skipped when its checksum is already in the archive, so the same export imported
 * twice adds nothing the second time, and one cut off partway is finished by running it again.
 * Two copies of one file inside the export are both imported: that was meant, as it is in an
 * upload. A name taken in its folder is numbered (`scan (2)`), as an upload's is.
 */
export async function importArchive(
  deps: ImportDeps,
  userId: string,
  source: AsyncIterable<Uint8Array>,
  job: Pick<ImportJob, 'total' | 'imported' | 'skipped' | 'failed'>,
): Promise<void> {
  const entries = readTar(uncompressed(source));
  const first = await entries.next();
  const { manifest, prefix } = await readManifest(first.done ? undefined : first.value);
  job.total = manifest.documents.length;

  // Empty folders come back too; a folder with documents would be made by its first one anyway.
  for (const folder of manifest.folders) {
    try {
      await ensureFolders(deps.db, userId, folderNames(folder.path));
    } catch (error) {
      job.failed.push({ title: `Folder ${folder.path}`, reason: errorMessage(error) });
    }
  }

  const known = await readKnown(deps.db, userId);
  const byPath = new Map<string, ManifestDocument>();
  for (const doc of manifest.documents) {
    if (doc.files.original === null) {
      job.failed.push({ title: doc.title, reason: 'The export has no original for it.' });
    } else {
      byPath.set(`${prefix}${doc.files.original}`, doc);
    }
  }

  for await (const entry of entries) {
    const doc = byPath.get(entry.name);
    if (doc === undefined) {
      continue;
    }
    byPath.delete(entry.name);
    try {
      const outcome = await importOne(deps, userId, known, doc, entry);
      if (outcome.kind === 'imported') {
        job.imported++;
      } else {
        job.skipped.push({ title: doc.title, reason: outcome.reason });
      }
    } catch (error) {
      // A broken archive is the whole run's failure, not this document's.
      if (error instanceof TarError) {
        throw error;
      }
      job.failed.push({ title: doc.title, reason: errorMessage(error) });
    }
  }
  for (const doc of byPath.values()) {
    job.failed.push({ title: doc.title, reason: 'Its original is missing from the archive.' });
  }
}

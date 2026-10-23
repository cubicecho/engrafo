import { extname } from 'node:path';
import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus, documents, folders } from '@cubicecho/engrafo-db/schema';
import { and, asc, eq, ne } from 'drizzle-orm';
import { folderPaths } from '../folders/names.ts';
import type { Storage, StorageSet } from '../storage/s3.ts';
import { MANIFEST_FORMAT, MANIFEST_NAME, MANIFEST_VERSION, type Manifest, type ManifestDocument } from './manifest.ts';
import { TAR_END, tarFileHeader, tarPadding } from './tar.ts';

// The whole of one user's archive as a tar, produced as it is sent: `metadata.json` first, then
// each document's original, its OCR'd PDF/A and its extracted text, each streamed out of the
// bucket into the response. Nothing is staged, so an export of fifty gigabytes costs the server
// one object's chunks of memory at a time.
//
// The layout is for a person opening the tar as much as for the import:
//
//   engrafo-export-2026-10-23/
//     metadata.json
//     originals/Taxes/2026/Invoice March.pdf
//     archive/Taxes/2026/Invoice March.pdf
//     text/Taxes/2026/Invoice March.txt

/** What the three trees of the archive are called. */
const TREE = { original: 'originals', archive: 'archive', text: 'text' } as const;

/** Characters a file name cannot hold on Windows, swapped for `_` in a path (never in metadata). */
const UNSAFE_IN_FILENAME = /[<>:"\\|?*]/g;
/** Below this code point is a control character, which no file name should carry either. */
const FIRST_PRINTABLE = 0x20;
/** Windows drops a trailing dot or space, which would make two names one. */
const TRAILING_DOTS = /[. ]+$/;
/** How much of a document id breaks a tie between two names that came out the same. */
const ID_TIE_BREAK_CHARS = 8;

/** One object to copy into the archive, at a path. */
interface ExportEntry {
  path: string;
  storage: Storage;
  key: string;
  mtime: Date;
}

/** The manifest, and the objects to stream after it in the order it lists them. */
export interface ExportPlan {
  /** The directory every path in the archive is under: `engrafo-export-2026-10-23`. */
  root: string;
  manifest: Manifest;
  entries: ExportEntry[];
}

/**
 * The name an export is downloaded as.
 *
 * @param now - When it was made.
 * @returns `engrafo-export-YYYY-MM-DD`, with no extension.
 */
export function exportName(now: Date): string {
  return `engrafo-export-${now.toISOString().slice(0, 10)}`;
}

/** A title as a file name: unsafe characters swapped, never empty. */
function safeName(title: string): string {
  const printable = [...title].map((char) => ((char.codePointAt(0) ?? 0) < FIRST_PRINTABLE ? '_' : char)).join('');
  const cleaned = printable.replace(UNSAFE_IN_FILENAME, '_').replace(TRAILING_DOTS, '');
  return cleaned === '' ? '_' : cleaned;
}

/**
 * Hands out paths in one tree, unique ignoring case. Titles already are within a folder, but
 * swapping unsafe characters can make two of them one.
 */
function pathAllocator() {
  const taken = new Set<string>();
  return (folder: string | null, name: string, extension: string, id: string): string => {
    const base = folder ? `${folder}/${name}` : name;
    let path = `${base}${extension}`;
    if (taken.has(path.toLowerCase())) {
      path = `${base} (${id.slice(0, ID_TIE_BREAK_CHARS)})${extension}`;
    }
    taken.add(path.toLowerCase());
    return path;
  };
}

/** The extension an original keeps: its filename's, unless the title already ends with it. */
function originalExtension(doc: Document): string {
  const extension = extname(doc.originalFilename).toLowerCase();
  return doc.title.toLowerCase().endsWith(extension) ? '' : extension;
}

/**
 * Reads everything the export will hold, without reading any object yet.
 *
 * @param deps - The database and the buckets.
 * @param userId - Whose archive. Nothing of anyone else's is read.
 * @param now - When the export was asked for.
 * @returns The manifest and the objects to follow it.
 *
 * @remarks
 * A document still waiting for its upload has no bytes to export, so it is left out.
 */
export async function planExport(
  deps: { db: DB; storage: StorageSet },
  userId: string,
  now: Date,
): Promise<ExportPlan> {
  const { db, storage } = deps;
  const folderRows = await db.select().from(folders).where(eq(folders.userId, userId));
  const paths = folderPaths(folderRows);
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), ne(documents.status, DocumentStatus.PendingUpload)))
    .orderBy(asc(documents.createdAt), asc(documents.id));

  const allocate = {
    original: pathAllocator(),
    archive: pathAllocator(),
    text: pathAllocator(),
  };
  const entries: ExportEntry[] = [];
  const listed: ManifestDocument[] = docs.map((doc) => {
    const folder = doc.folderId ? (paths.get(doc.folderId) ?? null) : null;
    const name = safeName(doc.title);
    const original = `${TREE.original}/${allocate.original(folder, name, originalExtension(doc), doc.id)}`;
    entries.push({ path: original, storage: storage.files, key: doc.originalKey, mtime: doc.createdAt });
    let archive: string | null = null;
    if (doc.archiveKey) {
      archive = `${TREE.archive}/${allocate.archive(folder, name, '.pdf', doc.id)}`;
      entries.push({ path: archive, storage: storage.files, key: doc.archiveKey, mtime: doc.updatedAt });
    }
    let text: string | null = null;
    if (doc.contentKey) {
      text = `${TREE.text}/${allocate.text(folder, name, '.txt', doc.id)}`;
      entries.push({ path: text, storage: storage.text, key: doc.contentKey, mtime: doc.updatedAt });
    }
    return {
      id: doc.id,
      title: doc.title,
      folder,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      checksumSha256: doc.checksumSha256,
      status: doc.status,
      ocrRequested: doc.ocrRequested,
      createdAt: doc.createdAt.toISOString(),
      documentDate: doc.documentDate,
      documentDateSource: doc.documentDateSource,
      vendor: doc.vendor,
      total: doc.total,
      currency: doc.currency,
      receiptSource: doc.receiptSource,
      files: { original, archive, text },
    };
  });

  const manifest: Manifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    exportedAt: now.toISOString(),
    // Shortest path first is parents before children, which is the order an import makes them in.
    folders: folderRows
      .map((folder) => ({ path: paths.get(folder.id) ?? folder.name, mcpEnabled: folder.mcpEnabled }))
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path)),
    documents: listed,
  };
  return { root: exportName(now), manifest, entries };
}

/**
 * The export as a tar, one chunk at a time, for a response to stream.
 *
 * @param plan - What {@link planExport} read.
 * @yields The archive's bytes.
 * @throws When an object's bytes are not the size the bucket said, or it cannot be read. The
 *   response is then cut off, so a broken export fails as a download rather than arriving short.
 *
 * @remarks
 * An object the bucket no longer has is left out, and logged: the manifest still names its path,
 * and an import reports that document as missing from the archive.
 */
export async function* streamExport(plan: ExportPlan): AsyncGenerator<Buffer> {
  const manifest = Buffer.from(`${JSON.stringify(plan.manifest, null, 2)}\n`, 'utf8');
  const exportedAt = new Date(plan.manifest.exportedAt);
  yield tarFileHeader(`${plan.root}/${MANIFEST_NAME}`, manifest.length, exportedAt);
  yield manifest;
  yield tarPadding(manifest.length);

  for (const entry of plan.entries) {
    const stored = await entry.storage.head(entry.key);
    if (stored === null) {
      console.warn(`[backup] ${entry.key} is missing from the bucket; left out of the export`);
      continue;
    }
    yield tarFileHeader(`${plan.root}/${entry.path}`, stored.size, entry.mtime);
    let sent = 0;
    for await (const chunk of await entry.storage.getStream(entry.key)) {
      const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sent += buffer.length;
      if (sent > stored.size) {
        throw new Error(`${entry.key} grew while it was being exported`);
      }
      yield buffer;
    }
    if (sent !== stored.size) {
      throw new Error(`${entry.key} was ${sent} bytes, not the ${stored.size} the bucket said`);
    }
    yield tarPadding(stored.size);
  }
  yield TAR_END;
}

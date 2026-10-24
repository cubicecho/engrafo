import { z } from 'zod';
import { calendarDaySchema } from '../metadata/schemas.ts';

// `metadata.json`, the first file of every export: what the archive holds and where in it, so
// an import knows each file before its bytes arrive. Written for people as much as for the
// importer: a self-hoster leaving should be able to read their titles, folders, dates and
// receipts from it with nothing but a text editor.

/** What `format` says, so an import can tell an Engrafo export from any other tar. */
export const MANIFEST_FORMAT = 'engrafo-export';
/** Raised only when an older importer could no longer read what is written. */
export const MANIFEST_VERSION = 1;
/** The manifest's name, at the top of the archive. */
export const MANIFEST_NAME = 'metadata.json';

/** Who filled a field in: the pipeline (`extracted`) or the user (`user`). */
const sourceSchema = z.enum(['extracted', 'user']).nullable();

/** Where each of a document's files is in the archive, or null for one it does not have. */
const filesSchema = z.object({
  original: z.string().nullable(),
  archive: z.string().nullable(),
  text: z.string().nullable(),
});

const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** The folder's path from the top, `Taxes/2026`, or null for the top level. */
  folder: z.string().nullable(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string().nullable(),
  status: z.string(),
  ocrRequested: z.boolean(),
  createdAt: z.string(),
  documentDate: calendarDaySchema.nullable(),
  documentDateSource: sourceSchema,
  vendor: z.string().nullable(),
  /** An exact decimal, as written. */
  total: z.string().nullable(),
  currency: z.string().nullable(),
  receiptSource: sourceSchema,
  files: filesSchema,
});

const folderSchema = z.object({
  path: z.string().min(1),
  /** Whether the folder was shared with MCP clients. Recorded, never restored: sharing is chosen again. */
  mcpEnabled: z.boolean(),
});

/** The manifest, as an import checks it. */
export const manifestSchema = z.object({
  format: z.literal(MANIFEST_FORMAT),
  version: z.literal(MANIFEST_VERSION),
  exportedAt: z.string(),
  /** Every folder, parents before children, so empty ones come back too. */
  folders: z.array(folderSchema),
  documents: z.array(documentSchema),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestDocument = z.infer<typeof documentSchema>;

/** The separator in a folder path. A folder's name cannot contain it. */
export const PATH_SEPARATOR = '/';

/**
 * A folder path split into names.
 *
 * @param path - `Taxes/2026`, or null for the top level.
 * @returns The names, outermost first; none for the top level.
 */
export function folderNames(path: string | null): string[] {
  if (path === null) {
    return [];
  }
  return path
    .split(PATH_SEPARATOR)
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

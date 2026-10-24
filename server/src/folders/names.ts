import type { DB } from '@cubicecho/engrafo-db';
import { documents, type Folder, folders } from '@cubicecho/engrafo-db/schema';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { GraphQLError } from 'graphql';
import { z } from 'zod';
import { FOLDER_DEFAULTS } from '../core/defaults.ts';
import { conflict, notFound } from '../core/errors.ts';

// What a folder holds is addressed by name, as files are: the tree draws a
// document's title as its name, and later an MCP client will ask for a path.
// So within one folder no two things share a name — folder or document, in any
// case. The unique indexes hold that within each table; the check across the
// two tables is here, under a per-user lock so two writes cannot both pass it.

/** A transaction handle, as `db.transaction` passes it. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Letters, digits, space, `_`, `.` and `-`, starting with a letter, digit or `_`: mcp-ragdown's
 * rule, so a name can stand in a URL path without escaping and never starts with a dot.
 */
const FOLDER_NAME = /^[A-Za-z0-9_][A-Za-z0-9 _.-]*$/;

/** A folder's name as given, trimmed and checked. */
export const folderNameSchema = z
  .string()
  .trim()
  .min(1, 'Name cannot be empty.')
  .max(FOLDER_DEFAULTS.nameMaxLength, `Name is longer than ${FOLDER_DEFAULTS.nameMaxLength} characters.`)
  .regex(FOLDER_NAME, 'Use letters, digits, spaces, "_", "." and "-", starting with a letter, digit or "_".');

/** Hides a missing folder and someone else's behind one answer. */
export function folderNotFound(): GraphQLError {
  return notFound('Folder not found');
}

/**
 * Holds the caller's names still until the transaction ends. Every write that adds or changes a
 * name takes it first, so a check and the write it guards cannot be split by another request.
 *
 * @param tx - The transaction the check and the write run in.
 * @param userId - Whose names to lock. Other users' writes do not wait.
 */
export async function lockNames(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`names:${userId}`}, 0))`);
}

/**
 * A folder the caller owns, or NOT_FOUND. An id that is not a UUID is not found either.
 *
 * @param db - The connection or transaction to read with.
 * @param userId - The caller.
 * @param id - The folder's id.
 * @returns The folder row.
 */
export async function loadOwnedFolder(db: DB | Tx, userId: string, id: string): Promise<Folder> {
  if (!z.uuid().safeParse(id).success) {
    throw folderNotFound();
  }
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.userId, userId)));
  if (!folder) {
    throw folderNotFound();
  }
  return folder;
}

/**
 * The folder to file into: the caller's own, or the top level for null.
 *
 * @param db - The connection or transaction to read with.
 * @param userId - The caller.
 * @param id - A folder id, or null or undefined for the top level.
 * @returns The folder's id, or null for the top level.
 */
export async function ownedParent(db: DB | Tx, userId: string, id: string | null | undefined): Promise<string | null> {
  if (id === null || id === undefined) {
    return null;
  }
  return (await loadOwnedFolder(db, userId, id)).id;
}

/** What a name check leaves out: the thing being renamed or moved, which may keep its own name. */
export interface NameExclusion {
  folderId?: string;
  documentId?: string;
}

/**
 * Every name already used in one folder, lowercased.
 *
 * @param tx - The transaction, holding {@link lockNames}.
 * @param userId - The caller.
 * @param parentId - The folder, or null for the top level.
 * @param except - A folder or document whose own name does not count.
 */
async function namesIn(tx: Tx, userId: string, parentId: string | null, except: NameExclusion): Promise<Set<string>> {
  const folderRows = await tx
    .select({ name: folders.name })
    .from(folders)
    .where(
      and(
        eq(folders.userId, userId),
        parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId),
        except.folderId ? ne(folders.id, except.folderId) : undefined,
      ),
    );
  const documentRows = await tx
    .select({ name: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        parentId === null ? isNull(documents.folderId) : eq(documents.folderId, parentId),
        except.documentId ? ne(documents.id, except.documentId) : undefined,
        // A document in the trash holds no name; the partial unique index agrees.
        isNull(documents.deletedAt),
      ),
    );
  return new Set([...folderRows, ...documentRows].map((row) => row.name.toLowerCase()));
}

/**
 * Refuses a name something else in the folder already has, as CONFLICT. Never overwrites.
 *
 * @param tx - The transaction, holding {@link lockNames}.
 * @param userId - The caller.
 * @param parentId - The folder the name is going into, or null for the top level.
 * @param name - The name, already checked for shape.
 * @param [except] - The folder or document being renamed or moved, which may keep its name.
 */
export async function assertNameFree(
  tx: Tx,
  userId: string,
  parentId: string | null,
  name: string,
  except: NameExclusion = {},
): Promise<void> {
  const taken = await namesIn(tx, userId, parentId, except);
  if (taken.has(name.toLowerCase())) {
    throw conflict(`Something called "${name}" is already there.`);
  }
}

/**
 * The name itself if it is free in the folder, or the name with " (2)", " (3)", … added — what an
 * upload gets, since two scans called "scan.pdf" are an everyday thing and not a mistake.
 *
 * @param tx - The transaction, holding {@link lockNames}.
 * @param userId - The caller.
 * @param parentId - The folder, or null for the top level.
 * @param name - The name wanted.
 * @param maxLength - The longest the result may be; the name is cut to make room for the number.
 * @returns A name nothing in the folder has.
 */
export async function freeName(
  tx: Tx,
  userId: string,
  parentId: string | null,
  name: string,
  maxLength: number,
): Promise<string> {
  const taken = await namesIn(tx, userId, parentId, {});
  if (taken.has(name.toLowerCase()) === false) {
    return name;
  }
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, maxLength - suffix.length).trimEnd()}${suffix}`;
    if (taken.has(candidate.toLowerCase()) === false) {
      return candidate;
    }
  }
}

/** One folder's place in the tree: enough to walk up or down it. */
interface FolderLink {
  id: string;
  parentId: string | null;
}

/**
 * The folder and every folder under it, at any depth.
 *
 * @param db - The connection or transaction to read with.
 * @param userId - The caller.
 * @param rootId - The folder to start from, which is included.
 * @returns The ids, the root first.
 */
export async function folderAndDescendants(db: DB | Tx, userId: string, rootId: string): Promise<string[]> {
  const links: FolderLink[] = await db
    .select({ id: folders.id, parentId: folders.parentId })
    .from(folders)
    .where(eq(folders.userId, userId));
  const children = new Map<string, string[]>();
  for (const link of links) {
    if (link.parentId) {
      children.set(link.parentId, [...(children.get(link.parentId) ?? []), link.id]);
    }
  }
  const found = [rootId];
  for (let i = 0; i < found.length; i++) {
    found.push(...(children.get(found[i]) ?? []));
  }
  return found;
}

/** Each folder's path from the top, `Taxes/2026`, by id: the receipts CSV's folder column, and the backup's. */
export function folderPaths(all: readonly Folder[]): Map<string, string> {
  const byId = new Map(all.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();
  for (const folder of all) {
    const names: string[] = [];
    const seen = new Set<string>();
    // Up to the top. `seen` guards a loop the server never makes.
    for (let at: Folder | undefined = folder; at && seen.has(at.id) === false; ) {
      seen.add(at.id);
      names.unshift(at.name);
      at = at.parentId ? byId.get(at.parentId) : undefined;
    }
    paths.set(folder.id, names.join('/'));
  }
  return paths;
}

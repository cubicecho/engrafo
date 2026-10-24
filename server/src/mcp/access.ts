import type { DB } from '@cubicecho/engrafo-db';
import { type Document, DocumentStatus, documents, type Folder, folders } from '@cubicecho/engrafo-db/schema';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { notTrashed } from '../trash/trash.ts';

// What an MCP client may see of one user's archive: the folders whose MCP switch is on, and
// every folder inside one of them. Everything else (other folders, the top level, other users)
// does not exist as far as /mcp is concerned. Every tool goes through here, so the rule is
// written once.
//
// Paths are the tree's: `<folder path>/<title>`, from the top, through folders that are not
// shared themselves too, because that is where the user will say a document is. Names are
// unique in a folder ignoring case (folders/names.ts), so a path names one row, and it is
// matched ignoring case as well.

/** A folder an MCP client may read. */
export interface SharedFolder {
  folder: Folder;
  /** From the top: `Taxes/2026`. */
  path: string;
}

/** One user's archive as MCP sees it. */
export interface McpAccess {
  /** The shared folders, by path. */
  folders: SharedFolder[];
  /** Their ids, for a query's `IN`. */
  ids: string[];
  /** A shared folder by its path, ignoring case, or undefined when it is not one. */
  folderAt(path: string): SharedFolder | undefined;
  /** A shared folder and every shared folder under it, by id. */
  within(folder: SharedFolder): string[];
  /** A document's path, or undefined when it is not in a shared folder. */
  pathOf(document: Pick<Document, 'folderId' | 'title'>): string | undefined;
}

/**
 * Reads which of a user's folders MCP may see.
 *
 * @param db - The database.
 * @param userId - Whose archive. The API key's owner, never an argument.
 * @returns The shared folders and the lookups over them.
 */
export async function loadMcpAccess(db: DB, userId: string): Promise<McpAccess> {
  const all = await db.select().from(folders).where(eq(folders.userId, userId));
  const byId = new Map(all.map((folder) => [folder.id, folder]));

  const paths = new Map<string, string>();
  const shared = new Map<string, boolean>();
  // Walked from each folder up to the top. `seen` guards a loop the server never makes.
  const visit = (folder: Folder, seen: Set<string>): void => {
    if (paths.has(folder.id)) {
      return;
    }
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    if (parent && seen.has(parent.id) === false) {
      visit(parent, seen.add(folder.id));
      paths.set(folder.id, `${paths.get(parent.id)}/${folder.name}`);
      shared.set(folder.id, folder.mcpEnabled || shared.get(parent.id) === true);
      return;
    }
    paths.set(folder.id, folder.name);
    shared.set(folder.id, folder.mcpEnabled);
  };
  for (const folder of all) {
    visit(folder, new Set());
  }

  const list = all
    .filter((folder) => shared.get(folder.id) === true)
    .map((folder) => ({ folder, path: paths.get(folder.id) ?? folder.name }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map(list.map((entry) => [entry.path.toLowerCase(), entry]));
  const sharedById = new Map(list.map((entry) => [entry.folder.id, entry]));

  return {
    folders: list,
    ids: list.map((entry) => entry.folder.id),
    folderAt: (path) => byPath.get(normalizePath(path).toLowerCase()),
    within: (root) => {
      const prefix = `${root.path.toLowerCase()}/`;
      return list
        .filter((entry) => entry === root || entry.path.toLowerCase().startsWith(prefix))
        .map((entry) => entry.folder.id);
    },
    pathOf: (document) => {
      const folder = document.folderId ? sharedById.get(document.folderId) : undefined;
      return folder ? `${folder.path}/${document.title}` : undefined;
    },
  };
}

/** A path as an agent might write it: slashes at either end, or doubled, are not part of any name. */
export function normalizePath(path: string): string {
  return path
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('/');
}

/**
 * The documents MCP may see, or those under one shared folder.
 *
 * @param db - The database.
 * @param userId - Whose.
 * @param folderIds - The folders to read: `access.ids`, or `access.within(folder)`.
 * @returns Every document filed in them that has been uploaded, oldest first.
 */
export async function sharedDocuments(db: DB, userId: string, folderIds: readonly string[]): Promise<Document[]> {
  if (folderIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        inArray(documents.folderId, [...folderIds]),
        // A row whose bytes never arrived is not a document yet.
        ne(documents.status, DocumentStatus.PendingUpload),
        notTrashed(),
      ),
    )
    .orderBy(documents.createdAt);
}

/**
 * Finds a document by its path, in a shared folder only.
 *
 * @param db - The database.
 * @param userId - Whose.
 * @param access - What MCP may see.
 * @param path - `<folder path>/<title>`, ignoring case.
 * @returns The document, or undefined when no shared folder has one at that path.
 */
export async function documentAt(
  db: DB,
  userId: string,
  access: McpAccess,
  path: string,
): Promise<Document | undefined> {
  const normalized = normalizePath(path);
  const split = normalized.lastIndexOf('/');
  if (split < 0) {
    // The top level is never shared.
    return undefined;
  }
  const folder = access.folderAt(normalized.slice(0, split));
  if (folder === undefined) {
    return undefined;
  }
  const title = normalized.slice(split + 1).toLowerCase();
  const inFolder = await sharedDocuments(db, userId, [folder.folder.id]);
  return inFolder.find((document) => document.title.toLowerCase() === title);
}

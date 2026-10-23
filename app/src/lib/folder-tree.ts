import type { SelectEntry } from '@/lib/select-options';

// The archive as the tree draws it. The server hands back folders as rows with a
// parent and documents with a folder; FileTree wants a flat list of `/` paths.
// A document's title is its name in its folder — the server keeps it unique
// there and free of `/` — so `<folder path>/<title>` addresses exactly one row.

/** A folder, as the page's query selects it. */
export interface FolderRow {
  id: string;
  name: string;
  parentId?: string | null | undefined;
  /** Whether MCP clients may read it and every folder inside it. */
  mcpEnabled?: boolean | null | undefined;
}

/** What a document needs to be placed in the tree. */
export interface FiledDocument {
  id: string;
  title: string;
  folderId?: string | null | undefined;
}

/** One row of the tree: a folder or a document, with the row it came from. */
export type ArchiveEntry<D extends FiledDocument = FiledDocument> =
  | { path: string; type: 'dir'; kind: 'folder'; folder: FolderRow }
  | { path: string; type: 'file'; kind: 'document'; document: D };

/** The value the folder pickers use for the top level, which has no id. */
export const TOP_LEVEL = '';

/** What the top level is called wherever a folder is named. */
export const TOP_LEVEL_LABEL = 'Top level';

/**
 * Every folder's path from the top, by id.
 *
 * @param folders - All of the caller's folders.
 * @returns `"Taxes/2026"` for a folder `2026` inside `Taxes`. A folder whose parent is not in the
 * list is placed at the top level rather than lost.
 */
export function folderPaths(folders: readonly FolderRow[]): Map<string, string> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string>();
  const pathOf = (folder: FolderRow, seen: Set<string>): string => {
    const known = paths.get(folder.id);
    if (known !== undefined) {
      return known;
    }
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    // `seen` stops a loop the server should never send from hanging the page.
    const path =
      parent && seen.has(parent.id) === false ? `${pathOf(parent, seen.add(folder.id))}/${folder.name}` : folder.name;
    paths.set(folder.id, path);
    return path;
  };
  for (const folder of folders) {
    pathOf(folder, new Set());
  }
  return paths;
}

/**
 * The flat list FileTree nests: a `dir` per folder, so an empty one still shows, and a `file` per
 * document.
 *
 * @param folders - All of the caller's folders.
 * @param documents - The documents to place.
 * @returns The entries, in no particular order; the tree sorts them.
 */
export function archiveEntries<D extends FiledDocument>(
  folders: readonly FolderRow[],
  documents: readonly D[],
): ArchiveEntry<D>[] {
  const paths = folderPaths(folders);
  return [
    ...folders.map(
      (folder): ArchiveEntry<D> => ({
        path: paths.get(folder.id) ?? folder.name,
        type: 'dir',
        kind: 'folder',
        folder,
      }),
    ),
    ...documents.map(
      (document): ArchiveEntry<D> => ({
        path: documentPathIn(paths, document),
        type: 'file',
        kind: 'document',
        document,
      }),
    ),
  ];
}

/**
 * A document's path, as the tree draws it and an MCP client asks for it.
 *
 * @param paths - Every folder's path, from {@link folderPaths}.
 * @param document - The document.
 * @returns `"Taxes/2026/scan"`, or the bare title at the top level or when its folder is unknown.
 */
export function documentPathIn(paths: ReadonlyMap<string, string>, document: FiledDocument): string {
  const folderPath = document.folderId ? paths.get(document.folderId) : undefined;
  return folderPath ? `${folderPath}/${document.title}` : document.title;
}

/**
 * A folder and every folder under it.
 *
 * @param folders - All of the caller's folders.
 * @param id - The folder to start from, which is included.
 */
export function folderAndDescendants(folders: readonly FolderRow[], id: string): Set<string> {
  const found = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && found.has(folder.parentId) && found.has(folder.id) === false) {
        found.add(folder.id);
        grew = true;
      }
    }
  }
  return found;
}

/**
 * The folder that shares a folder with MCP clients: itself when its own switch is on, else the
 * nearest folder above it whose switch is, as the server decides it.
 *
 * @param folders - All of the caller's folders.
 * @param id - The folder asked about.
 * @returns The sharing folder, or undefined when MCP clients cannot read it.
 */
export function mcpSharedBy(folders: readonly FolderRow[], id: string): FolderRow | undefined {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && seen.has(current.id) === false) {
    if (current.mcpEnabled) {
      return current;
    }
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return undefined;
}

/**
 * The choices for a "which folder" picker: the top level, then every folder by its path.
 *
 * @param folders - All of the caller's folders.
 * @param [exclude] - Folders that may not be chosen, such as a folder being moved and those under it.
 */
export function folderOptions(folders: readonly FolderRow[], exclude: ReadonlySet<string> = new Set()): SelectEntry[] {
  const paths = folderPaths(folders);
  const choices = folders
    .filter((folder) => exclude.has(folder.id) === false)
    .map((folder) => ({ value: folder.id, label: paths.get(folder.id) ?? folder.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: TOP_LEVEL, label: TOP_LEVEL_LABEL }, ...choices];
}

/** Letters, digits, space, `_`, `.` and `-`, not starting with a dot or a space: the server's rule. */
const FOLDER_NAME = /^[A-Za-z0-9_][A-Za-z0-9 _.-]*$/;

/** The server's longest folder name, so the dialog can say so before it is sent. */
export const FOLDER_NAME_MAX_LENGTH = 64;

/**
 * What is wrong with a folder name, in the words the dialog shows, or undefined when nothing is.
 *
 * @param name - The name as typed.
 */
export function folderNameError(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'Give the folder a name';
  }
  if (trimmed.length > FOLDER_NAME_MAX_LENGTH) {
    return `Keep it to ${FOLDER_NAME_MAX_LENGTH} characters`;
  }
  if (FOLDER_NAME.test(trimmed) === false) {
    return 'Use letters, digits, spaces, "_", "." and "-", starting with a letter, digit or "_"';
  }
  return undefined;
}

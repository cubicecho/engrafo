import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

// What a pass over the watched directory sees. Only regular files are
// candidates: a symlink is not followed, since it could point anywhere on the
// host, and nothing here ever deletes through one.

/** A file in the watched directory, as one listing saw it. */
export interface WatchedFile {
  /** The absolute path. */
  path: string;
  /** The path from the watched directory, with `/` between its parts. What the log names. */
  relativePath: string;
  /** The directories between the watched directory and the file. Empty at the top. */
  dirs: string[];
  /** The file's own name. */
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

/**
 * Names scanners, SMB clients and editors write beside the real files: in-progress copies,
 * lock files, resource forks.
 */
const TEMP_SUFFIXES = ['.tmp', '.temp', '.part', '.partial', '.crdownload', '.download', '~'];

/**
 * Whether a file is one nobody meant to file.
 *
 * @param name - The file's name.
 * @returns true for dotfiles (`.DS_Store`, `._scan.pdf`, `.~lock.x#`), Office's `~$` owner files,
 *   and the temporary names a copy in progress goes by.
 */
export function isIgnoredFile(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('~$')) {
    return true;
  }
  const lower = name.toLowerCase();
  return TEMP_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * Whether a directory is one a NAS or a desktop keeps for itself.
 *
 * @param name - The directory's name.
 * @returns true for dot-directories, Synology's `@eaDir`, `#recycle` and `#snapshot`, and
 *   Windows's `$RECYCLE.BIN`.
 */
export function isIgnoredDir(name: string): boolean {
  return ['.', '@', '#', '$'].some((prefix) => name.startsWith(prefix));
}

/**
 * Every file under a directory that might be filed, at any depth.
 *
 * @param root - The watched directory.
 * @returns The files, in path order so a pass files them in a predictable one.
 * @throws When `root` itself cannot be read. A file or a subdirectory that disappears or cannot
 *   be read partway through is left out; the next pass sees it again.
 */
export async function listFiles(root: string): Promise<WatchedFile[]> {
  const found: WatchedFile[] = [];
  const walk = async (dirs: string[]): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(join(root, ...dirs), { withFileTypes: true });
    } catch (error) {
      if (dirs.length === 0) {
        throw error;
      }
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name) === false) {
          await walk([...dirs, entry.name]);
        }
        continue;
      }
      if (entry.isFile() === false || isIgnoredFile(entry.name)) {
        continue;
      }
      const path = join(root, ...dirs, entry.name);
      try {
        const info = await stat(path);
        found.push({
          path,
          relativePath: [...dirs, entry.name].join('/'),
          dirs,
          name: entry.name,
          sizeBytes: info.size,
          mtimeMs: info.mtimeMs,
        });
      } catch {
        // Gone between the listing and the stat: a scanner renaming its temp file.
      }
    }
  };
  await walk([]);
  return found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

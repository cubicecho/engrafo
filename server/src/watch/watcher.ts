import { stat, unlink } from 'node:fs/promises';
import type { DB } from '@cubicecho/engrafo-db';
import { users } from '@cubicecho/engrafo-db/schema';
import { eq, sql } from 'drizzle-orm';
import type { WatchConfig } from '../core/config.ts';
import { errorMessage } from '../core/errors.ts';
import type { PipelineEvents } from '../pipeline/events.ts';
import type { StorageSet } from '../storage/s3.ts';
import { listFiles, type WatchedFile } from './files.ts';
import { ingestFile, Rejected } from './ingest.ts';

// The consume folder: a directory, usually a scanner's network share mounted
// into the container, whose files are filed into one account's archive and then
// removed. Polled, not watched: inotify does not fire for writes another
// machine makes to an SMB or NFS share, nor reliably through a Docker bind
// mount, and a listing every few seconds costs nothing.
//
// A file is filed once its size and modification time have held still for
// `stableMs`, since a scanner or a copy writes it a piece at a time. It is
// removed only after `completePendingDocument` has seen its object in the
// bucket. Anything short of that leaves it where it is.

/** What the watcher writes to. `console` unless a test wants the lines. */
export interface WatchLog {
  info(line: string): void;
  warn(line: string): void;
}

/** What `createWatcher` needs. */
export interface WatcherOptions {
  db: DB;
  storage: StorageSet;
  events: PipelineEvents;
  config: WatchConfig;
  /** The clock stability is measured with. `Date.now` unless a test drives it. */
  now?: () => number;
  log?: WatchLog;
}

/** The watcher, which `index.ts` starts after the pipeline and stops on a signal. */
export interface Watcher {
  /** Lists the directory once and files every file that has held still long enough. */
  scanOnce(): Promise<void>;
  /** Scans every `pollMs` until stopped, starting now. */
  start(): void;
  /**
   * Stops scanning. Resolves once the file being filed, if any, is either filed and removed or
   * untouched: never stored without its row completed, never removed without it.
   */
  stop(): Promise<void>;
}

/** One file as last seen: what it looked like, and since when. */
interface Sighting {
  sizeBytes: number;
  mtimeMs: number;
  sinceMs: number;
}

/** What identifies one version of a file. A change to either is a new version. */
function versionOf(file: { sizeBytes: number; mtimeMs: number }): string {
  return `${file.sizeBytes}:${file.mtimeMs}`;
}

/**
 * Builds the watcher. Nothing runs until `start` or `scanOnce`.
 *
 * @param options - The database, buckets and events the upload path uses, and the settings.
 * @returns The watcher.
 */
export function createWatcher(options: WatcherOptions): Watcher {
  const { db, storage, events, config, now = Date.now, log = console } = options;
  const seen = new Map<string, Sighting>();
  /** Files refused, by path, with the version refused: tried again once it changes. */
  const rejected = new Map<string, string>();
  /** The last line said about each file, by path, so a poll repeats nothing. */
  const saidOfFiles = new Map<string, string>();
  /** The same for the watcher itself: its owner and its directory. */
  const saidOfWatcher = new Map<string, string>();
  let isStopping = false;
  let timer: NodeJS.Timeout | null = null;
  let scanning: Promise<void> | null = null;

  const sayOnce = (said: Map<string, string>, key: string, line: string, level: 'info' | 'warn' = 'warn') => {
    if (said.get(key) === line) {
      return;
    }
    said.set(key, line);
    log[level](line);
  };

  /** The owner's id, or null with the reason logged once. */
  const resolveOwner = async (): Promise<string | null> => {
    if (config.owner === null) {
      sayOnce(
        saidOfWatcher,
        'owner',
        '[watch] WATCH_DIR is set but WATCH_OWNER is not: not watching. Set it to an account email.',
      );
      return null;
    }
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, config.owner));
    if (!owner) {
      sayOnce(
        saidOfWatcher,
        'owner',
        `[watch] WATCH_OWNER ${config.owner} has no account here: not watching until it signs in once.`,
      );
      return null;
    }
    sayOnce(saidOfWatcher, 'owner', `[watch] filing ${config.dir} into ${config.owner}'s archive`, 'info');
    return owner.id;
  };

  /** Removes a filed file, unless it has changed since it was read. */
  const remove = async (file: WatchedFile, what: string) => {
    const info = await stat(file.path).catch(() => null);
    if (info === null) {
      log.info(`[watch] ${file.relativePath}: ${what}; the file is already gone`);
      return;
    }
    if (versionOf({ sizeBytes: info.size, mtimeMs: info.mtimeMs }) !== versionOf(file)) {
      log.warn(`[watch] ${file.relativePath}: ${what}, but it changed since; left in place for the next pass`);
      return;
    }
    try {
      await unlink(file.path);
    } catch (error) {
      // Usually a share mounted read-only. The next pass finds it a duplicate and tries again.
      sayOnce(
        saidOfFiles,
        file.path,
        `[watch] ${file.relativePath}: ${what}, but could not remove it (${errorMessage(error)})`,
      );
      return;
    }
    saidOfFiles.delete(file.path);
    log.info(`[watch] ${file.relativePath}: ${what}; removed`);
  };

  const fileOne = async (userId: string, file: WatchedFile) => {
    try {
      const result = await ingestFile({ db, storage, events }, userId, file, () => isStopping);
      if (result.kind === 'stopped') {
        return;
      }
      seen.delete(file.path);
      await remove(
        file,
        result.kind === 'filed'
          ? `filed as "${result.doc.title}"`
          : `already in the archive as "${result.doc.title}", not added again`,
      );
    } catch (error) {
      if (error instanceof Rejected) {
        rejected.set(file.path, versionOf(file));
        sayOnce(saidOfFiles, file.path, `[watch] ${file.relativePath}: ${error.message}. Left in place.`);
        return;
      }
      // Storage or the database: worth another go on the next pass.
      sayOnce(
        saidOfFiles,
        file.path,
        `[watch] ${file.relativePath}: could not file it (${errorMessage(error)}); will retry`,
      );
    }
  };

  const scan = async () => {
    const userId = await resolveOwner();
    if (userId === null) {
      return;
    }
    let files: WatchedFile[];
    try {
      files = await listFiles(config.dir);
      saidOfWatcher.delete('dir');
    } catch (error) {
      sayOnce(saidOfWatcher, 'dir', `[watch] cannot read ${config.dir}: ${errorMessage(error)}. Is it mounted?`);
      return;
    }

    const present = new Set(files.map((file) => file.path));
    for (const byPath of [seen, rejected, saidOfFiles]) {
      for (const key of byPath.keys()) {
        if (present.has(key) === false) {
          byPath.delete(key);
        }
      }
    }

    const at = now();
    for (const file of files) {
      if (isStopping) {
        return;
      }
      const version = versionOf(file);
      if (rejected.get(file.path) === version) {
        continue;
      }
      rejected.delete(file.path);
      const last = seen.get(file.path);
      if (last === undefined || versionOf(last) !== version) {
        seen.set(file.path, { sizeBytes: file.sizeBytes, mtimeMs: file.mtimeMs, sinceMs: at });
        continue;
      }
      if (at - last.sinceMs >= config.stableMs) {
        await fileOne(userId, file);
      }
    }
  };

  const scanOnce = async () => {
    if (isStopping) {
      return;
    }
    // One pass at a time: a pass still filing a large scan is not overlapped by the next.
    if (scanning === null) {
      scanning = scan()
        .catch((error) => log.warn(`[watch] pass failed: ${errorMessage(error)}`))
        .finally(() => {
          scanning = null;
        });
    }
    await scanning;
  };

  const tick = async () => {
    await scanOnce();
    if (isStopping === false) {
      timer = setTimeout(tick, config.pollMs);
    }
  };

  return {
    scanOnce,
    start() {
      void tick();
    },
    async stop() {
      isStopping = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await scanning;
    },
  };
}

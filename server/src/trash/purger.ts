import type { DB } from '@cubicecho/engrafo-db';
import type { TrashConfig } from '../core/config.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_DAY } from '../core/wire.ts';
import type { StorageSet } from '../storage/s3.ts';
import { purgeTrash } from './trash.ts';

// Empties the trash of what has sat there past the retention period: once at boot, then on an
// interval. A timer in the process, like the watcher's, rather than a job: there is one server.

/** What the purger needs. */
export interface TrashPurgerOptions {
  db: DB;
  storage: StorageSet;
  config: TrashConfig;
  /** What time it is. A test hands in its own clock. */
  now?: () => Date;
  log?: (message: string) => void;
}

/** The purger, started and stopped by the boot. */
export interface TrashPurger {
  /** Purges once now, then every `purgeIntervalMs`. */
  start(): void;
  /** Stops the timer and waits for a purge in progress to finish. */
  stop(): Promise<void>;
  /** One pass, for tests and for the first run. Resolves to how many documents were purged. */
  purgeOnce(): Promise<number>;
}

/**
 * Builds the trash purger.
 *
 * @param options - The database, the buckets, the retention settings.
 */
export function createTrashPurger({
  db,
  storage,
  config,
  now = () => new Date(),
  log = console.log,
}: TrashPurgerOptions): TrashPurger {
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<unknown> | null = null;
  let isStopping = false;

  async function purgeOnce(): Promise<number> {
    const deletedBefore = new Date(now().getTime() - config.retentionDays * SECONDS_PER_DAY * MS_PER_SECOND);
    return purgeTrash({ db, storage }, { deletedBefore });
  }

  function tick() {
    if (isStopping || running) {
      return;
    }
    running = purgeOnce()
      .then((count) => {
        if (count > 0) {
          log(`[trash] purged ${count} document(s) older than ${config.retentionDays} day(s)`);
        }
      })
      .catch((error) => log(`[trash] purge failed: ${errorMessage(error)}`))
      .finally(() => {
        running = null;
      });
  }

  return {
    start() {
      tick();
      timer = setInterval(tick, config.purgeIntervalMs);
      // The interval alone must not keep a process alive that is otherwise done.
      timer.unref();
    },
    async stop() {
      isStopping = true;
      if (timer) {
        clearInterval(timer);
      }
      await running;
    },
    purgeOnce,
  };
}

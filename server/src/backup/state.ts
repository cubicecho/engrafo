import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BACKUP_DEFAULTS } from '../core/defaults.ts';
import { conflict, errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';

// What the backup door holds between requests: export links waiting to be followed, and import
// runs being watched. Both in memory, on purpose. A link lives for minutes and a restart that
// forgets it costs one more click; an import is idempotent by checksum, so one cut off by a
// restart is finished by running the same archive again. Neither is worth a table.

/** Random bytes in an export link's token: 256 bits, base64url. */
const TOKEN_BYTES = 32;
const LINK_TTL_MS = BACKUP_DEFAULTS.exportLinkTtlMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;
const IMPORT_RETENTION_MS = BACKUP_DEFAULTS.importRetentionMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** A minted export link's secret and when it stops working. */
export interface MintedLink {
  token: string;
  expiresAt: Date;
}

/**
 * Single-use, short-lived tokens that stand for one user's export. A session is a bearer token
 * the browser cannot attach to a plain link, so the app asks for one of these over GraphQL and
 * hands the browser `/export/<token>`, which streams to disk with its own progress.
 */
export interface ExportLinks {
  mint(userId: string): MintedLink;
  /**
   * Spends a token.
   *
   * @returns Whose export it is, or null for a token that is unknown, expired or already spent.
   *   The three are one answer, so a guess learns nothing.
   */
  redeem(token: string): string | null;
}

/** Only the token's hash is kept, so what is in memory cannot be followed as a link. */
function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The export links of one server.
 *
 * @param now - The clock, in milliseconds. Tests pass their own.
 */
export function createExportLinks(now: () => number = Date.now): ExportLinks {
  const links = new Map<string, { userId: string; expiresAt: number }>();
  return {
    mint(userId) {
      const at = now();
      for (const [hash, link] of links) {
        if (link.expiresAt <= at) {
          links.delete(hash);
        }
      }
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      const expiresAt = at + LINK_TTL_MS;
      links.set(hashOf(token), { userId, expiresAt });
      return { token, expiresAt: new Date(expiresAt) };
    },
    redeem(token) {
      const hash = hashOf(token);
      const link = links.get(hash);
      links.delete(hash);
      return link && link.expiresAt > now() ? link.userId : null;
    },
  };
}

/** One document an import did not add, and why. */
export interface ImportItem {
  title: string;
  reason: string;
}

/** Where an import run is. */
export type ImportState = 'running' | 'done' | 'failed';

/** One import run, updated as it goes; GraphQL reads it as it stands. */
export interface ImportJob {
  id: string;
  userId: string;
  state: ImportState;
  /** How many documents the archive lists, once its manifest has been read. */
  total: number | null;
  imported: number;
  /** Already in the archive, by checksum. */
  skipped: ImportItem[];
  failed: ImportItem[];
  /** Why the whole run stopped, when it did: not an export, or the stream broke. */
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  /** Settles when the run is over, either way. Never rejects. */
  finished: Promise<void>;
}

/** The import runs of one server, at most one running per user. */
export interface ImportJobs {
  /**
   * Starts a run in the background and returns it at once.
   *
   * @param userId - Whose archive it fills.
   * @param run - The work, which updates the job as it goes. A throw marks the run failed.
   * @throws CONFLICT while another of the user's imports is running: two at once would race the
   *   checksum check and add each document twice.
   */
  start(userId: string, run: (job: ImportJob) => Promise<void>): ImportJob;
  /** The user's most recent run, running or finished, or null. */
  latest(userId: string): ImportJob | null;
}

/**
 * The import runs of one server.
 *
 * @param now - The clock, in milliseconds.
 */
export function createImportJobs(now: () => number = Date.now): ImportJobs {
  const latestByUser = new Map<string, ImportJob>();
  return {
    start(userId, run) {
      if (latestByUser.get(userId)?.state === 'running') {
        throw conflict('An import is already running. Wait for it to finish.');
      }
      const job: ImportJob = {
        id: randomUUID(),
        userId,
        state: 'running',
        total: null,
        imported: 0,
        skipped: [],
        failed: [],
        error: null,
        startedAt: new Date(now()),
        finishedAt: null,
        finished: Promise.resolve(),
      };
      job.finished = (async () => {
        try {
          await run(job);
          job.state = 'done';
        } catch (error) {
          job.state = 'failed';
          job.error = errorMessage(error);
          console.error(`[backup] import ${job.id} stopped: ${job.error}`);
        }
        job.finishedAt = new Date(now());
      })();
      latestByUser.set(userId, job);
      return job;
    },
    latest(userId) {
      const job = latestByUser.get(userId) ?? null;
      if (job?.finishedAt && now() - job.finishedAt.getTime() > IMPORT_RETENTION_MS) {
        latestByUser.delete(userId);
        return null;
      }
      return job;
    },
  };
}

/** Everything the backup door keeps between requests. */
export interface Backups {
  links: ExportLinks;
  imports: ImportJobs;
}

/**
 * A fresh set, for one server or one test.
 *
 * @param now - The clock, in milliseconds.
 */
export function createBackups(now: () => number = Date.now): Backups {
  return { links: createExportLinks(now), imports: createImportJobs(now) };
}

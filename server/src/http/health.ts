import type { Queryable } from '@cubicecho/engrafo-db/wait';
import { sql } from 'drizzle-orm';
import { version } from '../core/config.ts';

/** What a failed probe says. The reason itself is in the server log. */
export const DATABASE_UNREACHABLE = 'database unreachable';

/** What /healthz answers. */
export interface Health {
  ok: boolean;
  /** The released version (config.ts). */
  version: string;
  /** What is wrong, in words that are safe to hand an unauthenticated caller. Only present when `ok` is false. */
  error?: string;
}

/**
 * Round-trips to the database. A live process with a dead database is not healthy.
 *
 * @param db - Database client.
 * @returns The health report.
 */
export async function checkHealth(db: Queryable): Promise<Health> {
  try {
    await db.execute(sql`select 1`);
    return { ok: true, version: version() };
  } catch (error) {
    // The driver's message names the query and can name the host; it goes to the log, not the caller.
    console.error('[server] health check failed:', error);
    return { ok: false, version: version(), error: DATABASE_UNREACHABLE };
  }
}

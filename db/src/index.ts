import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { DATABASE_DEFAULTS } from './defaults.ts';
import { relations } from './relations.ts';
import * as schema from './schema.ts';
import { requiresSsl } from './ssl.ts';

// Engrafo is Postgres-only. There is no embedded fallback: a missing
// DATABASE_URL is a misconfiguration, and silently writing somewhere else would
// hide it until the data mattered.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and run `npm run db:up` for a local Postgres.');
}

const isProduction = process.env.NODE_ENV === 'production';

// drizzle-orm 1.0 takes the tables through the relations config built by
// defineRelations, and that config is also what drizzle-graphql reads.
const { drizzle } = await import('drizzle-orm/postgres-js');
const connection = {
  url: DATABASE_URL,
  ...(isProduction && requiresSsl(DATABASE_URL) ? { ssl: 'require' as const } : {}),
  // Every boot runs `CREATE SCHEMA IF NOT EXISTS "drizzle"`, and Postgres answers
  // with a NOTICE when it already does. Printing it makes a healthy restart look
  // like a failure, so notices are dropped; real errors still throw.
  onnotice: () => {},
};

/**
 * A Drizzle Postgres database over this schema, whichever driver is behind it.
 * The server runs on postgres-js and the tests on PGlite, and both satisfy it.
 */
export type DB = PgAsyncDatabase<PgQueryResultHKT, typeof relations>;

/** The process's one Drizzle client, on postgres-js, bound to `DATABASE_URL`. */
export const db = drizzle({ connection, relations });

/**
 * Closes the pool at shutdown, after the server has drained.
 *
 * @returns Resolves once every connection is closed. Queries still running are cancelled after `closeTimeoutSeconds`.
 */
export const closeDatabase = (): Promise<void> => db.$client.end({ timeout: DATABASE_DEFAULTS.closeTimeoutSeconds });

export * from './schema.ts';
export { relations, schema };

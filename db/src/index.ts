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
// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 rc overload resolution
const connection: any = {
  url: DATABASE_URL,
  ...(isProduction && requiresSsl(DATABASE_URL) ? { ssl: 'require' } : {}),
  // Every boot runs `CREATE SCHEMA IF NOT EXISTS "drizzle"`, and Postgres answers
  // with a NOTICE when it already does. Printing it makes a healthy restart look
  // like a failure, so notices are dropped; real errors still throw.
  onnotice: () => {},
};

// biome-ignore lint/suspicious/noExplicitAny: db type varies by driver at runtime; callers cast as needed
export type DB = any;
export const db: DB = drizzle({ connection, relations });

export { relations, schema };
export * from './schema.ts';

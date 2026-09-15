import type { BuildSchemaConfig, RowScope } from '@vantreeseba/drizzle-graphql';
import { eq } from 'drizzle-orm';
import type { Context } from './context.ts';
import { requireAuth } from './resolvers/auth.ts';

// Multi-tenancy, expressed as drizzle-graphql configuration rather than as
// resolver wrappers. `scope` is ANDed into the SQL of every read the library
// generates — list and single queries, aggregates, relation fields — after the
// client's own `where`, so a client filter can only ever narrow it.
//
// The rule for anyone adding a table: it needs an entry here, or its rows are
// visible across tenants. __tests__/tenancy.test.ts fails when one is missing.

// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 table/column type compat
type AnyTable = any;

export const USER_OWNED_TABLES = ['documents', 'processingSteps'] as const;

/** Every table drizzle-graphql will generate fields for. */
export const ALL_TABLES = ['users', ...USER_OWNED_TABLES] as const;

const scopeByUserId: RowScope<Context> = (context, table) => eq((table as AnyTable).userId, requireAuth(context));

export const scope: NonNullable<BuildSchemaConfig['scope']> = {
  // A user row is only ever visible to its owner. There is no directory here.
  users: (context, table) => eq((table as AnyTable).id, requireAuth(context as Context)),
  ...Object.fromEntries(USER_OWNED_TABLES.map((name) => [name, scopeByUserId])),
};

/**
 * Columns the server owns, stamped from the request. No table here has
 * generated writes today; this is kept so turning one on cannot forget it.
 */
export const contextValues: NonNullable<BuildSchemaConfig['contextValues']> = Object.fromEntries(
  USER_OWNED_TABLES.map((name) => [name, { userId: (context: Context) => requireAuth(context) }]),
);

/**
 * No generated writes at all. Every column a client could set on a document is
 * either the server's (`status`, `originalKey`, `archiveKey`, `checksumSha256`)
 * or the pipeline's (`content`, the step rows), and an upload is a two-phase
 * handshake with S3 that CRUD cannot express. resolvers/documents.ts owns every
 * write; `users` belongs to the auth flow.
 */
export const features: NonNullable<BuildSchemaConfig['features']> = {
  insert: false,
  update: false,
  updateMany: false,
  delete: false,
};

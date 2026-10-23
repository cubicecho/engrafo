import type { BuildSchemaConfig, RowScope } from '@vantreeseba/drizzle-graphql';
import { and, eq, isNull } from 'drizzle-orm';
import type { Context } from '../core/context.ts';
import { requireAuth } from '../core/errors.ts';

// Multi-tenancy, expressed as drizzle-graphql configuration rather than as
// resolver wrappers. `scope` is ANDed into the SQL of every read the library
// generates — list and single queries, aggregates, relation fields — after the
// client's own `where`, so a client filter can only ever narrow it.
//
// The rule for anyone adding a table: it needs an entry here, or its rows are
// visible across tenants. __tests__/tenancy.test.ts fails when one is missing.

// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 table/column type compat
type AnyTable = any;

/** The tables whose rows carry a `userId` and are scoped by it. */
export const USER_OWNED_TABLES = ['documents', 'folders', 'processingSteps'] as const;

/** Every table drizzle-graphql will generate fields for. */
export const ALL_TABLES = ['users', ...USER_OWNED_TABLES] as const;

const ownedBy = (context: Context, table: AnyTable) => eq(table.userId, requireAuth(context));
const scopeByUserId: RowScope<Context> = ownedBy;

/**
 * The row filter for each table, ANDed into every generated read after the client's own `where`.
 * A table missing here is visible across tenants.
 */
export const scope: NonNullable<BuildSchemaConfig['scope']> = {
  // A user row is only ever visible to its owner. There is no directory here.
  users: (context, table) => eq((table as AnyTable).id, requireAuth(context)),
  ...Object.fromEntries(USER_OWNED_TABLES.map((name) => [name, scopeByUserId])),
  // A document in the trash is out of every generated read: the lists, `document(id)`, a folder's
  // `documents`, the aggregates. The trash's own query (trash/resolvers.ts) is the one way to see it.
  // Built from `table`, not the imported one: on a relation read it is drizzle's alias.
  // Not drizzle-graphql's `softDelete`: that generates `restoreDocuments` whatever `features`
  // says, and a restore here has to number a taken name and restart the pipeline.
  documents: (context, table) => and(ownedBy(context, table), isNull((table as AnyTable).deletedAt)),
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
 * or the pipeline's (`contentKey`, the step rows), and an upload is a two-phase
 * handshake with S3 that CRUD cannot express. documents/resolvers.ts owns every
 * write; `users` belongs to the auth flow.
 */
export const features: NonNullable<BuildSchemaConfig['features']> = {
  insert: false,
  update: false,
  updateMany: false,
  delete: false,
};

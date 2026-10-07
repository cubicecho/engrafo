import type { DB } from '@cubicecho/engrafo-db';
import { AUTH_TABLES } from '@cubicecho/engrafo-db/schema';
import { buildSchema, type GeneratedData } from '@vantreeseba/drizzle-graphql';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import { applyAuthExtension } from '../auth/resolvers.ts';
import { applyDocumentsExtension } from '../documents/resolvers.ts';
import { contextValues, features, scope } from './tenancy.ts';

// Reads are generated from the Drizzle schema; every write is hand-written (see
// `features` in tenancy.ts for why). Kept separate from schema.ts, which binds
// it to the real database, so a test can build the same schema against a
// throwaway one.

/**
 * With every generated write turned off, drizzle-graphql omits the Mutation
 * type entirely, and `extend type Mutation` has nothing to extend. An empty root
 * is invalid on its own, but the extensions fill it before anything validates.
 */
function withMutationRoot(schema: GraphQLSchema): GraphQLSchema {
  if (schema.getMutationType()) {
    return schema;
  }
  return new GraphQLSchema({ ...schema.toConfig(), mutation: new GraphQLObjectType({ name: 'Mutation', fields: {} }) });
}

/**
 * Builds the served schema: generated reads, then the hand-written auth and document fields.
 *
 * @param db - Database client the generated resolvers query.
 * @returns The schema, and drizzle-graphql's entities for anything that wants its resolvers.
 */
export function createSchema(db: DB): GeneratedData<DB, 'singularize'> {
  const { schema: drizzleSchema, entities } = buildSchema(db, {
    prefixes: {
      insert: 'create',
      update: 'update',
      delete: 'delete',
    },
    // Table keys are plural (`documents`); derive singular names for the type
    // and single-row fields (Document, document).
    typeNameMapper: 'singularize',
    // Sessions and magic-link tokens are only ever touched through better-auth.
    exclude: { tables: [...AUTH_TABLES] },
    scope,
    contextValues,
    features,
  });

  let schema = withMutationRoot(drizzleSchema);
  schema = applyAuthExtension(schema);
  schema = applyDocumentsExtension(schema);

  return { schema, entities };
}

import { buildSchema } from '@vantreeseba/drizzle-graphql';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import { applyAuthExtension } from './resolvers/auth.ts';
import { applyDocumentsExtension } from './resolvers/documents.ts';
import { contextValues, features, scope } from './tenancy.ts';

// Reads are generated from the Drizzle schema; every write is hand-written (see
// `features` in tenancy.ts for why). Kept separate from schema.ts, which binds
// it to the real database, so a test can build the same schema against a
// throwaway one.

// biome-ignore lint/suspicious/noExplicitAny: db type varies by driver
type AnyDb = any;

/**
 * With every generated write turned off, drizzle-graphql omits the Mutation
 * type entirely, and `extend type Mutation` has nothing to extend. An empty root
 * is invalid on its own, but the extensions fill it before anything validates.
 */
function withMutationRoot(schema: GraphQLSchema): GraphQLSchema {
  if (schema.getMutationType()) return schema;
  return new GraphQLSchema({ ...schema.toConfig(), mutation: new GraphQLObjectType({ name: 'Mutation', fields: {} }) });
}

export function createSchema(db: AnyDb) {
  const { schema: drizzleSchema, entities } = buildSchema(db, {
    prefixes: {
      insert: 'create',
      update: 'update',
      delete: 'delete',
    },
    // Table keys are plural (`documents`); derive singular names for the type
    // and single-row fields (Document, document).
    typeNameMapper: 'singularize',
    scope,
    contextValues,
    features,
  });

  let schema = withMutationRoot(drizzleSchema);
  schema = applyAuthExtension(schema);
  schema = applyDocumentsExtension(schema);

  return { schema, entities };
}

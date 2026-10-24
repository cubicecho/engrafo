import type { DB } from '@cubicecho/engrafo-db';
import { AUTH_TABLES, SEARCH_TABLES, SERVER_TABLES } from '@cubicecho/engrafo-db/schema';
import { buildSchema, type GeneratedData } from '@vantreeseba/drizzle-graphql';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import { applyApiKeysExtension } from '../api-keys/resolvers.ts';
import { applyAuthExtension } from '../auth/resolvers.ts';
import { applyBackupExtension } from '../backup/resolvers.ts';
import { applyDuplicatesExtension } from '../documents/duplicates.ts';
import { applyDocumentsExtension } from '../documents/resolvers.ts';
import { applyFoldersExtension } from '../folders/resolvers.ts';
import { applyMetadataExtension } from '../metadata/resolvers.ts';
import { applySavedSearchesExtension } from '../saved-searches/resolvers.ts';
import { applySearchExtension } from '../search/resolvers.ts';
import { applySsoExtension } from '../sso/resolvers.ts';
import { applyVisionExtension } from '../vision/resolvers.ts';
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
    // Sessions and magic-link tokens are only ever touched through better-auth,
    // and the OIDC pairing holds credentials only the server reads.
    exclude: { tables: [...AUTH_TABLES, ...SERVER_TABLES, ...SEARCH_TABLES] },
    scope,
    contextValues,
    features,
  });

  let schema = withMutationRoot(drizzleSchema);
  schema = applyAuthExtension(schema);
  schema = applyDocumentsExtension(schema);
  schema = applyDuplicatesExtension(schema);
  schema = applyFoldersExtension(schema);
  schema = applyMetadataExtension(schema);
  schema = applySearchExtension(schema);
  // After search, whose DocumentSearchFilter it takes.
  schema = applySavedSearchesExtension(schema);
  schema = applySsoExtension(schema);
  schema = applyApiKeysExtension(schema);
  schema = applyVisionExtension(schema);
  schema = applyBackupExtension(schema);

  return { schema, entities };
}

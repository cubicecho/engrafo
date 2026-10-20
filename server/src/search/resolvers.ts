import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import type { Context } from '../core/context.ts';
import { SEARCH_DEFAULTS } from '../core/defaults.ts';
import { requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { searchDocuments } from './search.ts';

const SEARCH_SDL = parse(`
  "A document a search found, with the part of it that matched."
  type DocumentSearchHit {
    document: Document!
    "Part of the best-matching passage. Empty when only the title matched."
    snippet: String!
    "Higher is better. Only the order means anything; scores are not comparable across searches."
    score: Float!
  }

  extend type Query {
    "Searches the caller's documents by meaning and by exact words, best match first."
    searchDocuments(query: String!, first: Int): [DocumentSearchHit!]!
  }
`);

const argsSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'Type something to search for.')
    .max(SEARCH_DEFAULTS.queryMaxChars, 'That search is too long.'),
  first: z
    .number()
    .int()
    .min(1)
    .max(SEARCH_DEFAULTS.maxResults, `Ask for at most ${SEARCH_DEFAULTS.maxResults} results.`)
    .nullish(),
});

/**
 * Adds `searchDocuments` to the schema.
 *
 * @param schema - The schema, which must already have the generated `Document` type.
 * @returns The extended schema.
 */
export function applySearchExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, SEARCH_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();

  queries.searchDocuments.resolve = async (_parent: unknown, args: unknown, context: Context) => {
    const userId = requireAuth(context);
    const { query, first } = parseOrThrow(argsSchema, args);
    return searchDocuments(context, userId, query, first ?? SEARCH_DEFAULTS.defaultResults);
  };

  return extended;
}

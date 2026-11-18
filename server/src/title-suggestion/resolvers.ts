import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import type { Context } from '../core/context.ts';
import { requireAuth } from '../core/errors.ts';
import { suggestDocumentTitle } from './suggest.ts';

const TITLE_SUGGESTION_SDL = parse(`
  extend type Query {
    """
    A title for the caller's documents taken as one, in the order given, as the vision model
    suggests it from their titles, dates, vendors and the start of their text. Nothing is written.
    Refused when no model is set up; \`serverConfig.visionAvailable\` says whether one is.
    """
    suggestDocumentTitle(ids: [UUID!]!): String!
  }
`);

/**
 * Adds `suggestDocumentTitle`.
 *
 * @param schema - The schema, already holding the `UUID` scalar.
 * @returns The extended schema.
 */
export function applyTitleSuggestionExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, TITLE_SUGGESTION_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();

  queries.suggestDocumentTitle.resolve = async (_parent: unknown, args: { ids: string[] }, context: Context) =>
    suggestDocumentTitle(context, requireAuth(context), args.ids);

  return extended;
}

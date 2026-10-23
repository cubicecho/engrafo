import { documents, FieldSource } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import type { Context } from '../core/context.ts';
import { parseOrThrow } from '../core/validation.ts';
import { loadOwned } from '../documents/resolvers.ts';
import { calendarDaySchema } from './schemas.ts';

// The fields read from a document's content, as the user corrects them. Each write marks its
// field `user`, which is what keeps the pipeline's metadata step off it on every later run.

const METADATA_SDL = parse(`
  extend type Mutation {
    """
    Sets the date on the document (\`YYYY-MM-DD\`), or clears it with null. Either way the date is
    then the caller's: processing the document again does not read one from its text.
    """
    setDocumentDate(id: UUID!, date: String): Document!
  }
`);

const setDateSchema = z.object({ date: calendarDaySchema.nullish() });

/**
 * Adds the document-date and receipt writes to the schema.
 *
 * @param schema - The schema, which must already have the generated `Document` type.
 * @returns The extended schema.
 */
export function applyMetadataExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, METADATA_SDL);
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();

  mutations.setDocumentDate.resolve = async (
    _parent: unknown,
    args: { id: string; date?: string | null },
    context: Context,
  ) => {
    const doc = await loadOwned(context, args.id);
    const { date } = parseOrThrow(setDateSchema, { date: args.date });
    const [updated] = await context.db
      .update(documents)
      .set({ documentDate: date ?? null, documentDateSource: FieldSource.User })
      .where(eq(documents.id, doc.id))
      .returning();
    return updated;
  };

  return extended;
}

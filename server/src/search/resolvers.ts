import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import type { Context } from '../core/context.ts';
import { SEARCH_DEFAULTS } from '../core/defaults.ts';
import { requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { folderAndDescendants } from '../folders/names.ts';
import { calendarDaySchema } from '../metadata/schemas.ts';
import { DocumentKind, type SearchFilter } from './filters.ts';
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

  "What a document is, as a search narrows by it."
  enum DocumentKind {
    PDF
    "PNG, JPEG, TIFF: a scan or a photo."
    IMAGE
    "Plain text and Markdown."
    TEXT
    EBOOK
  }

  "What a search is narrowed to. Every field left out narrows nothing."
  input DocumentSearchFilter {
    "Only documents filed in this folder, and in every folder inside it unless \`includeSubfolders\` is false."
    folderId: UUID
    includeSubfolders: Boolean = true
    "Only documents of these kinds."
    kinds: [DocumentKind!]
    "Only documents dated on or after this day (\`YYYY-MM-DD\`), by the date on the document. An undated one is left out."
    dateFrom: String
    "Only documents dated on or before this day."
    dateTo: String
    "True, only documents with a receipt's vendor or total; false, only those with neither."
    hasReceipt: Boolean
  }

  extend type Query {
    "Searches the caller's documents by meaning and by exact words, best match first."
    searchDocuments(query: String!, first: Int, filter: DocumentSearchFilter): [DocumentSearchHit!]!
  }
`);

const filterSchema = z
  .object({
    folderId: z.uuid('That is not a folder id.').nullish(),
    includeSubfolders: z.boolean().nullish(),
    kinds: z.array(z.enum(Object.values(DocumentKind))).nullish(),
    dateFrom: calendarDaySchema.nullish(),
    dateTo: calendarDaySchema.nullish(),
    hasReceipt: z.boolean().nullish(),
  })
  .refine(
    ({ dateFrom, dateTo }) => (dateFrom && dateTo ? dateFrom <= dateTo : true),
    'The range ends before it starts.',
  );

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
  filter: filterSchema.nullish(),
});

/**
 * The filter as the search reads it, with a folder turned into the folders it stands for.
 *
 * @remarks
 * A folder that is not the caller's has no descendants of theirs and matches none of their
 * documents, which is what an empty folder of their own answers: nothing says it exists.
 */
async function resolveFilter(
  context: Context,
  userId: string,
  filter: z.infer<typeof filterSchema> | null | undefined,
): Promise<SearchFilter> {
  if (!filter) {
    return {};
  }
  const { folderId, includeSubfolders } = filter;
  let folderIds: string[] | undefined;
  if (folderId) {
    folderIds = includeSubfolders === false ? [folderId] : await folderAndDescendants(context.db, userId, folderId);
  }
  return {
    folderIds,
    kinds: filter.kinds ?? undefined,
    dateFrom: filter.dateFrom ?? undefined,
    dateTo: filter.dateTo ?? undefined,
    hasReceipt: filter.hasReceipt ?? undefined,
  };
}

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
    const { query, first, filter } = parseOrThrow(argsSchema, args);
    return searchDocuments(context, userId, query, first ?? SEARCH_DEFAULTS.defaultResults, {
      filter: await resolveFilter(context, userId, filter),
    });
  };

  return extended;
}

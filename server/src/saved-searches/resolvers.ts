import { type SavedSearchFilters, savedSearches } from '@cubicecho/engrafo-db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLError, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import type { Context } from '../core/context.ts';
import { SAVED_SEARCH_DEFAULTS, SEARCH_DEFAULTS } from '../core/defaults.ts';
import { badInput, conflict, notFound, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { filterSchema } from '../search/resolvers.ts';

// Every write to a saved search. Reads — `savedSearches`, `savedSearch` — are generated and
// scoped in tenancy.ts. A saved search is what the documents page holds in its query string, the
// text and the filters, under a name the sidebar lists it by; the app turns it back into that
// query string, so nothing here runs a search.

const SAVED_SEARCHES_SDL = parse(`
  extend type Mutation {
    """
    Saves a search under a name: the text, the filters, or both. Refused when the caller already
    has a saved search of that name, ignoring case.
    """
    saveSearch(name: String!, query: String, filter: DocumentSearchFilter): SavedSearch!
    "Renames a saved search. Refused when another of the caller's has the name."
    renameSavedSearch(id: UUID!, name: String!): SavedSearch!
    "Forgets a saved search. The documents it found are not touched."
    deleteSavedSearch(id: UUID!): Boolean!
  }
`);

/** Postgres's code for a unique index refusing a row. */
const UNIQUE_VIOLATION = '23505';

export const savedSearchNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the search a name.')
  .max(SAVED_SEARCH_DEFAULTS.nameMaxLength, `Name is longer than ${SAVED_SEARCH_DEFAULTS.nameMaxLength} characters.`);

const saveArgsSchema = z.object({
  name: savedSearchNameSchema,
  query: z
    .string()
    .trim()
    .max(SEARCH_DEFAULTS.queryMaxChars, 'That search is too long.')
    .nullish()
    .transform((query) => (query ? query : null)),
  filter: filterSchema.nullish(),
});

/** Hides a missing saved search and someone else's behind one answer. */
function savedSearchNotFound(): GraphQLError {
  return notFound('Saved search not found');
}

function nameTaken(name: string): GraphQLError {
  return conflict(`You already have a saved search called “${name}”.`);
}

/**
 * The filter as stored: only the fields that narrow something, so a saved search's JSON says
 * what it does and nothing else.
 *
 * @param filter - As `filterSchema` parsed it.
 */
export function storedFilters(filter: z.infer<typeof filterSchema> | null | undefined): SavedSearchFilters {
  if (!filter) {
    return {};
  }
  const stored: SavedSearchFilters = {};
  if (filter.folderId) {
    stored.folderId = filter.folderId;
    // Only beside a folder, where it means something, and only when it is not the default.
    if (filter.includeSubfolders === false) {
      stored.includeSubfolders = false;
    }
  }
  if (filter.kinds && filter.kinds.length > 0) {
    stored.kinds = [...filter.kinds];
  }
  if (filter.dateFrom) {
    stored.dateFrom = filter.dateFrom;
  }
  if (filter.dateTo) {
    stored.dateTo = filter.dateTo;
  }
  if (typeof filter.hasReceipt === 'boolean') {
    stored.hasReceipt = filter.hasReceipt;
  }
  return stored;
}

/** Whether the error, or anything it was caused by, is a unique index refusing the row. */
function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ('code' in current && current.code === UNIQUE_VIOLATION) {
      return true;
    }
  }
  return false;
}

/** Whether the caller already has a saved search by this name, ignoring case, other than `exceptId`. */
async function isNameTaken(context: Context, userId: string, name: string, exceptId?: string): Promise<boolean> {
  const [row] = await context.db
    .select({ id: savedSearches.id })
    .from(savedSearches)
    .where(
      and(
        eq(savedSearches.userId, userId),
        sql`lower(${savedSearches.name}) = lower(${name})`,
        exceptId === undefined ? undefined : ne(savedSearches.id, exceptId),
      ),
    );
  return row !== undefined;
}

/**
 * Adds the saved-search writes to the schema.
 *
 * @param schema - The schema with `DocumentSearchFilter` in it already (the search extension).
 * @returns The extended schema.
 *
 * @remarks
 * Hand-written resolvers do not inherit `scope`, so each states ownership itself. A name is
 * checked before the write for a readable refusal, and the unique index catches the race two
 * saves at once would win past the check.
 */
export function applySavedSearchesExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, SAVED_SEARCHES_SDL);
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();

  mutations.saveSearch.resolve = async (_parent: unknown, args: unknown, context: Context) => {
    const userId = requireAuth(context);
    const { name, query, filter } = parseOrThrow(saveArgsSchema, args);
    const filters = storedFilters(filter);
    if (query === null && Object.keys(filters).length === 0) {
      throw badInput('There is nothing to save: type a search or set a filter.');
    }
    if (await isNameTaken(context, userId, name)) {
      throw nameTaken(name);
    }
    try {
      const [created] = await context.db.insert(savedSearches).values({ userId, name, query, filters }).returning();
      return created;
    } catch (error) {
      throw isUniqueViolation(error) ? nameTaken(name) : error;
    }
  };

  mutations.renameSavedSearch.resolve = async (
    _parent: unknown,
    args: { id: string; name: string },
    context: Context,
  ) => {
    const userId = requireAuth(context);
    const name = parseOrThrow(savedSearchNameSchema, args.name);
    if (z.uuid().safeParse(args.id).success === false) {
      throw savedSearchNotFound();
    }
    if (await isNameTaken(context, userId, name, args.id)) {
      throw nameTaken(name);
    }
    try {
      const [updated] = await context.db
        .update(savedSearches)
        .set({ name })
        .where(and(eq(savedSearches.id, args.id), eq(savedSearches.userId, userId)))
        .returning();
      if (!updated) {
        throw savedSearchNotFound();
      }
      return updated;
    } catch (error) {
      throw isUniqueViolation(error) ? nameTaken(name) : error;
    }
  };

  mutations.deleteSavedSearch.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const userId = requireAuth(context);
    if (z.uuid().safeParse(args.id).success === false) {
      throw savedSearchNotFound();
    }
    const deleted = await context.db
      .delete(savedSearches)
      .where(and(eq(savedSearches.id, args.id), eq(savedSearches.userId, userId)))
      .returning({ id: savedSearches.id });
    if (deleted.length === 0) {
      throw savedSearchNotFound();
    }
    return true;
  };

  return extended;
}

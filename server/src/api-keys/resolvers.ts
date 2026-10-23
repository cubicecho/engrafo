import { apikeys } from '@cubicecho/engrafo-db/schema';
import { APIError } from 'better-auth/api';
import { and, desc, eq } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import type { Context } from '../core/context.ts';
import { API_KEY_DEFAULTS } from '../core/defaults.ts';
import { badInput, notFound, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { SECONDS_PER_DAY } from '../core/wire.ts';

// The caller's API keys: what an MCP client sends instead of a session. better-auth's api-key
// plugin mints and checks them; listing and revoking are plain reads and deletes on its table,
// scoped by owner. Every field here needs a session (`requireAuth`), and /mcp never builds a
// GraphQL context, so a key can never mint its successor.

const API_KEYS_SDL = parse(`
  "One of the caller's API keys. The key itself is shown once, when it is made, and never again."
  type ApiKey {
    id: UUID!
    name: String!
    "The key's first characters, enough to tell it from the others."
    start: String!
    "When an MCP client last used it, or null if none has."
    lastUsedAt: DateTime
    "When it stops working, or null for never."
    expiresAt: DateTime
    createdAt: DateTime!
  }

  type CreatedApiKey {
    apiKey: ApiKey!
    "The whole key. Only its hash is stored, so this is the one time it can be copied."
    key: String!
  }

  extend type Query {
    "The caller's API keys, newest first."
    apiKeys: [ApiKey!]!
  }

  extend type Mutation {
    "Makes an API key for an MCP client. It never expires when \`expiresInDays\` is left out."
    createApiKey(name: String!, expiresInDays: Int): CreatedApiKey!
    "Deletes one of the caller's API keys. Every client using it is refused from then on."
    revokeApiKey(id: UUID!): Boolean!
  }
`);

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the key a name.')
    .max(API_KEY_DEFAULTS.nameMaxLength, `Keep the name to ${API_KEY_DEFAULTS.nameMaxLength} characters.`),
  expiresInDays: z.number().int().min(1, 'A key has to last at least a day.').nullish(),
});

const idSchema = z.uuid();

/** The columns of a key the app is shown. */
interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  lastRequest: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

/** A stored key, or better-auth's copy of it, as the `ApiKey` type. */
function toApiKey(row: ApiKeyRow) {
  return {
    id: row.id,
    name: row.name ?? '',
    start: row.start ?? '',
    lastUsedAt: row.lastRequest,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/**
 * Adds listing, making and revoking the caller's API keys to the schema.
 *
 * @param schema - The schema so far, which must already have a Mutation type.
 * @returns The extended schema.
 */
export function applyApiKeysExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, API_KEYS_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();

  queries.apiKeys.resolve = async (_parent: unknown, _args: unknown, context: Context) => {
    const userId = requireAuth(context);
    const rows = await context.db
      .select()
      .from(apikeys)
      .where(eq(apikeys.referenceId, userId))
      .orderBy(desc(apikeys.createdAt));
    return rows.map(toApiKey);
  };

  mutations.createApiKey.resolve = async (
    _parent: unknown,
    args: { name: string; expiresInDays?: number | null },
    context: Context,
  ) => {
    const userId = requireAuth(context);
    const { name, expiresInDays } = parseOrThrow(createSchema, args);
    try {
      // Minted server-side, with no headers, so the owner is the session's and not an argument.
      // No rate limit of its own: the plugin's default of ten a day would starve any agent.
      const created = await context.auth.api.createApiKey({
        body: {
          userId,
          name,
          rateLimitEnabled: false,
          expiresIn: expiresInDays ? expiresInDays * SECONDS_PER_DAY : undefined,
        },
      });
      return { apiKey: toApiKey(created), key: created.key };
    } catch (error) {
      if (error instanceof APIError) {
        throw badInput(error.message);
      }
      throw error;
    }
  };

  mutations.revokeApiKey.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const userId = requireAuth(context);
    const id = idSchema.safeParse(args.id);
    if (id.success === false) {
      throw notFound('API key not found.');
    }
    // One statement scoped to the owner, so someone else's key and a missing one answer the same.
    const revoked = await context.db
      .delete(apikeys)
      .where(and(eq(apikeys.id, id.data), eq(apikeys.referenceId, userId)))
      .returning({ id: apikeys.id });
    if (revoked.length === 0) {
      throw notFound('API key not found.');
    }
    return true;
  };

  return extended;
}

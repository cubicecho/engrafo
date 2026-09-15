import * as dbSchema from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { extendSchema, GraphQLError, type GraphQLObjectType, type GraphQLSchema, parse } from 'graphql';
import jwt from 'jsonwebtoken';
import { magicLinkExposed, magicLinkRequired } from '../config.ts';
import type { Context } from '../context.ts';
import { createRateLimiter } from '../rate-limit.ts';

const DEV_SECRET = 'dev-secret-change-in-production';

/** Read at call time so a test — or a reload — sees the current environment. */
function jwtSecret(): string {
  return process.env.JWT_SECRET ?? DEV_SECRET;
}

/**
 * Where magic links point. In production the server serves the client itself,
 * so its own origin is the right default — but only for someone browsing from
 * this machine. Set APP_URL to the address users actually type; a link to
 * `localhost` is useless in an inbox.
 */
function appUrl(): string {
  return process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3004}`;
}

// Five sign-in attempts per address per quarter hour. requestMagicLink is
// unauthenticated, so without this anyone who can reach the port can mint magic
// tokens at will. Per-IP limiting belongs in the reverse proxy, which is the
// only thing that reliably knows the client's address.
const signInLimiter = createRateLimiter(5, 15 * 60 * 1000);

const AUTH_SDL = parse(`
  """
  The outcome of a sign-in request. When the instance runs with
  AUTH_MAGIC_LINK=false there is no link to follow, so a live session comes back
  immediately in \`token\`/\`userId\`. When magic links are on, \`magicLink\` is
  filled in only where exposing it is enabled.
  """
  type RequestMagicLinkResult {
    ok: Boolean!
    magicLink: String
    token: String
    userId: ID
  }

  type AuthPayload {
    token: String!
    userId: ID!
  }

  extend type Mutation {
    requestMagicLink(email: String!): RequestMagicLinkResult!
    verifyMagicLink(token: String!): AuthPayload!
  }
`);

/** A session token. Long-lived: there is no refresh flow and no session table. */
export function signToken(userId: string): string {
  return jwt.sign({ userId }, jwtSecret(), { expiresIn: '30d' });
}

/** A single-use-in-practice sign-in token, short-lived because it travels by mail. */
export function signMagicToken(email: string): string {
  return jwt.sign({ email }, jwtSecret(), { expiresIn: '15m' });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, jwtSecret()) as { userId: string };
  } catch {
    return null;
  }
}

export function verifyMagicToken(token: string): { email: string } | null {
  try {
    const payload = jwt.verify(token, jwtSecret()) as { email?: string };
    return payload.email ? { email: payload.email } : null;
  } catch {
    return null;
  }
}

/** Read the authenticated userId from a request's Bearer token, if any. */
export function extractUserId(req: { headers: { authorization?: string } }): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return verifyToken(auth.slice(7))?.userId ?? null;
}

export function requireAuth(ctx: Context): string {
  if (!ctx.userId) {
    throw new GraphQLError('Unauthenticated', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  return ctx.userId;
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Registration is open: completing a sign-in for an address that has never been
 * seen creates the account. Self-hosting is the deployment model, so the person
 * who can reach the instance is the person who is meant to have an account.
 */
// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 column type compat
export async function findOrCreateUser(db: any, email: string): Promise<string> {
  const existing = await db
    .select({ id: dbSchema.users.id })
    .from(dbSchema.users)
    .where(eq(dbSchema.users.email, email));
  if (existing.length > 0) return existing[0].id;

  const [created] = await db.insert(dbSchema.users).values({ email }).returning({ id: dbSchema.users.id });
  if (!created) throw new GraphQLError('Failed to create user');
  return created.id;
}

export function applyAuthExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, AUTH_SDL);
  const mutationType = extendedSchema.getType('Mutation') as GraphQLObjectType;
  const fields = mutationType.getFields();

  fields.requestMagicLink.resolve = async (_parent: unknown, args: { email: string }, context: Context) => {
    const email = normalizeEmail(args.email);
    if (!signInLimiter.allow(email)) {
      throw new GraphQLError('Too many sign-in attempts. Try again in a few minutes.', {
        extensions: { code: 'TOO_MANY_REQUESTS' },
      });
    }

    // No-link mode: the address alone is the credential. Only ever appropriate
    // on a private instance — see config.ts and the README's "Before you expose
    // it".
    if (!magicLinkRequired()) {
      const userId = await findOrCreateUser(context.db, email);
      console.log(`[auth] Magic links are off; signed ${email} in directly.`);
      return { ok: true, magicLink: null, token: signToken(userId), userId };
    }

    const magicLink = `${appUrl()}/auth/verify?token=${signMagicToken(email)}`;
    // Engrafo ships no mail provider, so the console is the delivery channel.
    console.log(`\n[auth] Magic link for ${email}:\n${magicLink}\n`);
    return { ok: true, magicLink: magicLinkExposed() ? magicLink : null, token: null, userId: null };
  };

  fields.verifyMagicLink.resolve = async (_parent: unknown, args: { token: string }, context: Context) => {
    const payload = verifyMagicToken(args.token);
    if (!payload) {
      throw new GraphQLError('Invalid or expired magic link', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    const userId = await findOrCreateUser(context.db, normalizeEmail(payload.email));
    return { token: signToken(userId), userId };
  };

  return extendedSchema;
}

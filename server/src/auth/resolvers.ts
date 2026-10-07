import * as dbSchema from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { extendSchema, type GraphQLObjectType, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import { magicLinkExposed, magicLinkRequired } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { badInput, requireAuth, unauthenticated } from '../core/errors.ts';
import { requestMagicLink } from './better-auth.ts';

const AUTH_SDL = parse(`
  "How this instance signs people in, so the client can render the right form."
  type AuthConfig {
    "Whether an address alone signs in, with no link to follow."
    secureLocalNet: Boolean!
    "Whether signing in means following a link."
    magicLink: Boolean!
  }

  type AuthSession {
    "Sent back as \`Authorization: Bearer <token>\`."
    token: String!
    user: User!
  }

  """
  The outcome of a sign-in request. Where no link is required there is none to
  follow, so a live session comes back at once and \`sent\` is false. Otherwise
  \`magicLink\` is filled in only where exposing it is enabled.
  """
  type SignInResult {
    sent: Boolean!
    session: AuthSession
    magicLink: String
  }

  extend type Query {
    "The signed-in user. UNAUTHENTICATED when the session is missing or over."
    me: User!
    authConfig: AuthConfig!
  }

  extend type Mutation {
    "Sends a sign-in link, or where none is required signs straight in and returns a session."
    requestSignIn(email: String!): SignInResult!
    verifyMagicLink(token: String!): AuthSession!
    "Ends the caller's session. False when there was none."
    signOut: Boolean!
  }
`);

/** The auth mutations that are rate limited. Each has its own budget. */
export const AuthFlow = {
  RequestSignIn: 'requestSignIn',
  VerifyMagicLink: 'verifyMagicLink',
} as const;
export type AuthFlow = (typeof AuthFlow)[keyof typeof AuthFlow];

/** Where a user made without a link came from, as better-auth's `validateUserInfo` gate sees it. */
const LOCAL_NET_SOURCE = { method: 'secure-local-net' };

/**
 * Counts one attempt at an auth flow, by client address and by account.
 *
 * Two keys, because the two attacks differ: the address key stops one client
 * spraying many accounts, and the email key stops many clients burying one
 * address in sign-in links.
 *
 * @throws A TOO_MANY_REQUESTS error when the address or the account is over its budget.
 */
function throttle(ctx: Context, flow: AuthFlow, email?: string): void {
  const keys = [`${flow}:ip:${ctx.ip}`];
  if (email !== undefined) {
    keys.push(`${flow}:email:${email.trim().toLowerCase()}`);
  }
  ctx.limiter.hit(...keys);
}

function normalizeEmail(email: string): string {
  const parsed = z.email().safeParse(email.trim().toLowerCase());
  if (parsed.success === false) {
    throw badInput('Enter a valid email address');
  }
  return parsed.data;
}

async function loadUser(ctx: Context, userId: string): Promise<dbSchema.User> {
  const [user] = await ctx.db.select().from(dbSchema.users).where(eq(dbSchema.users.id, userId));
  // A live session for a row that is gone — a restored database, a deleted
  // account. Same answer as an expired one: this session is over.
  if (!user) {
    throw unauthenticated();
  }
  return user;
}

/**
 * Opens a session for an address with no link to follow, creating the account
 * on first use. Registration is open: self-hosting is the deployment model, so
 * the person who can reach the instance is the person who is meant to have an
 * account.
 */
async function signInDirectly(ctx: Context, email: string): Promise<{ token: string; userId: string }> {
  const internal = (await ctx.auth.$context).internalAdapter;
  const existing = await internal.findUserByEmail(email);
  const [localPart = email] = email.split('@');
  // Unverified, so a later sign-in by link verifies this same row.
  const user =
    existing?.user ?? (await internal.createUser({ email, name: localPart, emailVerified: false }, LOCAL_NET_SOURCE));
  const session = await internal.createSession(user.id);
  return { token: session.token, userId: user.id };
}

export function applyAuthExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, AUTH_SDL);
  const mutationType = extendedSchema.getType('Mutation') as GraphQLObjectType;
  const fields = mutationType.getFields();
  const queries = (extendedSchema.getType('Query') as GraphQLObjectType).getFields();

  queries.me.resolve = (_parent: unknown, _args: unknown, context: Context) => loadUser(context, requireAuth(context));

  queries.authConfig.resolve = () => ({
    secureLocalNet: magicLinkRequired() === false,
    magicLink: magicLinkRequired(),
  });

  fields.requestSignIn.resolve = async (_parent: unknown, args: { email: string }, context: Context) => {
    throttle(context, AuthFlow.RequestSignIn, args.email);
    const email = normalizeEmail(args.email);

    // No-link mode: the address alone is the credential. Only ever appropriate
    // on a private instance — see config.ts and the README's "Before you expose
    // it".
    if (!magicLinkRequired()) {
      const { token, userId } = await signInDirectly(context, email);
      console.log(`[auth] Magic links are off; signed ${email} in directly.`);
      return { sent: false, session: { token, user: await loadUser(context, userId) }, magicLink: null };
    }

    const link = await requestMagicLink(context.auth, email);
    return { sent: true, session: null, magicLink: magicLinkExposed() ? (link?.url ?? null) : null };
  };

  fields.verifyMagicLink.resolve = async (_parent: unknown, args: { token: string }, context: Context) => {
    throttle(context, AuthFlow.VerifyMagicLink);
    // A used, expired or made-up token is answered with a redirect to an error
    // URL, which arrives here as a thrown response. Every failure means the same
    // thing, and none of them is an expired session.
    const result = await context.auth.api
      .magicLinkVerify({ query: { token: args.token }, headers: new Headers() })
      .catch(() => null);
    if (result === null) {
      throw badInput('Invalid or expired magic link');
    }
    return { token: result.token, user: await loadUser(context, result.user.id) };
  };

  fields.signOut.resolve = async (_parent: unknown, _args: unknown, context: Context) => {
    // better-auth reports success even with no session, so look first.
    const session = await context.auth.api.getSession({ headers: context.headers });
    if (session === null) {
      return false;
    }
    await context.auth.api.signOut({ headers: context.headers });
    return true;
  };

  return extendedSchema;
}

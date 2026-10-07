import { AsyncLocalStorage } from 'node:async_hooks';
import { accounts, sessions, users, verifications } from '@cubicecho/engrafo-db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, magicLink } from 'better-auth/plugins';
import { appUrl, authSecret, SESSION_STORE_MEMORY, sessionStore } from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { SECONDS_PER_MINUTE } from '../core/wire.ts';
import { memoryStorage } from './session-store.ts';

// Sessions and magic links, through better-auth. The server mounts none of
// better-auth's REST routes: the GraphQL mutations in resolvers.ts call
// `auth.api` directly, and the bearer plugin is what lets a request carry its
// session as `Authorization: Bearer <token>`.

// biome-ignore lint/suspicious/noExplicitAny: db type varies by driver (postgres-js, PGlite)
type AnyDb = any;

/** What delivering one magic link is given. */
export interface MagicLink {
  email: string;
  /** The link to the app's verify screen, with the token in its query. */
  url: string;
  token: string;
}

/** Overrides for tests. Production uses the defaults. */
export interface AuthOptions {
  /**
   * Signing secret.
   *
   * @defaultValue `authSecret()`
   */
  secret?: string;
  /**
   * Delivers a magic link. Tests pass a fake that captures it.
   *
   * @defaultValue `logMagicLink`
   */
  sendMagicLink?: (link: MagicLink) => Promise<void>;
}

/** Where `requestMagicLink` waits for the link its own call produced. */
interface LinkCapture {
  link: MagicLink | null;
}

// `signInMagicLink` awaits `sendMagicLink` inline and returns nothing about the
// link, so the request that asked for one reads it back out of its own async
// context. A request never sees another's.
const linkCapture = new AsyncLocalStorage<LinkCapture>();

/**
 * Engrafo ships no mail provider, so the console is the delivery channel.
 *
 * @param link - The link to deliver.
 */
async function logMagicLink(link: MagicLink): Promise<void> {
  console.log(`\n[auth] Magic link for ${link.email}:\n${link.url}\n`);
}

/**
 * Builds the better-auth instance. Server code calls `auth.api.*`, and no REST routes are mounted.
 *
 * @param db - Database client.
 * @param [opts] - Test overrides.
 * @returns The auth instance.
 */
export function createAuth(db: AnyDb, { secret = authSecret(), sendMagicLink = logMagicLink }: AuthOptions = {}) {
  const usesMemorySessions = sessionStore() === SESSION_STORE_MEMORY;
  const sessionStorage = usesMemorySessions ? { secondaryStorage: memoryStorage() } : {};

  return betterAuth({
    // The rc drizzle instance is keyed by relations, so the adapter can't discover tables itself.
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    secret,
    baseURL: appUrl(),
    // Every id column is a uuid, and existing users keep theirs.
    advanced: { database: { generateId: 'uuid' } },
    ...sessionStorage,
    plugins: [
      // bearer: mutations return the raw token, and clients send it back as `Authorization: Bearer`.
      bearer(),
      magicLink({
        // better-auth takes seconds.
        expiresIn: AUTH_DEFAULTS.magicLinkTtlMinutes * SECONDS_PER_MINUTE,
        storeToken: 'hashed',
        // Links go to the app's verify screen, which calls verifyMagicLink. The REST verify route isn't mounted.
        sendMagicLink: async ({ email, token }) => {
          const link = { email, token, url: `${appUrl()}/auth/verify?token=${encodeURIComponent(token)}` };
          const capture = linkCapture.getStore();
          if (capture !== undefined) {
            capture.link = link;
          }
          await sendMagicLink(link);
        },
      }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;

/**
 * Sends a magic link and returns it. Registration is open: the first verified link for an
 * address creates its account.
 *
 * @param auth - The auth instance.
 * @param email - Normalized address.
 * @returns The link that was delivered. The caller decides whether it may be shown.
 */
export async function requestMagicLink(auth: Auth, email: string): Promise<MagicLink | null> {
  const capture: LinkCapture = { link: null };
  await linkCapture.run(capture, () => auth.api.signInMagicLink({ body: { email }, headers: new Headers() }));
  return capture.link;
}

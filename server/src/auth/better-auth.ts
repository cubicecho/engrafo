import { AsyncLocalStorage } from 'node:async_hooks';
import type { DB } from '@cubicecho/engrafo-db';
import { accounts, sessions, users, verifications } from '@cubicecho/engrafo-db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, genericOAuth, magicLink, oneTimeToken } from 'better-auth/plugins';
import {
  appUrl,
  authSecret,
  OIDC_PROVIDER_ID,
  type OidcConfig,
  oidcConfig,
  SESSION_STORE_MEMORY,
  sessionStore,
} from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { SECONDS_PER_MINUTE } from '../core/wire.ts';
import { claimFirstAdmin } from './admin.ts';
import { memoryStorage } from './session-store.ts';

// Sessions, magic links and OIDC sign-in, through better-auth. The GraphQL
// mutations in resolvers.ts call `auth.api` directly, and the bearer plugin is
// what lets a request carry its session as `Authorization: Bearer <token>`.
// The one exception is OIDC, whose two browser redirects http/sso.ts serves
// over HTTP, because a browser has to be sent somewhere.

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
  /**
   * The OIDC provider to sign in with, or null for none.
   *
   * @defaultValue `oidcConfig()`, the one the environment names
   */
  oidc?: OidcConfig | null;
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
 * Builds the better-auth instance.
 *
 * @param db - Database client.
 * @param [opts] - Test overrides.
 * @returns The auth instance.
 *
 * @remarks
 * Server code calls `auth.api.*`, and no REST routes are mounted. The return type is left
 * inferred: `Auth` is derived from it, because the plugins decide what `auth.api` has.
 */
export function createAuth(
  db: DB,
  { secret = authSecret(), sendMagicLink = logMagicLink, oidc = oidcConfig() }: AuthOptions = {},
) {
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
    // Every way an account is made (a link, SECURE_LOCAL_NET, OIDC) goes through
    // better-auth's adapter, so this is the one place the first one becomes the admin.
    databaseHooks: { user: { create: { after: async (user) => claimFirstAdmin(db, user.id) } } },
    // An address the OIDC provider vouches for (email_verified) signs in to the
    // account that has it, even one whose address Engrafo never checked itself,
    // as when it was made with SECURE_LOCAL_NET on. The provider is the
    // operator's own, so its word on an address is good.
    ...(oidc ? { account: { accountLinking: { requireLocalEmailVerified: false } } } : {}),
    // Where an OIDC callback goes when it cannot tell where the sign-in came
    // from (no state, or state that cannot be read): the login page, which says
    // so, rather than better-auth's own error page.
    onAPIError: { errorURL: `${appUrl()}/login` },
    plugins: [
      // bearer: mutations return the raw token, and clients send it back as `Authorization: Bearer`.
      bearer(),
      // How an OIDC sign-in reaches the app: the callback mints one of these for
      // the session it opened, and the app's /auth/sso page spends it over
      // GraphQL, as /auth/verify spends a magic-link token. Only the server mints
      // them, and the session itself never rides in a URL or a cookie.
      oneTimeToken({
        expiresIn: AUTH_DEFAULTS.oneTimeTokenTtlMinutes,
        storeToken: 'hashed',
        disableClientRequest: true,
        disableSetSessionCookie: true,
      }),
      ...(oidc ? [oidcPlugin(oidc)] : []),
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

/** The better-auth instance as `createAuth` configures it, plugins included. */
export type Auth = ReturnType<typeof createAuth>;

/**
 * The OIDC provider, through better-auth's generic OAuth plugin.
 *
 * @param oidc - The provider.
 * @returns The plugin.
 *
 * @remarks
 * Endpoints, keys and issuer come from the discovery document, the id token is checked against
 * them, and better-auth's own sign-in and callback endpoints run the flow (state, PKCE, nonce).
 */
function oidcPlugin(oidc: OidcConfig) {
  return genericOAuth({
    config: [
      {
        providerId: OIDC_PROVIDER_ID,
        name: oidc.name,
        discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
        requireIdTokenVerification: true,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        tokenEndpointAuth: { method: oidc.clientSecret ? oidc.clientAuth : 'none' },
        pkce: true,
        scopes: ['openid', 'profile', 'email'],
        // A provider may release only a username, or no name at all. Fall back
        // the way a sign-in by link names an account: the address's local part.
        mapProfileToUser: (profile) => ({
          name:
            stringClaim(profile.name) ??
            stringClaim(profile.preferred_username) ??
            stringClaim(profile.email)?.split('@')[0] ??
            '',
        }),
      },
    ],
  });
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Sends a magic link and returns it.
 *
 * @param auth - The auth instance.
 * @param email - Normalized address.
 * @returns The link that was delivered, or null when none was. The caller decides whether it may be shown.
 *
 * @remarks
 * Registration is open: the first verified link for an address creates its account.
 */
export async function requestMagicLink(auth: Auth, email: string): Promise<MagicLink | null> {
  const capture: LinkCapture = { link: null };
  await linkCapture.run(capture, () => auth.api.signInMagicLink({ body: { email }, headers: new Headers() }));
  return capture.link;
}

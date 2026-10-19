import type { Express, Request, Response } from 'express';
import type { AuthHost } from '../auth/auth-host.ts';
import type { Auth } from '../auth/better-auth.ts';
import { OIDC_PROVIDER_ID } from '../core/config.ts';
import { HttpStatus } from '../core/wire.ts';
import { publicOrigin } from './origin.ts';

// The two legs of an OIDC sign-in that cannot be GraphQL, because the browser
// has to be sent somewhere: out to the provider, and back from it. Both are
// better-auth's own endpoints (`signInSocial` and `/callback/:id`); this file
// only carries them over HTTP and changes how the session reaches the app.
//
// better-auth would end the callback by setting a session cookie. Engrafo keeps
// its session as a bearer token in the app instead, so the cookie is dropped
// and the browser lands on /auth/sso with a one-time token, which the app swaps
// for the session over GraphQL (`verifyOneTimeToken`).
//
// Every URL here is built from `publicOrigin(req)`, and better-auth is handed a
// request at that origin, so with no APP_URL the redirect URI is the address
// the browser came in on and not the server's own localhost.

/** Where the login page's button sends the browser. */
export const SSO_START_PATH = `/sso/${OIDC_PROVIDER_ID}`;
/** Where the provider sends the browser back: better-auth's callback, at its default base path. */
export const SSO_CALLBACK_PATH = `/api/auth/callback/${OIDC_PROVIDER_ID}`;

/** The app's page that spends the one-time token. */
const SIGNED_IN_PATH = '/auth/sso';
/** The login page, which reads `?error=` and says signing in failed. */
const FAILED_PATH = '/login';

/** What the login page is told when something here went wrong before better-auth could say what. */
const SsoError = {
  SignInFailed: 'sign_in_failed',
  CallbackFailed: 'callback_failed',
  /** No provider: none was ever set, or it was disconnected after the login page loaded. */
  Off: 'sso_off',
} as const;
type SsoError = (typeof SsoError)[keyof typeof SsoError];

/**
 * Mounts the start and callback routes.
 *
 * @param app - The Express app. Mount before the static handler, whose fallback would answer both.
 * @param host - Where the current auth instance is. With no provider, both routes send the browser
 *   back to the login page.
 */
export function mountSso(app: Express, host: AuthHost): void {
  app.get(SSO_START_PATH, (req, res) => {
    if (host.oidc() === null) {
      off(req, res);
      return;
    }
    start(host.current(), req, res).catch((error: unknown) => fail(req, res, SsoError.SignInFailed, error));
  });
  app.get(SSO_CALLBACK_PATH, (req, res) => {
    if (host.oidc() === null) {
      off(req, res);
      return;
    }
    callback(host.current(), req, res).catch((error: unknown) => fail(req, res, SsoError.CallbackFailed, error));
  });
}

/**
 * Express's headers as fetch `Headers`, which better-auth reads cookies from and, with no
 * APP_URL, its base URL.
 *
 * @remarks
 * The forwarded host and scheme are rewritten to the origin Express resolved: whether a hop may
 * name them is `trust proxy`'s decision, made once, and the client's own copies are dropped.
 */
function toHeaders(req: Request): Headers {
  const origin = new URL(publicOrigin(req));
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name.startsWith('x-forwarded-')) {
      continue;
    }
    for (const one of Array.isArray(value) ? value : [value]) {
      headers.append(name, one);
    }
  }
  headers.set('x-forwarded-host', origin.host);
  headers.set('x-forwarded-proto', origin.protocol.slice(0, -1));
  return headers;
}

/**
 * Starts a sign-in. better-auth makes the state (with a signed cookie that ties it to this
 * browser), the PKCE verifier and the nonce, and says where the provider's authorize page is.
 */
async function start(auth: Auth, req: Request, res: Response): Promise<void> {
  const origin = publicOrigin(req);
  const { headers, response } = await auth.api.signInSocial({
    body: {
      provider: OIDC_PROVIDER_ID,
      callbackURL: `${origin}${SIGNED_IN_PATH}`,
      errorCallbackURL: `${origin}${FAILED_PATH}`,
      disableRedirect: true,
    },
    headers: toHeaders(req),
    returnHeaders: true,
  });
  const url = response && 'url' in response ? response.url : undefined;
  if (!url) {
    throw new Error('better-auth returned no authorize URL');
  }
  for (const cookie of headers?.getSetCookie() ?? []) {
    res.append('set-cookie', cookie);
  }
  res.redirect(HttpStatus.Found, url);
}

/**
 * The provider's redirect back. better-auth checks the state, swaps the code, verifies the id
 * token and opens a session; this then swaps the session cookie it would have set for a one-time
 * token on the app's URL.
 */
async function callback(auth: Auth, req: Request, res: Response): Promise<void> {
  const origin = publicOrigin(req);
  const request = new globalThis.Request(new URL(req.originalUrl, origin), { method: 'GET', headers: toHeaders(req) });
  const response = await auth.handler(request);
  const ctx = await auth.$context;
  const sessionCookies = new Set([ctx.authCookies.sessionToken.name, ctx.authCookies.sessionData.name]);

  // The state cookie's expiry, and anything else that is not the session.
  for (const cookie of response.headers.getSetCookie()) {
    const isSessionCookie = sessionCookies.has(cookie.slice(0, cookie.indexOf('=')));
    if (isSessionCookie === false) {
      res.append('set-cookie', cookie);
    }
  }

  const location = response.headers.get('location');
  if (!location) {
    fail(
      req,
      res,
      SsoError.CallbackFailed,
      new Error(`better-auth's callback answered ${response.status} with no redirect`),
    );
    return;
  }

  // Every page better-auth sends the browser to from here is one of the app's, so
  // only its path is kept. The origin is the one this request came in on: with
  // no state to read, better-auth falls back to its own, which is APP_URL's default.
  const landing = new URL(location, origin);
  const target = new URL(`${landing.pathname}${landing.search}`, origin);

  // The bearer plugin sets this whenever a session cookie is: the new session.
  const session = response.headers.get('set-auth-token');
  if (!session) {
    // A refusal: better-auth is sending the browser to the login page with its error code.
    res.redirect(HttpStatus.Found, target.toString());
    return;
  }
  const { token } = await auth.api.generateOneTimeToken({
    headers: new Headers({ authorization: `Bearer ${session}` }),
  });
  target.searchParams.set('token', token);
  res.redirect(HttpStatus.Found, target.toString());
}

/** Back to the login page, which says there is no provider to sign in with. Not an error worth logging. */
function off(req: Request, res: Response): void {
  res.redirect(HttpStatus.Found, `${publicOrigin(req)}${FAILED_PATH}?error=${SsoError.Off}`);
}

/** Back to the login page, which says that signing in failed. */
function fail(req: Request, res: Response, code: SsoError, error: unknown): void {
  console.error(`[auth] OIDC ${code}:`, error);
  if (res.headersSent) {
    return;
  }
  res.redirect(HttpStatus.Found, `${publicOrigin(req)}${FAILED_PATH}?error=${encodeURIComponent(code)}`);
}

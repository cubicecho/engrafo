import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedAuthHost } from '../../auth/auth-host.ts';
import type { Auth } from '../../auth/better-auth.ts';
import { createRateLimiter } from '../../auth/rate-limit.ts';
import type { OidcConfig } from '../../core/config.ts';
import { ErrorCode } from '../../core/errors.ts';
import { HttpStatus } from '../../core/wire.ts';
import { createApp } from '../../http/app.ts';
import { SSO_CALLBACK_PATH, SSO_START_PATH } from '../../http/sso.ts';
import { createPipelineEvents } from '../../pipeline/events.ts';
import {
  createClient,
  createFakeStorage,
  createTestAuth,
  createTestDb,
  createUser,
  sessionUserId,
  type TestDb,
} from '../helpers.ts';

// The whole OIDC sign-in through the real app, against a stand-in provider that
// does what heautou (oidc-provider) does: discovery, a JWKS, a code flow with a
// client secret in a Basic header, PKCE, and a signed id token carrying the nonce.

const VERIFY = 'mutation ($token: String!) { verifyOneTimeToken(token: $token) { token user { id name } } }';
const CONFIG = '{ authConfig { sso { name signInPath } } }';
const CLIENT_ID = 'engrafo';
const CLIENT_SECRET = 'engrafo-secret';

interface Profile {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

interface FakeProvider {
  issuer: string;
  /** Who the next sign-in is. */
  profile: Profile;
  /** Plays the browser at the authorize endpoint: the code and state it would be sent back with. */
  authorize(url: string): { code: string; state: string };
  close(): Promise<void>;
}

async function listen(app: express.Express): Promise<{ server: Server; origin: string }> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function startProvider(): Promise<FakeProvider> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string; profile: Profile }>();
  const app = express();
  const { server, origin } = await listen(app);
  const issuer = `${origin}/oidc`;
  const provider: FakeProvider = {
    issuer,
    profile: { sub: 'u1', email: 'ada@example.com', name: 'Ada' },
    authorize(url) {
      const params = new URL(url).searchParams;
      expect(params.get('client_id')).toBe(CLIENT_ID);
      expect(params.get('scope')?.split(' ')).toEqual(expect.arrayContaining(['openid', 'email', 'profile']));
      expect(params.get('code_challenge_method')).toBe('S256');
      const code = randomUUID();
      codes.set(code, {
        nonce: params.get('nonce') ?? '',
        challenge: params.get('code_challenge') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
        profile: provider.profile,
      });
      return { code, state: params.get('state') ?? '' };
    },
    close: () => close(server),
  };

  app.get('/oidc/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/me`,
      jwks_uri: `${issuer}/jwks`,
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
    });
  });
  app.get('/oidc/jwks', (_req, res) => {
    res.json({ keys: [jwk] });
  });
  app.post('/oidc/token', express.urlencoded({ extended: false }), async (req, res) => {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    if (req.headers.authorization !== `Basic ${basic}`) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    const grant = codes.get(req.body.code);
    codes.delete(req.body.code);
    const challenge = createHash('sha256').update(String(req.body.code_verifier)).digest('base64url');
    if (!grant || grant.challenge !== challenge || grant.redirectUri !== req.body.redirect_uri) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    const { profile } = grant;
    const idToken = await new SignJWT({
      ...profile,
      email_verified: profile.email ? true : undefined,
      nonce: grant.nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setSubject(profile.sub)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    res.json({ access_token: `at-${profile.sub}`, token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });
  app.get('/oidc/me', (req, res) => {
    const sub = String(req.headers.authorization).replace('Bearer at-', '');
    const profile = sub === provider.profile.sub ? provider.profile : null;
    res.json(profile ? { ...profile, email_verified: Boolean(profile.email) } : {});
  });
  return provider;
}

let db: TestDb;
let provider: FakeProvider;
let auth: Auth;
let engrafo: Server;
let appUrl: string;

beforeEach(async () => {
  db = await createTestDb();
  provider = await startProvider();
  // Logged refusals are expected here; keep them out of the run's output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await startEngrafo({ setAppUrl: true });
});

/**
 * Starts the app, signing in with the stand-in provider.
 *
 * @param setAppUrl - Whether APP_URL names the app. Unset, every URL has to come from the request.
 */
async function startEngrafo({ setAppUrl }: { setAppUrl: boolean }): Promise<void> {
  // createApp builds the routes before it is listening, and APP_URL has to name
  // the port it ends up on, so the app is mounted into an outer one.
  const outer = express();
  ({ server: engrafo, origin: appUrl } = await listen(outer));
  // better-auth builds its callback URL from this, and http/sso.ts the app's.
  vi.stubEnv('APP_URL', setAppUrl ? appUrl : '');

  const oidc: OidcConfig = {
    issuer: provider.issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    clientAuth: 'client_secret_basic',
    name: 'heautou',
  };
  auth = createTestAuth(db, oidc).auth;
  const authHost = fixedAuthHost(auth, oidc);
  // With a built client, so a route missing here would be answered by its SPA fallback, not a 404.
  const staticDir = await mkdtemp(join(tmpdir(), 'engrafo-sso-'));
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Engrafo</title>');
  outer.use(
    createApp({
      db,
      authHost,
      limiter: createRateLimiter(),
      storage: createFakeStorage(),
      events: createPipelineEvents(),
      ocrAvailable: false,
      staticDir,
    }),
  );
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await close(engrafo);
  await provider.close();
});

/** The cookies a response set, as a request's Cookie header. */
function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/** Walks the browser through a sign-in: the start route, the provider, the callback. */
async function signIn(tamper?: (callback: URL) => void): Promise<{ location: URL; callback: Response }> {
  const start = await fetch(`${appUrl}${SSO_START_PATH}`, { redirect: 'manual' });
  expect(start.status).toBe(HttpStatus.Found);
  const authorizeUrl = start.headers.get('location') ?? '';
  expect(authorizeUrl.startsWith(`${provider.issuer}/auth?`)).toBe(true);
  expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(`${appUrl}${SSO_CALLBACK_PATH}`);

  const { code, state } = provider.authorize(authorizeUrl);
  const back = new URL(`${appUrl}${SSO_CALLBACK_PATH}`);
  back.searchParams.set('code', code);
  back.searchParams.set('state', state);
  back.searchParams.set('iss', provider.issuer);
  tamper?.(back);
  const callback = await fetch(back, { redirect: 'manual', headers: { cookie: cookiesFrom(start) } });
  expect(callback.status).toBe(HttpStatus.Found);
  return { location: new URL(callback.headers.get('location') ?? ''), callback };
}

function verify(token: string) {
  return createClient(db, null, { auth }).run(VERIFY, { token });
}

type Verified = { verifyOneTimeToken: { token: string; user: { id: string; name: string | null } } };

describe('OIDC sign-in', () => {
  it('lands on /auth/sso with a one-time token the app swaps for a session', async () => {
    const { location, callback } = await signIn();
    expect(location.origin + location.pathname).toBe(`${appUrl}/auth/sso`);
    // The session goes to the app as a bearer token, never as a cookie.
    expect(callback.headers.getSetCookie().some((cookie) => cookie.includes('session_token'))).toBe(false);

    const token = location.searchParams.get('token') ?? '';
    const result = await verify(token);
    expect(result.errors).toBeUndefined();
    const session = (result.data as Verified).verifyOneTimeToken;
    expect(await sessionUserId(auth, session.token)).toBe(session.user.id);
    expect(session.user.name).toBe('Ada');

    // Spent, and a spent token is bad input, not a signed-out session.
    const again = await createClient(db, null, { auth }).expectError(VERIFY, { token });
    expect(again.code).toBe(ErrorCode.BadUserInput);
  });

  it('builds the redirect URI from the address the browser used when APP_URL is unset', async () => {
    await close(engrafo);
    await startEngrafo({ setAppUrl: false });
    // signIn checks the authorize URL's redirect_uri is under appUrl — here the
    // listener's own 127.0.0.1 port, not the localhost:3004 default — and the
    // provider refuses the code unless the token exchange sends the same one.
    const { location } = await signIn();
    expect(location.origin + location.pathname).toBe(`${appUrl}/auth/sso`);
    const result = await verify(location.searchParams.get('token') ?? '');
    expect(result.errors).toBeUndefined();
  });

  // A browser drops a Secure cookie over http, so the state cookie would never
  // come back. better-auth would make it Secure in production on its own.
  it('sets the state cookie without Secure when APP_URL is unset, so it survives plain http', async () => {
    await close(engrafo);
    await startEngrafo({ setAppUrl: false });
    const start = await fetch(`${appUrl}${SSO_START_PATH}`, { redirect: 'manual' });
    const cookies = start.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.some((cookie) => /;\s*secure/i.test(cookie) || cookie.startsWith('__Secure-'))).toBe(false);
  });

  it('sets the state cookie Secure when APP_URL is https', async () => {
    vi.stubEnv('APP_URL', 'https://engrafo.example.com');
    const httpsAuth = createTestAuth(db, {
      issuer: provider.issuer,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      clientAuth: 'client_secret_basic',
      name: 'heautou',
    }).auth;
    const ctx = await httpsAuth.$context;
    expect(ctx.authCookies.sessionToken.attributes.secure).toBe(true);
  });

  it('signs an existing account in by the address the provider vouches for', async () => {
    const existing = await createUser(db, 'ada@example.com');
    const { location } = await signIn();
    const result = await verify(location.searchParams.get('token') ?? '');
    expect((result.data as Verified).verifyOneTimeToken.user.id).toBe(existing);
  });

  it('names a new account from the username when there is no name', async () => {
    provider.profile = { sub: 'u2', email: 'bob@example.com', preferred_username: 'bob' };
    const { location } = await signIn();
    const result = await verify(location.searchParams.get('token') ?? '');
    expect((result.data as Verified).verifyOneTimeToken.user.name).toBe('bob');
  });

  it('sends a user with no address back to the login page', async () => {
    provider.profile = { sub: 'u3', name: 'No Mail' };
    const { location } = await signIn();
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBeTruthy();
    expect(location.searchParams.get('token')).toBeNull();
  });

  it('refuses a callback whose state does not match', async () => {
    const { location } = await signIn((back) => back.searchParams.set('state', 'forged'));
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBeTruthy();
    expect(location.searchParams.get('token')).toBeNull();
  });
});

describe('authConfig.sso', () => {
  it('is null without a provider', async () => {
    vi.stubEnv('OIDC_ISSUER', '');
    vi.stubEnv('OIDC_CLIENT_ID', '');
    const data = await createClient(db, null).expectOk(CONFIG);
    expect(data.authConfig.sso).toBeNull();
  });

  it('names the provider and where to start', async () => {
    vi.stubEnv('OIDC_ISSUER', provider.issuer);
    vi.stubEnv('OIDC_CLIENT_ID', CLIENT_ID);
    vi.stubEnv('OIDC_NAME', 'heautou');
    const data = await createClient(db, null).expectOk(CONFIG);
    expect(data.authConfig.sso).toEqual({ name: 'heautou', signInPath: SSO_START_PATH });
  });
});

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as dbSchema from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAdmin } from '../../auth/admin.ts';
import { type AuthHost, createAuthHost } from '../../auth/auth-host.ts';
import { ErrorCode } from '../../core/errors.ts';
import { HttpStatus } from '../../core/wire.ts';
import { mountSso, SSO_START_PATH } from '../../http/sso.ts';
import { PairingFailure, parseSetupUrl } from '../../sso/pairing.ts';
import { readPairedOidc, SsoSource } from '../../sso/settings.ts';
import { createClient, createTestDb, createUser, TEST_SECRET, type TestDb } from '../helpers.ts';

// Pairing with a provider by pasting a setup URL, against a stand-in for
// heautou's Dynamic Client Registration: discovery naming a registration
// endpoint, registration on an initial access token (RFC 7591), and deleting
// the client on its registration access token (RFC 7592).

const SETUP = 'query { ssoSetup { source issuer name canPair redirectUri } }';
const PAIR = 'mutation ($url: String!) { pairSso(setupUrl: $url) { source name canPair } }';
const UNPAIR = 'mutation { unpairSso { source name } }';
const CONFIG = '{ authConfig { sso { name signInPath } } }';

const TOKEN = 'iat-good';
const CLIENT_ID = 'engrafo-client';
const CLIENT_SECRET = 'engrafo-secret';
const RAT = 'rat-1';

interface FakeDcr {
  issuer: string;
  /** What discovery says the issuer is. Set to something else to forge it. */
  claimedIssuer: string;
  /** Whether discovery names a registration endpoint. */
  canRegister: boolean;
  /** What the next registration answers, when the token is good. */
  answer: 'created' | 'badRedirect' | 'rateLimited';
  /** Bodies and auth headers registration was called with. */
  registrations: { body: Record<string, unknown>; authorization: string | undefined }[];
  /** Auth headers the client was deleted with. */
  deletions: (string | undefined)[];
  /** What deleting answers. */
  deleteStatus: number;
  close(): Promise<void>;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

async function startDcr(): Promise<FakeDcr> {
  const app = express();
  const server = createServer(app);
  const issuer = `${await listen(server)}/oidc`;
  const fake: FakeDcr = {
    issuer,
    claimedIssuer: issuer,
    canRegister: true,
    answer: 'created',
    registrations: [],
    deletions: [],
    deleteStatus: 204,
    close: () => close(server),
  };
  app.get('/oidc/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer: fake.claimedIssuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      ...(fake.canRegister ? { registration_endpoint: `${issuer}/reg` } : {}),
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
    });
  });
  app.post('/oidc/reg', express.json(), (req, res) => {
    fake.registrations.push({ body: req.body, authorization: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.status(401).json({ error: 'invalid_token', error_description: 'invalid token provided' });
      return;
    }
    if (fake.answer === 'rateLimited') {
      res.status(429).json({ error: 'too_many_requests' });
      return;
    }
    if (fake.answer === 'badRedirect') {
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must use https' });
      return;
    }
    res.status(201).json({
      ...req.body,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      registration_access_token: RAT,
      registration_client_uri: `${issuer}/reg/${CLIENT_ID}`,
    });
  });
  app.delete(`/oidc/reg/${CLIENT_ID}`, (req, res) => {
    fake.deletions.push(req.headers.authorization);
    res.status(fake.deleteStatus).end();
  });
  return fake;
}

let db: TestDb;
let dcr: FakeDcr;
let host: AuthHost;
let engrafo: Server;
let appUrl: string;

beforeEach(async () => {
  vi.stubEnv('OIDC_ISSUER', '');
  vi.stubEnv('OIDC_CLIENT_ID', '');
  db = await createTestDb();
  dcr = await startDcr();
  const app = express();
  engrafo = createServer(app);
  appUrl = await listen(engrafo);
  // The redirect URI registered with the provider is built from it.
  vi.stubEnv('APP_URL', appUrl);
  host = await createAuthHost(db, { secret: TEST_SECRET });
  mountSso(app, host);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await close(engrafo);
  await dcr.close();
});

/** A client on the real host, so pairing rebuilds what sign-in uses. */
function client(userId: string | null = null) {
  return createClient(db, userId, { authHost: host });
}

function setupUrl(token = TOKEN, name = 'heautou'): string {
  return `${dcr.issuer}#setup=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`;
}

async function pairError(url: string, userId: string | null = null) {
  const result = await client(userId).run(PAIR, { url });
  expect(result.errors).toHaveLength(1);
  const [error] = result.errors ?? [];
  return { message: error?.message, ...error?.extensions };
}

async function makeAdmin(email: string): Promise<string> {
  const id = await createUser(db, email);
  await db.update(dbSchema.users).set({ isAdmin: true }).where(eq(dbSchema.users.id, id));
  return id;
}

describe('setup URLs', () => {
  it('takes the issuer, token and name apart', () => {
    expect(parseSetupUrl('https://id.example.com/oidc#setup=abc&name=heautou')).toEqual({
      issuer: 'https://id.example.com/oidc',
      token: 'abc',
      name: 'heautou',
    });
  });

  it('calls a provider with no name SSO', () => {
    expect(parseSetupUrl('https://id.example.com/oidc/#setup=abc').name).toBe('SSO');
  });

  it('refuses anything that is not a setup URL', () => {
    expect(() => parseSetupUrl('not a url')).toThrow(/not a URL/);
    expect(() => parseSetupUrl('https://id.example.com/oidc')).toThrow(/no setup token/);
    expect(() => parseSetupUrl('ftp://id.example.com/oidc#setup=abc')).toThrow(/https/);
  });
});

describe('pairSso', () => {
  it('registers Engrafo and puts the button on the login page without a restart', async () => {
    expect((await client().expectOk(CONFIG)).authConfig.sso).toBeNull();
    expect((await client().expectOk(SETUP)).ssoSetup).toMatchObject({ source: SsoSource.None, canPair: true });

    const data = await client().expectOk(PAIR, { url: setupUrl() });
    expect(data.pairSso).toEqual({ source: SsoSource.Paired, name: 'heautou', canPair: true });

    expect(dcr.registrations).toHaveLength(1);
    const [registration] = dcr.registrations;
    expect(registration?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(registration?.body).toEqual({
      client_name: 'Engrafo',
      redirect_uris: [`${appUrl}/api/auth/callback/oidc`],
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });

    expect(await readPairedOidc(db)).toMatchObject({
      issuer: dcr.issuer,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      name: 'heautou',
      registrationAccessToken: RAT,
      registrationClientUri: `${dcr.issuer}/reg/${CLIENT_ID}`,
    });
    expect((await client().expectOk(CONFIG)).authConfig.sso).toEqual({ name: 'heautou', signInPath: SSO_START_PATH });

    // The running server's sign-in now goes to the provider, as the new client.
    const start = await fetch(`${appUrl}${SSO_START_PATH}`, { redirect: 'manual' });
    expect(start.status).toBe(HttpStatus.Found);
    const authorize = new URL(start.headers.get('location') ?? '');
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${dcr.issuer}/auth`);
    expect(authorize.searchParams.get('client_id')).toBe(CLIENT_ID);
  });

  it('says a used or expired setup URL is spent, and keeps nothing', async () => {
    const error = await pairError(setupUrl('iat-used'));
    expect(error).toMatchObject({ code: ErrorCode.BadUserInput, reason: PairingFailure.Expired });
    expect(error.message).toMatch(/new one/);
    expect(await readPairedOidc(db)).toBeNull();
    expect(host.oidc()).toBeNull();
  });

  it('passes on why the provider refused the registration', async () => {
    dcr.answer = 'badRedirect';
    const error = await pairError(setupUrl());
    expect(error).toMatchObject({ code: ErrorCode.BadUserInput, reason: PairingFailure.Refused });
    expect(error.message).toMatch(/redirect_uris must use https/);
    expect(await readPairedOidc(db)).toBeNull();
  });

  it('says when the provider is rate limiting', async () => {
    dcr.answer = 'rateLimited';
    expect(await pairError(setupUrl())).toMatchObject({
      code: ErrorCode.TooManyRequests,
      reason: PairingFailure.RateLimited,
    });
  });

  it('refuses a discovery document that names another issuer, before sending the token', async () => {
    dcr.claimedIssuer = 'https://evil.example.com/oidc';
    expect(await pairError(setupUrl())).toMatchObject({
      code: ErrorCode.BadUserInput,
      reason: PairingFailure.NotAProvider,
    });
    expect(dcr.registrations).toHaveLength(0);
  });

  it('says when nothing answers at the URL', async () => {
    expect(await pairError('http://127.0.0.1:1/oidc#setup=abc')).toMatchObject({
      reason: PairingFailure.NotAProvider,
    });
  });

  it('says when the provider cannot pair', async () => {
    dcr.canRegister = false;
    expect(await pairError(setupUrl())).toMatchObject({ reason: PairingFailure.NoRegistration });
  });

  it('will not pair over an existing pairing', async () => {
    await client().expectOk(PAIR, { url: setupUrl() });
    expect(await pairError(setupUrl())).toMatchObject({ code: ErrorCode.Conflict });
  });
});

describe('who may pair', () => {
  it('is anyone while there are no accounts', async () => {
    expect((await client().expectOk(SETUP)).ssoSetup.canPair).toBe(true);
  });

  it('is only the admin once anyone has an account', async () => {
    const admin = await makeAdmin('admin@example.com');
    const member = await createUser(db, 'member@example.com');

    expect((await client().expectOk(SETUP)).ssoSetup).toMatchObject({ canPair: false, issuer: null });
    expect((await client(member).expectOk(SETUP)).ssoSetup.canPair).toBe(false);
    expect((await client(admin).expectOk(SETUP)).ssoSetup.canPair).toBe(true);

    expect(await pairError(setupUrl())).toMatchObject({ code: ErrorCode.Forbidden });
    expect(await pairError(setupUrl(), member)).toMatchObject({ code: ErrorCode.Forbidden });
    expect(dcr.registrations).toHaveLength(0);

    await client(admin).expectOk(PAIR, { url: setupUrl() });
    expect((await client(admin).expectOk(SETUP)).ssoSetup).toMatchObject({
      source: SsoSource.Paired,
      issuer: dcr.issuer,
    });
  });

  it('is nobody when the environment names the provider, which wins', async () => {
    vi.stubEnv('OIDC_ISSUER', 'https://env.example.com/oidc');
    vi.stubEnv('OIDC_CLIENT_ID', 'env-client');
    vi.stubEnv('OIDC_NAME', 'Corp SSO');
    const admin = await makeAdmin('admin@example.com');

    expect((await client(admin).expectOk(SETUP)).ssoSetup).toMatchObject({
      source: SsoSource.Env,
      name: 'Corp SSO',
      canPair: false,
    });
    expect((await client(admin).expectOk(CONFIG)).authConfig.sso.name).toBe('Corp SSO');
    expect(await pairError(setupUrl(), admin)).toMatchObject({ code: ErrorCode.Forbidden });
  });

  const TEST_SOURCE = { method: 'test' };

  it('makes the first account better-auth creates the admin, and no other', async () => {
    const internal = (await host.current().$context).internalAdapter;
    const first = await internal.createUser(
      { email: 'first@example.com', name: 'first', emailVerified: true },
      TEST_SOURCE,
    );
    const second = await internal.createUser(
      { email: 'second@example.com', name: 'second', emailVerified: true },
      TEST_SOURCE,
    );
    expect(await isAdmin(db, first.id)).toBe(true);
    expect(await isAdmin(db, second.id)).toBe(false);
  });
});

describe('unpairSso', () => {
  it('deletes the client at the provider and takes the button away', async () => {
    const admin = await makeAdmin('admin@example.com');
    await client(admin).expectOk(PAIR, { url: setupUrl() });
    expect(host.oidc()).not.toBeNull();

    const data = await client(admin).expectOk(UNPAIR);
    expect(data.unpairSso).toEqual({ source: SsoSource.None, name: null });
    expect(dcr.deletions).toEqual([`Bearer ${RAT}`]);
    expect(await readPairedOidc(db)).toBeNull();
    expect(host.oidc()).toBeNull();
    expect((await client(admin).expectOk(CONFIG)).authConfig.sso).toBeNull();

    // With nothing paired, the sign-in route sends the browser back to the login page.
    const start = await fetch(`${appUrl}${SSO_START_PATH}`, { redirect: 'manual' });
    expect(new URL(start.headers.get('location') ?? '').searchParams.get('error')).toBe('sso_off');
  });

  it('counts a client the provider already removed as gone', async () => {
    const admin = await makeAdmin('admin@example.com');
    await client(admin).expectOk(PAIR, { url: setupUrl() });
    dcr.deleteStatus = 401;
    await client(admin).expectOk(UNPAIR);
    expect(await readPairedOidc(db)).toBeNull();
  });

  it('forgets the pairing even when the provider will not delete the client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const admin = await makeAdmin('admin@example.com');
    await client(admin).expectOk(PAIR, { url: setupUrl() });
    dcr.deleteStatus = 500;
    await client(admin).expectOk(UNPAIR);
    expect(await readPairedOidc(db)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[auth]'));
  });

  it('is the admin’s once anyone has an account', async () => {
    await client().expectOk(PAIR, { url: setupUrl() });
    const member = await createUser(db, 'member@example.com');
    const result = await client(member).run(UNPAIR);
    expect(result.errors?.[0]?.extensions?.code).toBe(ErrorCode.Forbidden);
    expect(await readPairedOidc(db)).not.toBeNull();
  });
});

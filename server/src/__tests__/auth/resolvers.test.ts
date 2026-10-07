import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../auth/rate-limit.ts';
import { ErrorCode } from '../../core/errors.ts';
import {
  createClient,
  createTestAuth,
  createTestDb,
  sessionUserId,
  type TestAuth,
  type TestClient,
  type TestDb,
} from '../helpers.ts';

const REQUEST = `
  mutation($email: String!) {
    requestSignIn(email: $email) { sent magicLink session { token user { id email } } }
  }
`;

const VERIFY = `mutation($token: String!) { verifyMagicLink(token: $token) { token user { id email } } }`;

const SIGN_OUT = `mutation { signOut }`;

const ME = `{ me { id email } }`;

const AUTH_CONFIG = `{ authConfig { secureLocalNet magicLink } }`;

let db: TestDb;
let testAuth: TestAuth;
let anonymous: TestClient;

beforeEach(async () => {
  db = await createTestDb();
  testAuth = createTestAuth(db);
  anonymous = createClient(db, null, { auth: testAuth.auth });
});

// The sign-in mode is read from the environment at call time, so a test that
// sets a variable has to put it back — vitest runs a file's suites in one process.
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

/** Requests a link and returns the token it was delivered with. */
async function magicToken(email: string): Promise<string> {
  await anonymous.expectOk(REQUEST, { email });
  const link = testAuth.links.at(-1);
  if (link === undefined) {
    throw new Error(`No magic link was delivered for ${email}.`);
  }
  return link.token;
}

describe('requestSignIn', () => {
  it('delivers a link and returns no session by default', async () => {
    const { requestSignIn } = await anonymous.expectOk(REQUEST, { email: 'linked@example.com' });

    expect(requestSignIn.sent).toBe(true);
    // A session that arrived without following the link would defeat the link.
    expect(requestSignIn.session).toBeNull();
    expect(testAuth.links.at(-1)?.email).toBe('linked@example.com');
  });

  it('points the link at the verify screen', async () => {
    const { requestSignIn } = await anonymous.expectOk(REQUEST, { email: 'linked@example.com' });

    const link = testAuth.links.at(-1);
    expect(link?.url).toContain(`/auth/verify?token=${link?.token}`);
    // Outside production the link comes back, so the login page can offer it.
    expect(requestSignIn.magicLink).toBe(link?.url);
  });

  it('withholds the link from the response in production', async () => {
    process.env.NODE_ENV = 'production';

    const { requestSignIn } = await anonymous.expectOk(REQUEST, { email: 'linked@example.com' });

    expect(requestSignIn.sent).toBe(true);
    expect(requestSignIn.magicLink).toBeNull();
  });

  it('signs in on the spot with SECURE_LOCAL_NET, creating the user', async () => {
    process.env.SECURE_LOCAL_NET = 'true';

    const { requestSignIn } = await anonymous.expectOk(REQUEST, { email: 'trusted@example.com' });

    expect(requestSignIn.sent).toBe(false);
    expect(requestSignIn.session.user.email).toBe('trusted@example.com');
    expect(await sessionUserId(testAuth.auth, requestSignIn.session.token)).toBe(requestSignIn.session.user.id);
    // No link to follow, so handing one back would only be something to leak.
    expect(requestSignIn.magicLink).toBeNull();
    expect(testAuth.links).toEqual([]);
  });

  it('accepts AUTH_MAGIC_LINK=false as the same instruction', async () => {
    process.env.AUTH_MAGIC_LINK = 'false';

    const { requestSignIn } = await anonymous.expectOk(REQUEST, { email: 'trusted@example.com' });

    expect(requestSignIn.session.token).toEqual(expect.any(String));
  });

  it('returns the same user for an address that has signed in before', async () => {
    process.env.SECURE_LOCAL_NET = 'true';

    const first = await anonymous.expectOk(REQUEST, { email: 'repeat@example.com' });
    const second = await anonymous.expectOk(REQUEST, { email: ' REPEAT@example.com ' });

    // Addresses are normalized, or the same person gets an archive per spelling.
    expect(second.requestSignIn.session.user.id).toBe(first.requestSignIn.session.user.id);
  });

  it('refuses something that is not an address as bad input', async () => {
    const error = await anonymous.expectError(REQUEST, { email: 'not-an-address' });

    expect(error.code).toBe(ErrorCode.BadUserInput);
  });
});

describe('verifyMagicLink', () => {
  it('opens a session for the address the link was sent to, creating the user', async () => {
    const token = await magicToken('new@example.com');

    const { verifyMagicLink } = await anonymous.expectOk(VERIFY, { token });

    expect(verifyMagicLink.user.email).toBe('new@example.com');
    expect(await sessionUserId(testAuth.auth, verifyMagicLink.token)).toBe(verifyMagicLink.user.id);
  });

  it('signs an existing user in again rather than making a second one', async () => {
    const first = await anonymous.expectOk(VERIFY, { token: await magicToken('again@example.com') });

    const second = await anonymous.expectOk(VERIFY, { token: await magicToken('again@example.com') });

    expect(second.verifyMagicLink.user.id).toBe(first.verifyMagicLink.user.id);
  });

  it('refuses a link that has already been used', async () => {
    const token = await magicToken('once@example.com');
    await anonymous.expectOk(VERIFY, { token });

    const error = await anonymous.expectError(VERIFY, { token });

    expect(error.code).toBe(ErrorCode.BadUserInput);
  });

  it('rejects a garbage token as bad input, not as an expired session', async () => {
    const error = await anonymous.expectError(VERIFY, { token: 'not-a-token' });

    // UNAUTHENTICATED would make the client drop its token and bounce to /login,
    // so a mistyped link must never report as one.
    expect(error.code).toBe(ErrorCode.BadUserInput);
  });
});

describe('me', () => {
  it('is the signed-in user', async () => {
    const { verifyMagicLink } = await anonymous.expectOk(VERIFY, { token: await magicToken('whoami@example.com') });

    const { me } = await createClient(db, verifyMagicLink.user.id).expectOk(ME);

    expect(me).toEqual({ id: verifyMagicLink.user.id, email: 'whoami@example.com' });
  });

  it('is UNAUTHENTICATED without a session', async () => {
    const error = await anonymous.expectError(ME);

    // The settings screen is the first thing an ended session hits, and this is
    // the code the client watches for to send someone back to /login.
    expect(error.code).toBe(ErrorCode.Unauthenticated);
  });
});

describe('signOut', () => {
  it('ends the session the request carries', async () => {
    const { verifyMagicLink } = await anonymous.expectOk(VERIFY, { token: await magicToken('leaving@example.com') });
    const { token, user } = verifyMagicLink;
    const signedIn = createClient(db, user.id, { auth: testAuth.auth, token });

    const { signOut } = await signedIn.expectOk(SIGN_OUT);

    expect(signOut).toBe(true);
    expect(await sessionUserId(testAuth.auth, token)).toBeNull();
  });

  it('is false when there was no session', async () => {
    const { signOut } = await anonymous.expectOk(SIGN_OUT);

    expect(signOut).toBe(false);
  });
});

describe('authConfig', () => {
  it('says a link is required by default', async () => {
    const { authConfig } = await anonymous.expectOk(AUTH_CONFIG);

    expect(authConfig).toEqual({ secureLocalNet: false, magicLink: true });
  });

  it('says an address alone signs in with SECURE_LOCAL_NET', async () => {
    process.env.SECURE_LOCAL_NET = 'true';

    const { authConfig } = await anonymous.expectOk(AUTH_CONFIG);

    expect(authConfig).toEqual({ secureLocalNet: true, magicLink: false });
  });
});

describe('sign-in rate limit', () => {
  const from = (ip: string, limiter = createRateLimiter({ maxAttempts: 2 })) =>
    createClient(db, null, { auth: testAuth.auth, limiter, ip });

  it('refuses the request past the budget for one address', async () => {
    const client = from('198.51.100.1');
    await client.expectOk(REQUEST, { email: 'a@example.com' });
    await client.expectOk(REQUEST, { email: 'b@example.com' });

    const error = await client.expectError(REQUEST, { email: 'c@example.com' });

    expect(error.code).toBe(ErrorCode.TooManyRequests);
  });

  it('counts by account across addresses and spellings', async () => {
    const limiter = createRateLimiter({ maxAttempts: 2 });
    await from('198.51.100.1', limiter).expectOk(REQUEST, { email: 'alice@example.com' });
    await from('198.51.100.2', limiter).expectOk(REQUEST, { email: ' Alice@Example.com' });

    const error = await from('198.51.100.3', limiter).expectError(REQUEST, { email: 'ALICE@example.com' });

    expect(error.code).toBe(ErrorCode.TooManyRequests);
  });

  it('refuses token guesses past the budget', async () => {
    const client = from('198.51.100.1');
    await client.expectError(VERIFY, { token: 'guess-1' });
    await client.expectError(VERIFY, { token: 'guess-2' });

    const error = await client.expectError(VERIFY, { token: 'guess-3' });

    expect(error.code).toBe(ErrorCode.TooManyRequests);
  });
});

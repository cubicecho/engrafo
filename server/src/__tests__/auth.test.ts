import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, createTestDb, type TestDb } from './helpers.ts';

const REQUEST = `
  mutation($email: String!) {
    requestMagicLink(email: $email) { ok magicLink token userId }
  }
`;

const VERIFY = `mutation($token: String!) { verifyMagicLink(token: $token) { token userId } }`;

const ME = `{ me { id email } }`;

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

// Every one of these reads the environment at call time, so a test that sets a
// variable has to put it back — vitest runs a file's suites in one process.
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('sign-in modes', () => {
  it('returns a link and no session by default', async () => {
    process.env.SECURE_LOCAL_NET = 'false';
    const client = createClient(db, null);

    const { requestMagicLink } = await client.expectOk(REQUEST, { email: 'linked@example.com' });

    expect(requestMagicLink.ok).toBe(true);
    expect(requestMagicLink.token).toBeNull();
    // A session that arrived without following the link would defeat the link.
    expect(requestMagicLink.userId).toBeNull();
  });

  it('signs in on the spot with SECURE_LOCAL_NET, creating the user', async () => {
    process.env.SECURE_LOCAL_NET = 'true';
    const client = createClient(db, null);

    const { requestMagicLink } = await client.expectOk(REQUEST, { email: 'trusted@example.com' });

    expect(requestMagicLink.token).toEqual(expect.any(String));
    expect(requestMagicLink.userId).toEqual(expect.any(String));
    // No link to follow, so handing one back would only be something to leak.
    expect(requestMagicLink.magicLink).toBeNull();
  });

  it('accepts AUTH_MAGIC_LINK=false as the same instruction', async () => {
    process.env.AUTH_MAGIC_LINK = 'false';
    const client = createClient(db, null);

    const { requestMagicLink } = await client.expectOk(REQUEST, { email: 'trusted@example.com' });

    expect(requestMagicLink.token).toEqual(expect.any(String));
  });

  it('returns the same user for an address that has signed in before', async () => {
    process.env.SECURE_LOCAL_NET = 'true';
    const client = createClient(db, null);

    const first = await client.expectOk(REQUEST, { email: 'repeat@example.com' });
    const second = await client.expectOk(REQUEST, { email: 'REPEAT@example.com ' });

    // Addresses are normalized, or the same person gets an archive per spelling.
    expect(second.requestMagicLink.userId).toBe(first.requestMagicLink.userId);
  });
});

describe('me', () => {
  it('is the signed-in user', async () => {
    process.env.SECURE_LOCAL_NET = 'true';
    const { requestMagicLink } = await createClient(db, null).expectOk(REQUEST, { email: 'whoami@example.com' });

    const { me } = await createClient(db, requestMagicLink.userId).expectOk(ME);

    expect(me.id).toBe(requestMagicLink.userId);
    expect(me.email).toBe('whoami@example.com');
  });

  it('is UNAUTHENTICATED without a session', async () => {
    const error = await createClient(db, null).expectError(ME);

    // The settings screen is the first thing an expired token hits, and this is
    // the code the client watches for to send someone back to /login.
    expect(error.code).toBe('UNAUTHENTICATED');
  });
});

describe('verifyMagicLink', () => {
  it('rejects a garbage token as bad input, not as an expired session', async () => {
    const client = createClient(db, null);

    const error = await client.expectError(VERIFY, { token: 'not-a-jwt' });

    // UNAUTHENTICATED would make the client drop its token and bounce to /login,
    // so a mistyped link must never report as one.
    expect(error.code).toBe('BAD_USER_INPUT');
  });
});

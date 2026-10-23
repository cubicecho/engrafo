import { beforeEach, describe, expect, it } from 'vitest';
import { API_KEY_PREFIX, type Auth } from '../../auth/better-auth.ts';
import { ErrorCode } from '../../core/errors.ts';
import { createClient, createTestAuth, createTestDb, createUser, type TestDb } from '../helpers.ts';

const CREATE = `
  mutation ($name: String!, $expiresInDays: Int) {
    createApiKey(name: $name, expiresInDays: $expiresInDays) { key apiKey { id name start expiresAt lastUsedAt } }
  }
`;
const LIST = '{ apiKeys { id name start } }';
const REVOKE = 'mutation ($id: UUID!) { revokeApiKey(id: $id) }';
const CREATE_FOLDER = 'mutation ($name: String!) { createFolder(name: $name) { id mcpEnabled } }';
const SET_MCP =
  'mutation ($id: UUID!, $enabled: Boolean!) { setFolderMcp(id: $id, enabled: $enabled) { id mcpEnabled } }';

describe('API keys', () => {
  let db: TestDb;
  let auth: Auth;
  let userId: string;
  let otherId: string;

  beforeEach(async () => {
    db = await createTestDb();
    auth = createTestAuth(db).auth;
    userId = await createUser(db, 'owner@example.com');
    otherId = await createUser(db, 'other@example.com');
  });

  const client = () => createClient(db, userId, { auth });
  const other = () => createClient(db, otherId, { auth });

  it('makes a key shown once, which verifies as its owner’s, and lists it without the key', async () => {
    const { createApiKey } = await client().expectOk(CREATE, { name: '  Claude Code ' });
    expect(createApiKey.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(createApiKey.apiKey).toMatchObject({ name: 'Claude Code', expiresAt: null, lastUsedAt: null });
    expect(createApiKey.key.startsWith(createApiKey.apiKey.start)).toBe(true);

    const verified = await auth.api.verifyApiKey({ body: { key: createApiKey.key } });
    expect(verified.key?.referenceId).toBe(userId);

    const { apiKeys } = await client().expectOk(LIST);
    expect(apiKeys).toEqual([{ id: createApiKey.apiKey.id, name: 'Claude Code', start: createApiKey.apiKey.start }]);
    expect((await other().expectOk(LIST)).apiKeys).toEqual([]);
  });

  it('sets an expiry in days', async () => {
    const { createApiKey } = await client().expectOk(CREATE, { name: 'Short', expiresInDays: 30 });
    const days = (new Date(createApiKey.apiKey.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it.each([
    ['an empty name', { name: '  ' }],
    ['a name that is too long', { name: 'x'.repeat(61) }],
    ['an expiry under a day', { name: 'k', expiresInDays: 0 }],
  ])('refuses %s', async (_name, variables) => {
    expect((await client().expectError(CREATE, variables)).code).toBe(ErrorCode.BadUserInput);
  });

  it('revokes a key, after which it no longer verifies', async () => {
    const { createApiKey } = await client().expectOk(CREATE, { name: 'Gone' });
    expect(await client().expectOk(REVOKE, { id: createApiKey.apiKey.id })).toEqual({ revokeApiKey: true });
    const verified = await auth.api.verifyApiKey({ body: { key: createApiKey.key } });
    expect(verified.valid).toBe(false);
  });

  it('answers NOT_FOUND for someone else’s key, and leaves it working', async () => {
    const { createApiKey } = await client().expectOk(CREATE, { name: 'Mine' });
    expect((await other().expectError(REVOKE, { id: createApiKey.apiKey.id })).code).toBe(ErrorCode.NotFound);
    expect((await auth.api.verifyApiKey({ body: { key: createApiKey.key } })).valid).toBe(true);
  });

  it('needs a session for every field', async () => {
    const anonymous = createClient(db, null, { auth });
    expect((await anonymous.expectError(LIST)).code).toBe(ErrorCode.Unauthenticated);
    expect((await anonymous.expectError(CREATE, { name: 'k' })).code).toBe(ErrorCode.Unauthenticated);
  });
});

describe('setFolderMcp', () => {
  let db: TestDb;
  let userId: string;
  let otherId: string;

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
    otherId = await createUser(db, 'other@example.com');
  });

  it('is off for a new folder, and turns on and off', async () => {
    const client = createClient(db, userId);
    const { createFolder } = await client.expectOk(CREATE_FOLDER, { name: 'Taxes' });
    expect(createFolder.mcpEnabled).toBe(false);
    expect((await client.expectOk(SET_MCP, { id: createFolder.id, enabled: true })).setFolderMcp.mcpEnabled).toBe(true);
    expect((await client.expectOk(SET_MCP, { id: createFolder.id, enabled: false })).setFolderMcp.mcpEnabled).toBe(
      false,
    );
  });

  it('answers NOT_FOUND for someone else’s folder', async () => {
    const { createFolder } = await createClient(db, userId).expectOk(CREATE_FOLDER, { name: 'Taxes' });
    const refused = await createClient(db, otherId).expectError(SET_MCP, { id: createFolder.id, enabled: true });
    expect(refused.code).toBe(ErrorCode.NotFound);
  });
});

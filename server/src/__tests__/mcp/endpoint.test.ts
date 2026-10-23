import type { Server } from 'node:http';
import { apikeys, documents, folders } from '@cubicecho/engrafo-db/schema';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedAuthHost } from '../../auth/auth-host.ts';
import type { Auth } from '../../auth/better-auth.ts';
import { createRateLimiter } from '../../auth/rate-limit.ts';
import { HttpStatus } from '../../core/wire.ts';
import { createApp } from '../../http/app.ts';
import { MCP_PATH } from '../../mcp/endpoint.ts';
import { createPipelineEvents } from '../../pipeline/events.ts';
import { indexDocument } from '../../search/index-document.ts';
import {
  createFakeEmbedder,
  createFakeStorage,
  createTestAuth,
  createTestDb,
  createUser,
  type FakeStorage,
  type TestDb,
} from '../helpers.ts';

// The real app over a real socket, and the SDK's own client: what an agent actually does.

describe('/mcp', () => {
  let db: TestDb;
  let auth: Auth;
  let storage: FakeStorage;
  let server: Server;
  let url: URL;
  let owner: string;
  let ownerKey: string;
  let otherKey: string;
  const embedder = createFakeEmbedder();
  const clients: Client[] = [];

  async function folder(userId: string, name: string, parentId: string | null, mcpEnabled = false) {
    const [row] = await db.insert(folders).values({ userId, name, parentId, mcpEnabled }).returning();
    return row.id;
  }

  async function document(userId: string, folderId: string | null, title: string, body: string | null) {
    const contentKey = body === null ? null : `text/${userId}/${title}`;
    if (contentKey !== null && body !== null) {
      storage.text.objects.set(contentKey, { body: Buffer.from(body), contentType: 'text/plain' });
    }
    const [doc] = await db
      .insert(documents)
      .values({
        userId,
        folderId,
        title,
        originalFilename: `${title}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        originalKey: `originals/${userId}/${title}`,
        contentKey,
        status: body === null ? 'processing' : 'ready',
      })
      .returning();
    await indexDocument({ db, storage, embedder }, doc);
    return doc;
  }

  async function connect(headers: Record<string, string>): Promise<Client> {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
    clients.push(client);
    return client;
  }

  /** Calls a tool and returns its text, failing the test on a tool error. */
  async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const [first] = result.content as Array<{ type: string; text: string }>;
    return { text: first?.text ?? '', isError: result.isError === true };
  }

  beforeAll(async () => {
    db = await createTestDb();
    auth = createTestAuth(db).auth;
    storage = createFakeStorage();
    owner = await createUser(db, 'owner@example.com');
    const other = await createUser(db, 'other@example.com');
    ownerKey = (await auth.api.createApiKey({ body: { userId: owner, name: 'agent', rateLimitEnabled: false } })).key;
    otherKey = (await auth.api.createApiKey({ body: { userId: other, name: 'agent', rateLimitEnabled: false } })).key;

    // Taxes is shared, so 2026 inside it is too; Private is not, nor is the top level.
    const taxes = await folder(owner, 'Taxes', null, true);
    const year = await folder(owner, '2026', taxes);
    const personal = await folder(owner, 'Private', null);
    // Shared by itself, under a folder that is not: its path still runs from the top.
    const work = await folder(owner, 'Work', null);
    const contracts = await folder(owner, 'Contracts', work, true);
    await document(owner, year, 'Invoice', 'Invoice for plumbing, total 420 EUR, paid in March.');
    await document(owner, taxes, 'Receipt', 'A receipt for the plumbing parts.');
    await document(owner, contracts, 'Lease', `Lease agreement. ${'Rent is due monthly. '.repeat(2000)}`);
    await document(owner, contracts, 'Pending', null);
    await document(owner, personal, 'Diary', 'Private plumbing thoughts.');
    await document(owner, null, 'Loose', 'A plumbing note at the top level.');
    const theirs = await folder(other, 'Taxes', null, true);
    await document(other, theirs, 'Invoice', 'Someone else’s plumbing invoice.');

    const app = createApp({
      db,
      authHost: fixedAuthHost(auth),
      limiter: createRateLimiter(),
      storage,
      events: createPipelineEvents(),
      ocrAvailable: false,
      embedder,
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected the test server to listen on a TCP port');
    }
    url = new URL(MCP_PATH, `http://127.0.0.1:${address.port}`);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('refuses', () => {
    async function status(headers: Record<string, string>) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      return response.status;
    }

    it.each([
      ['no key', {}],
      ['a key nobody made', { authorization: 'Bearer engr_notarealkeyatall' }],
      ['a session token', { authorization: 'Bearer some-session-token' }],
    ])('a request with %s', async (_name, headers) => {
      expect(await status(headers)).toBe(HttpStatus.Unauthorized);
    });

    it('a key once it is revoked', async () => {
      const made = await auth.api.createApiKey({ body: { userId: owner, name: 'gone', rateLimitEnabled: false } });
      expect(await status({ 'x-api-key': made.key })).toBe(HttpStatus.Ok);
      // What revokeApiKey does: the row is the key.
      await db.delete(apikeys).where(eq(apikeys.id, made.id));
      expect(await status({ 'x-api-key': made.key })).toBe(HttpStatus.Unauthorized);
    });
  });

  it('offers four read-only tools', async () => {
    const client = await connect({ authorization: `Bearer ${ownerKey}` });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'engrafo_folders',
      'engrafo_list',
      'engrafo_read',
      'engrafo_search',
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('lists the shared folders and those inside them, by their whole path', async () => {
    const client = await connect({ 'x-api-key': ownerKey });
    const { text } = await call(client, 'engrafo_folders');
    expect(text.split('\n')).toEqual(['Taxes (1 document)', 'Taxes/2026 (1 document)', 'Work/Contracts (2 documents)']);
  });

  it('searches only shared folders, and narrows to one', async () => {
    const client = await connect({ authorization: `Bearer ${ownerKey}` });
    const everywhere = await call(client, 'engrafo_search', { query: 'plumbing' });
    expect(everywhere.text).toContain('Taxes/2026/Invoice');
    expect(everywhere.text).toContain('Taxes/Receipt');
    expect(everywhere.text).not.toMatch(/Diary|Loose|Someone/);

    const narrowed = await call(client, 'engrafo_search', { query: 'plumbing', folder: 'taxes/2026' });
    expect(narrowed.text).toContain('Taxes/2026/Invoice');
    expect(narrowed.text).not.toContain('Receipt');
  });

  it('lists documents with their status, and says a folder that is not shared is not there', async () => {
    const client = await connect({ authorization: `Bearer ${ownerKey}` });
    const { text } = await call(client, 'engrafo_list', { folder: 'Work' });
    expect(text).toContain('No shared folder at that path');

    const listed = await call(client, 'engrafo_list', { folder: 'Work/Contracts' });
    expect(listed.text.split('\n')).toEqual([
      expect.stringMatching(/^Work\/Contracts\/Lease — application\/pdf, 2 KB, added \d{4}-\d{2}-\d{2}, ready$/),
      expect.stringMatching(/^Work\/Contracts\/Pending — .*processing$/),
    ]);
  });

  it('reads a document by its path, ignoring case, in pages', async () => {
    const client = await connect({ authorization: `Bearer ${ownerKey}` });
    const first = await call(client, 'engrafo_read', { path: '/work/contracts/LEASE' });
    expect(first.text).toMatch(/^Work\/Contracts\/Lease: characters 0-20000 of \d+\. Call again with offset 20000/);
    const next = await call(client, 'engrafo_read', { path: 'Work/Contracts/Lease', offset: 40_000 });
    expect(next.text).toMatch(/^Work\/Contracts\/Lease: characters 40000-\d+ of \d+\.\n/);

    const pending = await call(client, 'engrafo_read', { path: 'Work/Contracts/Pending' });
    expect(pending.text).toBe('Work/Contracts/Pending has no text yet: it is processing.');
  });

  it.each([
    ['in a folder that is not shared', 'Private/Diary'],
    ['at the top level', 'Loose'],
    ['that does not exist', 'Taxes/Nothing'],
  ])('answers the same for a document %s', async (_name, path) => {
    const client = await connect({ authorization: `Bearer ${ownerKey}` });
    const result = await call(client, 'engrafo_read', { path });
    expect(result).toEqual({ isError: true, text: expect.stringContaining('No document at that path') });
  });

  it('shows each key only its owner’s archive', async () => {
    const client = await connect({ authorization: `Bearer ${otherKey}` });
    const { text } = await call(client, 'engrafo_search', { query: 'plumbing' });
    expect(text).toContain('Taxes/Invoice');
    expect(text).not.toMatch(/Receipt|2026/);
  });

  it('sees a folder turned off on the very next call', async () => {
    const client = await connect({ authorization: `Bearer ${ownerKey}` });
    await db.update(folders).set({ mcpEnabled: false }).where(eq(folders.name, 'Contracts'));
    const { text } = await call(client, 'engrafo_folders');
    expect(text).not.toContain('Contracts');
    await db.update(folders).set({ mcpEnabled: true }).where(eq(folders.name, 'Contracts'));
  });
});

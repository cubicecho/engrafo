import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../auth/rate-limit.ts';
import { ErrorCode } from '../../core/errors.ts';
import { HttpStatus } from '../../core/wire.ts';
import { createApp, HEALTH_PATH } from '../../http/app.ts';
import { createPipelineEvents } from '../../pipeline/events.ts';
import { createFakeStorage, createTestAuth, createTestDb } from '../helpers.ts';

// The real app over a real socket: what a resolver test cannot see is the
// routing around the schema — which path reaches Yoga, what the probe answers,
// and what a path nobody registered falls back to.

const INDEX_HTML = '<!doctype html><title>Engrafo</title>';
const BUNDLE = 'console.log("bundle")';

describe('createApp', () => {
  let server: Server;
  let origin: string;
  let staticDir: string;

  /** Sends one GraphQL operation as an anonymous client. */
  async function post(query: string): Promise<Response> {
    return fetch(`${origin}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
  }

  beforeAll(async () => {
    staticDir = await mkdtemp(join(tmpdir(), 'engrafo-app-'));
    await mkdir(join(staticDir, 'assets'));
    await writeFile(join(staticDir, 'index.html'), INDEX_HTML);
    await writeFile(join(staticDir, 'assets', 'index-abc123.js'), BUNDLE);

    const db = await createTestDb();
    const app = createApp({
      db,
      auth: createTestAuth(db).auth,
      limiter: createRateLimiter(),
      storage: createFakeStorage(),
      events: createPipelineEvents(),
      ocrAvailable: false,
      staticDir,
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(staticDir, { recursive: true, force: true });
  });

  it('answers a query that needs no session', async () => {
    const response = await post('{ authConfig { magicLink } serverConfig { ocrAvailable } }');

    expect(response.status).toBe(HttpStatus.Ok);
    const body = await response.json();
    expect(body.errors).toBeUndefined();
    expect(body.data.serverConfig).toEqual({ ocrAvailable: false });
  });

  it('refuses a query that needs one, by code', async () => {
    const body = await (await post('{ documents { id } }')).json();

    expect(body.errors[0].extensions.code).toBe(ErrorCode.Unauthenticated);
  });

  it('invites no other origin to read its answers', async () => {
    // The client is served from this origin, so nothing legitimate needs CORS,
    // and a wildcard would let any page a signed-in user visits read the API.
    const response = await fetch(`${origin}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://elsewhere.example' },
      body: JSON.stringify({ query: '{ authConfig { magicLink } }' }),
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers the liveness probe', async () => {
    const response = await fetch(`${origin}${HEALTH_PATH}`);

    expect(response.status).toBe(HttpStatus.Ok);
    expect((await response.json()).ok).toBe(true);
  });

  it('serves a hashed bundle as immutable', async () => {
    const response = await fetch(`${origin}/assets/index-abc123.js`);

    expect(await response.text()).toBe(BUNDLE);
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  it('hands a path only the client knows to the client', async () => {
    const response = await fetch(`${origin}/auth/verify?token=abc`);

    expect(response.status).toBe(HttpStatus.Ok);
    expect(await response.text()).toBe(INDEX_HTML);
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers a path that climbs out of the client folder with the client, not the file', async () => {
    const response = await fetch(`${origin}/..%2f..%2fetc%2fpasswd`);

    expect(await response.text()).toBe(INDEX_HTML);
  });
});

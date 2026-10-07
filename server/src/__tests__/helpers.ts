import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DB } from '@cubicecho/engrafo-db';
import { relations } from '@cubicecho/engrafo-db/relations';
import * as dbSchema from '@cubicecho/engrafo-db/schema';
import { PGlite } from '@electric-sql/pglite';
import { pushSchema } from 'drizzle-kit/api-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import { type ExecutionResult, graphql } from 'graphql';
import { type Auth, createAuth, type MagicLink } from '../auth/better-auth.ts';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limit.ts';
import type { Context } from '../core/context.ts';
import { createSchema } from '../graphql/build-schema.ts';
import { createPipelineEvents, type PipelineEvents } from '../pipeline/events.ts';
import type { Storage, StorageSet } from '../storage/s3.ts';

// A throwaway in-memory Postgres per suite. `@cubicecho/engrafo-db` is
// deliberately never imported here — it opens a real connection at import time —
// so the schema is pulled from `@cubicecho/engrafo-db/schema`, which is inert.

export type TestDb = DB;

/** Signing secret for test auth instances. Long enough to pass `AUTH_DEFAULTS.minSecretLength`, like production's. */
export const TEST_SECRET = 'test-secret-0123456789abcdef0123456789';
/** The address a client's requests come from unless a test says otherwise. */
export const TEST_IP = '127.0.0.1';

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite('memory://');
  const db = drizzle({ client, relations });
  const { apply } = await pushSchema(dbSchema as never, db as never);
  await apply();
  return db;
}

/** A user row created straight through Drizzle — signup is not what is under test. */
export async function createUser(db: TestDb, email: string): Promise<string> {
  const [user] = await db.insert(dbSchema.users).values({ email }).returning();
  return user.id;
}

/** A test auth instance and the magic links it captured. */
export interface TestAuth {
  auth: Auth;
  /** Captured links, newest last. */
  links: MagicLink[];
}

/** better-auth over the test db, with magic links captured instead of logged. */
export function createTestAuth(db: TestDb): TestAuth {
  const links: MagicLink[] = [];
  const auth = createAuth(db, {
    secret: TEST_SECRET,
    sendMagicLink: async (link) => {
      links.push(link);
    },
  });
  return { auth, links };
}

/** Who a session token signs in as, through the same call a request's context makes. */
export async function sessionUserId(auth: Auth, token: string): Promise<string | null> {
  const session = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
  return session?.user.id ?? null;
}

export interface FakeBucket extends Storage {
  objects: Map<string, { body: Buffer; contentType: string }>;
}

export interface FakeStorage extends StorageSet {
  files: FakeBucket;
  text: FakeBucket;
}

/** The two buckets, each a map, so a test can say which one an object landed in. */
export function createFakeStorage(): FakeStorage {
  return { files: createFakeBucket(), text: createFakeBucket() };
}

/** Object storage as a map. Presigned URLs are fake but carry the key, so a test can tell which object one names. */
export function createFakeBucket(): FakeBucket {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const get = (key: string) => {
    const object = objects.get(key);
    if (!object) {
      throw new Error(`NoSuchKey: ${key}`);
    }
    return object;
  };
  return {
    objects,
    presignPut: async (key) => `https://s3.test/put/${key}`,
    presignGet: async (key, { download }) => `https://s3.test/get/${key}${download ? '?download' : ''}`,
    head: async (key) => {
      const object = objects.get(key);
      return object ? { size: object.body.length, contentType: object.contentType } : null;
    },
    getStream: async (key) => Readable.from([get(key).body]),
    download: async (key, path) => {
      await pipeline(Readable.from([get(key).body]), createWriteStream(path));
    },
    put: async (key, body, contentType) => {
      objects.set(key, { body: Buffer.from(body as string), contentType });
    },
    putFile: async (key, path, contentType) => {
      objects.set(key, { body: await readFile(path), contentType });
    },
    delete: async (keys) => {
      for (const key of keys) {
        objects.delete(key);
      }
    },
  };
}

export interface TestClient {
  /** Runs an operation as `userId`, or unauthenticated when it is null. */
  run: (query: string, variables?: Record<string, unknown>) => Promise<ExecutionResult>;
  /** Runs an operation and throws unless it succeeded, returning `data`. */
  // biome-ignore lint/suspicious/noExplicitAny: caller shapes the response
  expectOk: (query: string, variables?: Record<string, unknown>) => Promise<any>;
  /** Runs an operation, expects exactly one error, and returns it. */
  expectError: (query: string, variables?: Record<string, unknown>) => Promise<{ message: string; code: unknown }>;
}

export interface ClientOptions {
  /** Pass one to share sessions and captured magic links across clients. Defaults to a fresh `createTestAuth(db).auth`. */
  auth?: Auth;
  /** Pass a small one to reach the budget. Defaults to `createRateLimiter()`. */
  limiter?: RateLimiter;
  /** Client address the limiter keys on. Defaults to `TEST_IP`. */
  ip?: string;
  /** The session token the request carries, for a mutation that reads it from the headers. */
  token?: string;
  storage?: StorageSet;
  events?: PipelineEvents;
  ocrAvailable?: boolean;
}

export function createClient(db: TestDb, userId: string | null, options: ClientOptions = {}): TestClient {
  const { schema } = createSchema(db);
  const storage = options.storage ?? createFakeStorage();
  const events = options.events ?? createPipelineEvents();
  const { auth = createTestAuth(db).auth, limiter = createRateLimiter(), ip = TEST_IP, token } = options;

  const run = async (query: string, variables?: Record<string, unknown>) => {
    const headers = new Headers(token === undefined ? {} : { authorization: `Bearer ${token}` });
    const contextValue: Context = {
      db,
      auth,
      limiter,
      ip,
      userId,
      headers,
      storage,
      events,
      ocrAvailable: options.ocrAvailable ?? false,
    };
    return graphql({ schema, source: query, contextValue, variableValues: variables });
  };

  return {
    run,
    expectOk: async (query, variables) => {
      const result = await run(query, variables);
      // graphql masks a thrown non-GraphQLError as "Internal server error";
      // surface the original so a broken test reads as the bug it is.
      if (result.errors?.length) {
        const [first] = result.errors;
        throw first.originalError ?? new Error(result.errors.map((error) => error.message).join('; '));
      }
      return result.data;
    },
    expectError: async (query, variables) => {
      const result = await run(query, variables);
      const error = result.errors?.[0];
      if (!error) {
        throw new Error('expected an error, got a successful result');
      }
      return { message: error.message, code: error.extensions?.code };
    },
  };
}

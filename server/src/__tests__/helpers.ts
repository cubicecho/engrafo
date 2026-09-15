import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { relations } from '@cubicecho/engrafo-db/relations';
import * as dbSchema from '@cubicecho/engrafo-db/schema';
import { PGlite } from '@electric-sql/pglite';
import { pushSchema } from 'drizzle-kit/api-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import { type ExecutionResult, graphql } from 'graphql';
import { createSchema } from '../build-schema.ts';
import type { Context } from '../context.ts';
import { createPipelineEvents, type PipelineEvents } from '../pipeline/events.ts';
import type { Storage, StorageSet } from '../storage/s3.ts';

// A throwaway in-memory Postgres per suite. `@cubicecho/engrafo-db` is
// deliberately never imported here — it opens a real connection at import time —
// so the schema is pulled from `@cubicecho/engrafo-db/schema`, which is inert.

// biome-ignore lint/suspicious/noExplicitAny: db type varies by driver
export type TestDb = any;

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
  return user.id as string;
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
    if (!object) throw new Error(`NoSuchKey: ${key}`);
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
      for (const key of keys) objects.delete(key);
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
  storage?: StorageSet;
  events?: PipelineEvents;
  ocrAvailable?: boolean;
}

export function createClient(db: TestDb, userId: string | null, options: ClientOptions = {}): TestClient {
  const { schema } = createSchema(db);
  const storage = options.storage ?? createFakeStorage();
  const events = options.events ?? createPipelineEvents();

  const run = async (query: string, variables?: Record<string, unknown>) => {
    const contextValue: Context = { db, userId, storage, events, ocrAvailable: options.ocrAvailable ?? false };
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
      if (!error) throw new Error('expected an error, got a successful result');
      return { message: error.message, code: error.extensions?.code };
    },
  };
}

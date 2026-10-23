import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DB } from '@cubicecho/engrafo-db';
import { relations } from '@cubicecho/engrafo-db/relations';
import * as dbSchema from '@cubicecho/engrafo-db/schema';
import { EMBEDDING_DIMENSIONS } from '@cubicecho/engrafo-db/schema';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { pushSchema } from 'drizzle-kit/api-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import { strToU8, zipSync } from 'fflate';
import { type ExecutionResult, graphql } from 'graphql';
import { type AuthHost, fixedAuthHost } from '../auth/auth-host.ts';
import { type Auth, createAuth, type MagicLink } from '../auth/better-auth.ts';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limit.ts';
import { type Backups, createBackups } from '../backup/state.ts';
import { appUrl, type OidcConfig } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { createSchema } from '../graphql/build-schema.ts';
import { createPipelineEvents, type PipelineEvents } from '../pipeline/events.ts';
import type { Embedder } from '../search/embedder.ts';
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
  // pgvector, as the migration enables it: the search index's embeddings need it.
  const client = new PGlite('memory://', { extensions: { vector } });
  await client.exec('CREATE EXTENSION IF NOT EXISTS vector');
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

/**
 * better-auth over the test db, with magic links captured instead of logged.
 *
 * @param db - The test database.
 * @param [oidc] - An OIDC provider to sign in with. None by default, whatever the environment says.
 */
export function createTestAuth(db: TestDb, oidc: OidcConfig | null = null): TestAuth {
  const links: MagicLink[] = [];
  const auth = createAuth(db, {
    secret: TEST_SECRET,
    oidc,
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
      objects.set(key, { body: Buffer.from(body), contentType });
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
  /** Pass one to see pairing rebuild it. Defaults to a host that always hands out `auth`. */
  authHost?: AuthHost;
  /** Pass a small one to reach the budget. Defaults to `createRateLimiter()`. */
  limiter?: RateLimiter;
  /** Client address the limiter keys on. Defaults to `TEST_IP`. */
  ip?: string;
  /** The session token the request carries, for a mutation that reads it from the headers. */
  token?: string;
  storage?: StorageSet;
  events?: PipelineEvents;
  ocrAvailable?: boolean;
  /** Where the caller reached the instance. Defaults to `appUrl()`. */
  origin?: string;
  /** Embeds search queries. Defaults to `createFakeEmbedder()`. */
  embedder?: Embedder;
  /** Export links and import runs. Pass one to share it with an app or another client. */
  backups?: Backups;
}

export function createClient(db: TestDb, userId: string | null, options: ClientOptions = {}): TestClient {
  const { schema } = createSchema(db);
  const storage = options.storage ?? createFakeStorage();
  const events = options.events ?? createPipelineEvents();
  const { limiter = createRateLimiter(), ip = TEST_IP, token } = options;
  const authHost = options.authHost ?? fixedAuthHost(options.auth ?? createTestAuth(db).auth);
  const backups = options.backups ?? createBackups();

  const run = async (query: string, variables?: Record<string, unknown>) => {
    const headers = new Headers(token === undefined ? {} : { authorization: `Bearer ${token}` });
    const contextValue: Context = {
      db,
      // Per run, as the handler does per request: a pairing may have rebuilt it since the last one.
      auth: authHost.current(),
      authHost,
      limiter,
      ip,
      userId,
      origin: options.origin ?? appUrl(),
      headers,
      storage,
      events,
      ocrAvailable: options.ocrAvailable ?? false,
      embedder: options.embedder ?? createFakeEmbedder(),
      backups,
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

/**
 * An EPUB zipped from the files given, as a packager writes one: the `mimetype` entry first and
 * stored uncompressed, which is what makes it an EPUB to anything sniffing its bytes.
 *
 * @param files - Paths inside the zip and their contents. `META-INF/container.xml` pointing at
 *   `OEBPS/content.opf` is added unless one is given.
 * @returns The file's bytes.
 */
export function epubFile(files: Record<string, string>): Buffer {
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const entries: Parameters<typeof zipSync>[0] = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
  };
  for (const [path, content] of Object.entries(files)) {
    entries[path] = strToU8(content);
  }
  return Buffer.from(zipSync(entries));
}

/**
 * A one-page PDF with a real text layer, as a word processor would export it, built by hand so
 * no test needs Ghostscript or ImageMagick to make one.
 *
 * @param text - The line on the page. Letters, digits and spaces: it is not escaped.
 * @returns The file's bytes.
 */
export function bornDigitalPdf(text: string): Buffer {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * An embedder that needs no model: each word is hashed to one of the vector's dimensions, so
 * texts that share words point the same way and the cosine is their overlap. Deterministic,
 * which the model is not across versions, and instant.
 *
 * @returns The fake, which counts the texts it was asked to embed.
 */
export function createFakeEmbedder(): Embedder & { embedded: string[] } {
  const embedded: string[] = [];
  return {
    model: 'fake-bag-of-words',
    embedded,
    async embed(texts) {
      embedded.push(...texts);
      return texts.map((text) => {
        const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
          let hash = 0;
          for (const char of word) {
            hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
          }
          vector[hash % EMBEDDING_DIMENSIONS] = (vector[hash % EMBEDDING_DIMENSIONS] ?? 0) + 1;
        }
        const length = Math.hypot(...vector) || 1;
        return vector.map((value) => value / length);
      });
    },
  };
}

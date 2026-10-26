import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import * as dbSchema from '@cubicecho/engrafo-db/schema';
import { documents, processingSteps } from '@cubicecho/engrafo-db/schema';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { createPipelineEvents, type PipelineEvents } from '../../pipeline/events.ts';
import { readVisionSettings, saveVisionSettings } from '../../vision/settings.ts';
import { createClient, createTestDb, createUser, type TestDb } from '../helpers.ts';

const SETTINGS =
  '{ visionSettings { baseUrl model hasApiKey auto requestTimeoutSeconds maxResponseTokens imageDetail configured } }';
const SET = `
  mutation ($input: VisionSettingsInput!) {
    setVisionSettings(input: $input) { baseUrl model hasApiKey auto requestTimeoutSeconds maxResponseTokens imageDetail configured }
  }
`;
const MODELS =
  'query ($baseUrl: String!, $apiKey: String) { visionModels(baseUrl: $baseUrl, apiKey: $apiKey) { id contextLength } }';
const READ = 'mutation ($id: UUID!) { readDocumentWithVision(id: $id) { id status error visionRequested contentKey } }';
const SERVER_CONFIG = '{ serverConfig { visionAvailable visionAuto } }';

async function makeAdmin(db: TestDb, id: string) {
  await db.update(dbSchema.users).set({ isAdmin: true }).where(eq(dbSchema.users.id, id));
}

/** An endpoint's `/models`, recording the authorization header each request carried. */
async function modelsEndpoint(body: unknown, status = 200) {
  const seen: IncomingHttpHeaders[] = [];
  const server: Server = createServer((req, res) => {
    seen.push(req.headers);
    if (req.url !== '/v1/models') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('vision settings', () => {
  let db: TestDb;
  let adminId: string;
  let userId: string;

  beforeEach(async () => {
    db = await createTestDb();
    adminId = await createUser(db, 'admin@example.com');
    await makeAdmin(db, adminId);
    userId = await createUser(db, 'someone@example.com');
  });

  it('answers defaults before anything is saved', async () => {
    const data = await createClient(db, adminId).expectOk(SETTINGS);
    expect(data.visionSettings).toEqual({
      baseUrl: null,
      model: null,
      hasApiKey: false,
      auto: false,
      requestTimeoutSeconds: 600,
      maxResponseTokens: 8192,
      imageDetail: 'AUTO',
      configured: false,
    });
  });

  it('is the admin’s only: FORBIDDEN for anyone else, UNAUTHENTICATED signed out', async () => {
    const someone = createClient(db, userId);
    expect((await someone.expectError(SETTINGS)).code).toBe(ErrorCode.Forbidden);
    expect((await someone.expectError(SET, { input: { auto: false } })).code).toBe(ErrorCode.Forbidden);
    expect((await someone.expectError(MODELS, { baseUrl: 'http://box/v1' })).code).toBe(ErrorCode.Forbidden);
    expect((await createClient(db, null).expectError(SETTINGS)).code).toBe(ErrorCode.Unauthenticated);
  });

  it('stores the settings, says a key is stored, and never reads it back', async () => {
    const admin = createClient(db, adminId);
    const data = await admin.expectOk(SET, {
      input: { baseUrl: ' http://gpu.lan:8080/v1/ ', model: ' qwen2.5-vl ', apiKey: 'sk-secret', auto: true },
    });
    expect(data.setVisionSettings).toEqual({
      baseUrl: 'http://gpu.lan:8080/v1',
      model: 'qwen2.5-vl',
      hasApiKey: true,
      auto: true,
      requestTimeoutSeconds: 600,
      maxResponseTokens: 8192,
      imageDetail: 'AUTO',
      configured: true,
    });
    expect(JSON.stringify(await admin.expectOk(SETTINGS))).not.toContain('sk-secret');
    expect((await readVisionSettings(db))?.apiKey).toBe('sk-secret');
  });

  it('keeps the key when it is left out, and clears it on an empty string', async () => {
    const admin = createClient(db, adminId);
    await admin.expectOk(SET, { input: { baseUrl: 'http://box/v1', model: 'm', apiKey: 'sk-1', auto: false } });

    await admin.expectOk(SET, { input: { baseUrl: 'http://box/v1', model: 'other', auto: false } });
    expect((await readVisionSettings(db))?.apiKey).toBe('sk-1');

    const cleared = await admin.expectOk(SET, {
      input: { baseUrl: 'http://box/v1', model: 'm', apiKey: '', auto: false },
    });
    expect(cleared.setVisionSettings.hasApiKey).toBe(false);
    expect((await readVisionSettings(db))?.apiKey).toBeNull();
  });

  it('turns the model off with an empty base URL or model', async () => {
    const admin = createClient(db, adminId);
    const data = await admin.expectOk(SET, { input: { baseUrl: '', model: 'm', auto: true } });
    expect(data.setVisionSettings).toMatchObject({ baseUrl: null, configured: false });
    const config = await admin.expectOk(SERVER_CONFIG);
    expect(config.serverConfig).toEqual({ visionAvailable: false, visionAuto: false });
  });

  it('refuses a base URL that is not http(s), and a timeout out of bounds', async () => {
    const admin = createClient(db, adminId);
    const scheme = await admin.expectError(SET, { input: { baseUrl: 'file:///etc', model: 'm', auto: false } });
    expect(scheme.code).toBe(ErrorCode.BadUserInput);
    const low = await admin.expectError(SET, {
      input: { baseUrl: 'http://box/v1', model: 'm', auto: false, requestTimeoutSeconds: 1 },
    });
    expect(low.code).toBe(ErrorCode.BadUserInput);
    const high = await admin.expectError(SET, {
      input: { baseUrl: 'http://box/v1', model: 'm', auto: false, requestTimeoutSeconds: 1_000_000 },
    });
    expect(high.code).toBe(ErrorCode.BadUserInput);
    const ok = await admin.expectOk(SET, {
      input: { baseUrl: 'http://box/v1', model: 'm', auto: false, requestTimeoutSeconds: 120 },
    });
    expect(ok.setVisionSettings.requestTimeoutSeconds).toBe(120);
  });

  it('stores the reply cap and the image detail, and refuses a cap out of bounds', async () => {
    const admin = createClient(db, adminId);
    const base = { baseUrl: 'http://box/v1', model: 'm', auto: false };
    const data = await admin.expectOk(SET, { input: { ...base, maxResponseTokens: 2048, imageDetail: 'LOW' } });
    expect(data.setVisionSettings).toMatchObject({ maxResponseTokens: 2048, imageDetail: 'LOW' });
    expect(await readVisionSettings(db)).toMatchObject({ maxResponseTokens: 2048, imageDetail: 'low' });

    for (const maxResponseTokens of [10, 1_000_000]) {
      const refused = await admin.expectError(SET, { input: { ...base, maxResponseTokens } });
      expect(refused.code).toBe(ErrorCode.BadUserInput);
    }

    // Left out is the default again, as for the timeout.
    const reset = await admin.expectOk(SET, { input: base });
    expect(reset.setVisionSettings).toMatchObject({ maxResponseTokens: 8192, imageDetail: 'AUTO' });
    expect(await readVisionSettings(db)).toMatchObject({ maxResponseTokens: null, imageDetail: null });
  });

  it('tells any signed-in caller whether a model is set up, and a visitor nothing', async () => {
    await saveVisionSettings(db, {
      baseUrl: 'http://box/v1',
      model: 'm',
      apiKey: undefined,
      auto: true,
      requestTimeoutSeconds: null,
      maxResponseTokens: null,
      imageDetail: null,
    });
    expect((await createClient(db, userId).expectOk(SERVER_CONFIG)).serverConfig).toEqual({
      visionAvailable: true,
      visionAuto: true,
    });
    expect((await createClient(db, null).expectOk(SERVER_CONFIG)).serverConfig).toEqual({
      visionAvailable: false,
      visionAuto: false,
    });
  });
});

describe('visionModels', () => {
  let db: TestDb;
  let adminId: string;
  let endpoint: Awaited<ReturnType<typeof modelsEndpoint>>;

  beforeEach(async () => {
    db = await createTestDb();
    adminId = await createUser(db, 'admin@example.com');
    await makeAdmin(db, adminId);
    endpoint = await modelsEndpoint({
      data: [{ id: 'zeta' }, { id: 'alpha', context_length: 32768 }, { id: 'alpha' }, { nope: true }],
    });
  });

  afterEach(async () => {
    await endpoint.close();
  });

  it('lists the models, sorted, with a context length where one is given', async () => {
    const data = await createClient(db, adminId).expectOk(MODELS, { baseUrl: endpoint.baseUrl });
    expect(data.visionModels).toEqual([
      { id: 'alpha', contextLength: 32768 },
      { id: 'zeta', contextLength: null },
    ]);
  });

  it('sends a typed key, else the stored key only to the URL it was stored for', async () => {
    const admin = createClient(db, adminId);
    await saveVisionSettings(db, {
      baseUrl: endpoint.baseUrl,
      model: 'alpha',
      apiKey: 'sk-stored',
      auto: false,
      requestTimeoutSeconds: null,
      maxResponseTokens: null,
      imageDetail: null,
    });

    await admin.expectOk(MODELS, { baseUrl: endpoint.baseUrl, apiKey: 'sk-typed' });
    await admin.expectOk(MODELS, { baseUrl: `${endpoint.baseUrl}/` });
    // The same server under another spelling of its host is another endpoint as far as the key goes.
    await admin.expectOk(MODELS, { baseUrl: endpoint.baseUrl.replace('127.0.0.1', 'localhost') });

    expect(endpoint.seen.map((headers) => headers.authorization)).toEqual([
      'Bearer sk-typed',
      'Bearer sk-stored',
      undefined,
    ]);
  });

  it('says why when the endpoint cannot be reached or does not list models', async () => {
    const admin = createClient(db, adminId);
    const unreachable = await admin.expectError(MODELS, { baseUrl: 'http://127.0.0.1:1/v1' });
    expect(unreachable).toMatchObject({ code: ErrorCode.BadUserInput, message: expect.stringContaining('reach') });

    const notUrl = await admin.expectError(MODELS, { baseUrl: 'not a url' });
    expect(notUrl.code).toBe(ErrorCode.BadUserInput);

    const wrong = await modelsEndpoint({ hello: 'world' });
    try {
      const shape = await admin.expectError(MODELS, { baseUrl: wrong.baseUrl });
      expect(shape).toMatchObject({ code: ErrorCode.BadUserInput, message: expect.stringContaining('list of models') });
    } finally {
      await wrong.close();
    }

    const refused = await modelsEndpoint({}, 401);
    try {
      const status = await admin.expectError(MODELS, { baseUrl: refused.baseUrl });
      expect(status).toMatchObject({ code: ErrorCode.BadUserInput, message: expect.stringContaining('401') });
    } finally {
      await refused.close();
    }
  });
});

describe('readDocumentWithVision', () => {
  let db: TestDb;
  let userId: string;
  let events: PipelineEvents;
  let emitted: string[];

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
    events = createPipelineEvents();
    emitted = [];
    events.on('document.uploaded', ({ documentId }) => emitted.push(documentId));
    await saveVisionSettings(db, {
      baseUrl: 'http://box/v1',
      model: 'm',
      apiKey: undefined,
      auto: false,
      requestTimeoutSeconds: null,
      maxResponseTokens: null,
      imageDetail: null,
    });
  });

  const client = (id: string | null = userId) => createClient(db, id, { events });

  async function insertDocument(values: Partial<typeof documents.$inferInsert> = {}) {
    const [doc] = await db
      .insert(documents)
      .values({
        userId,
        title: `Scan ${randomUUID()}`,
        originalFilename: 'scan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 5,
        originalKey: `originals/${userId}/${randomUUID()}`,
        archiveKey: `archives/${userId}/scan.pdf`,
        contentKey: `text/${userId}/scan.txt`,
        status: 'ready',
        ...values,
      })
      .returning();
    const names = ['inspect', 'text', 'ocr', 'pdf-text', 'ebook', 'metadata', 'index'];
    await db
      .insert(processingSteps)
      .values(
        names.map((step, position) => ({ userId, documentId: doc.id, step, position, status: 'succeeded' as const })),
      );
    return doc;
  }

  const stepsOf = async (id: string) =>
    (
      await db
        .select()
        .from(processingSteps)
        .where(eq(processingSteps.documentId, id))
        .orderBy(asc(processingSteps.position))
    ).map((row) => [row.step, row.status]);

  it('queues the read and the steps built from the text, keeping the archive and the text', async () => {
    const doc = await insertDocument();
    const data = await client().expectOk(READ, { id: doc.id });

    expect(data.readDocumentWithVision).toEqual({
      id: doc.id,
      status: 'uploaded',
      error: null,
      visionRequested: true,
      contentKey: doc.contentKey,
    });
    expect((await db.select().from(documents).where(eq(documents.id, doc.id)))[0].archiveKey).toBe(doc.archiveKey);
    expect(await stepsOf(doc.id)).toEqual([
      ['inspect', 'succeeded'],
      ['text', 'succeeded'],
      ['ocr', 'succeeded'],
      ['pdf-text', 'succeeded'],
      ['ebook', 'succeeded'],
      ['metadata', 'queued'],
      ['index', 'queued'],
    ]);
    expect(emitted).toEqual([doc.id]);
  });

  it('takes a failed document, re-running the step that failed too', async () => {
    const doc = await insertDocument({ status: 'failed', error: 'ocr: boom' });
    await db.update(processingSteps).set({ status: 'failed' }).where(eq(processingSteps.step, 'ocr'));

    const data = await client().expectOk(READ, { id: doc.id });
    expect(data.readDocumentWithVision).toMatchObject({ status: 'uploaded', error: null });
    expect((await stepsOf(doc.id)).find(([step]) => step === 'ocr')).toEqual(['ocr', 'queued']);
  });

  it('is NOT_FOUND for someone else’s document', async () => {
    const doc = await insertDocument();
    const stranger = await createUser(db, 'stranger@example.com');
    expect((await client(stranger).expectError(READ, { id: doc.id })).code).toBe(ErrorCode.NotFound);
    expect(emitted).toEqual([]);
  });

  it('refuses without a model, for a type it cannot read, and before the upload finishes', async () => {
    const text = await insertDocument({ mimeType: 'text/plain' });
    expect((await client().expectError(READ, { id: text.id })).code).toBe(ErrorCode.BadUserInput);

    const pending = await insertDocument({ status: 'pending_upload' });
    expect((await client().expectError(READ, { id: pending.id })).code).toBe(ErrorCode.BadUserInput);

    await saveVisionSettings(db, {
      baseUrl: null,
      model: null,
      apiKey: null,
      auto: false,
      requestTimeoutSeconds: null,
      maxResponseTokens: null,
      imageDetail: null,
    });
    const doc = await insertDocument({});
    expect((await client().expectError(READ, { id: doc.id })).code).toBe(ErrorCode.BadUserInput);
    expect(emitted).toEqual([]);
  });

  it('is CONFLICT while the document is being processed', async () => {
    const doc = await insertDocument({ status: 'processing' });
    expect((await client().expectError(READ, { id: doc.id })).code).toBe(ErrorCode.Conflict);
  });
});

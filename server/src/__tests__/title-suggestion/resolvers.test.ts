import { randomUUID } from 'node:crypto';
import { resetAll } from '@cubicecho/agent-core';
import { DocumentStatus, documents } from '@cubicecho/engrafo-db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TITLE_SUGGESTION_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { SUGGEST_TITLE } from '../../title-suggestion/prompt.ts';
import { suggestDocumentTitle } from '../../title-suggestion/suggest.ts';
import { saveVisionSettings } from '../../vision/settings.ts';
import { fakeEndpoint } from '../fake-model.ts';
import {
  createClient,
  createFakeStorage,
  createTestDb,
  createUser,
  type FakeStorage,
  NO_SAMPLER,
  type TestDb,
} from '../helpers.ts';

const SUGGEST = 'query ($ids: [UUID!]!) { suggestDocumentTitle(ids: $ids) }';

describe('suggestDocumentTitle', () => {
  let db: TestDb;
  let userId: string;
  let otherId: string;
  let storage: FakeStorage;
  let endpoint: Awaited<ReturnType<typeof fakeEndpoint>> | undefined;

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
    otherId = await createUser(db, 'other@example.com');
    storage = createFakeStorage();
  });

  afterEach(async () => {
    await endpoint?.close();
    endpoint = undefined;
    resetAll();
  });

  interface SeedOptions {
    owner?: string;
    text?: string;
    documentDate?: string;
    vendor?: string;
    status?: (typeof DocumentStatus)[keyof typeof DocumentStatus];
    deletedAt?: Date;
  }

  /** A processed document straight through Drizzle, with its text in the fake text bucket. */
  async function seed(title: string, options: SeedOptions = {}): Promise<string> {
    const id = randomUUID();
    const owner = options.owner ?? userId;
    const contentKey = options.text === undefined ? null : `text/${owner}/${id}.txt`;
    if (contentKey !== null && options.text !== undefined) {
      await storage.text.put(contentKey, options.text, 'text/plain');
    }
    await db.insert(documents).values({
      id,
      userId: owner,
      title,
      originalFilename: `${title}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1,
      originalKey: `originals/${owner}/${id}`,
      contentKey,
      documentDate: options.documentDate ?? null,
      vendor: options.vendor ?? null,
      status: options.status ?? DocumentStatus.Ready,
      ...(options.deletedAt ? { deletedAt: options.deletedAt } : {}),
    });
    return id;
  }

  /** Points the vision settings at a fake endpoint answering `answer`. */
  async function setUpModel(answer: Parameters<typeof fakeEndpoint>[0]) {
    endpoint = await fakeEndpoint(answer);
    await saveVisionSettings(db, {
      baseUrl: endpoint.baseUrl,
      model: 'test-vlm',
      apiKey: undefined,
      auto: false,
      skipOcr: false,
      requestTimeoutSeconds: null,
      maxResponseTokens: null,
      imageDetail: null,
      temperature: 0.2,
      textFormat: null,
      prompt: null,
      ...NO_SAMPLER,
      topP: 0.9,
    });
    return endpoint;
  }

  const client = (as: string | null = userId) => createClient(db, as, { storage });

  it('asks for a session', async () => {
    const a = await seed('a');
    expect((await client(null).expectError(SUGGEST, { ids: [a] })).code).toBe(ErrorCode.Unauthenticated);
  });

  it('cannot see another user’s document, one in the trash, one still uploading, or one that does not exist', async () => {
    const { bodies } = await setUpModel(() => ({ content: 'Never asked' }));
    const mine = await seed('mine', { text: 'mine' });
    const theirs = await seed('theirs', { owner: otherId, text: 'secret' });
    const trashed = await seed('trashed', { deletedAt: new Date() });
    const pending = await seed('pending', { status: DocumentStatus.PendingUpload });
    for (const id of [theirs, trashed, pending, randomUUID()]) {
      const error = await client().expectError(SUGGEST, { ids: [mine, id] });
      expect(error.code).toBe(ErrorCode.NotFound);
    }
    expect(bodies).toHaveLength(0);
  });

  // The `UUID` scalar refuses one at the door; this is the rule behind it, for a caller that is not GraphQL.
  it('answers NOT_FOUND for an id that is not a UUID, as for one that is not there', async () => {
    await expect(suggestDocumentTitle({ db, storage }, userId, ['not-a-uuid'])).rejects.toMatchObject({
      extensions: { code: ErrorCode.NotFound },
    });
  });

  it('needs at least one document, and refuses too many', async () => {
    expect((await client().expectError(SUGGEST, { ids: [] })).code).toBe(ErrorCode.BadUserInput);
    const many = Array.from({ length: TITLE_SUGGESTION_DEFAULTS.maxDocuments + 1 }, () => randomUUID());
    expect((await client().expectError(SUGGEST, { ids: many })).code).toBe(ErrorCode.BadUserInput);
  });

  it('refuses when no model is set up', async () => {
    const a = await seed('a', { text: 'a' });
    const error = await client().expectError(SUGGEST, { ids: [a] });
    expect(error.code).toBe(ErrorCode.BadUserInput);
    expect(error.message).toMatch(/No vision model is set up/);
  });

  it('asks the model with each document in order, and answers its title made safe', async () => {
    const { bodies } = await setUpModel(() => ({ content: 'Title: "Lease 12 Harbour Road / signed"' }));
    const lease = await seed('scan_0001', {
      text: 'RESIDENTIAL LEASE\n\nThis lease is made between Ana Ruiz and Harbour Homes.',
      documentDate: '2025-03-12',
    });
    const signed = await seed('scan_0002', { vendor: 'Harbour Homes' });

    const data = await client().expectOk(SUGGEST, { ids: [lease, signed] });
    expect(data.suggestDocumentTitle).toBe('Lease 12 Harbour Road - signed');

    expect(bodies).toHaveLength(1);
    const [body] = bodies;
    expect(body.model).toBe('test-vlm');
    expect(body.temperature).toBe(0.2);
    expect(body).toMatchObject({ top_p: 0.9 });
    expect(body.messages[0]).toEqual({ role: 'system', content: SUGGEST_TITLE });
    const user = String(body.messages[1].content);
    expect(user).toContain('Document 1 of 2\nCurrent title: scan_0001\nDate on it: 2025-03-12');
    expect(user).toContain('Start of its text: RESIDENTIAL LEASE This lease is made between Ana Ruiz');
    // No text: its title and vendor alone.
    expect(user).toMatch(/Document 2 of 2\nCurrent title: scan_0002\nVendor: Harbour Homes$/);
    // A title is short, so the reply's ceiling is the suggestion's, not the per-page one.
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(TITLE_SUGGESTION_DEFAULTS.maxResponseTokens);
  });

  it('reads only the start of a long text', async () => {
    const { bodies } = await setUpModel(() => ({ content: 'A long book' }));
    const book = await seed('book', { text: `Chapter one. ${'and then '.repeat(50_000)}THE END` });
    await client().expectOk(SUGGEST, { ids: [book] });
    const user = String(bodies[0].messages[1].content);
    expect(user).not.toContain('THE END');
    expect(user.length).toBeLessThan(TITLE_SUGGESTION_DEFAULTS.textPerDocumentMaxChars + 200);
  });

  it('writes nothing', async () => {
    await setUpModel(() => ({ content: 'Something else' }));
    const a = await seed('a', { text: 'a' });
    const before = await db.select().from(documents);
    await client().expectOk(SUGGEST, { ids: [a] });
    expect(await db.select().from(documents)).toEqual(before);
  });

  it('says so when the model gives no usable title', async () => {
    await setUpModel(() => ({ content: '```\n```' }));
    const a = await seed('a', { text: 'a' });
    const error = await client().expectError(SUGGEST, { ids: [a] });
    expect(error.code).toBe(ErrorCode.BadUserInput);
    expect(error.message).toMatch(/did not suggest a usable title/);
  });

  it('says so when the model ran into the reply limit', async () => {
    await setUpModel(() => ({ content: 'Lease lease lease lease', finishReason: 'length' }));
    const a = await seed('a', { text: 'a' });
    const error = await client().expectError(SUGGEST, { ids: [a] });
    expect(error.code).toBe(ErrorCode.BadUserInput);
    expect(error.message).toMatch(/reply limit/);
  });

  it('says so when the model does not answer', async () => {
    await setUpModel(() => ({ status: 500 }));
    const a = await seed('a', { text: 'a' });
    const error = await client().expectError(SUGGEST, { ids: [a] });
    expect(error.code).toBe(ErrorCode.BadUserInput);
    expect(error.message).toMatch(/The model did not answer/);
  });
});

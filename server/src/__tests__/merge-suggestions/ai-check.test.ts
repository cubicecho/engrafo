import { resetAll } from '@cubicecho/agent-core';
import { MergeSuggestionStatus, mergeSuggestions } from '@cubicecho/engrafo-db/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MERGE_SUGGESTION_DEFAULTS } from '../../core/defaults.ts';
import { checkUser } from '../../merge-suggestions/ai-check.ts';
import { JUDGE_CONTINUATION } from '../../merge-suggestions/prompt.ts';
import { recordVerdict, rescoreUser } from '../../merge-suggestions/store.ts';
import type { MergeVerdict } from '../../merge-suggestions/verdicts.ts';
import { saveVisionSettings } from '../../vision/settings.ts';
import { type Answer, fakeEndpoint } from '../fake-model.ts';
import { createFakeStorage, createTestDb, createUser, type FakeStorage, NO_SAMPLER, type TestDb } from '../helpers.ts';
import { at, frontAndBack, invoicePages } from './fixtures.ts';
import { seedCandidates } from './seed.ts';

// The morning's fixtures as rows, the day after: the invoice's steps are sure by the rules alone,
// the form's front and back are not, so only that one step is the model's to judge.
const NOW = new Date(at(0).getTime() + 24 * 60 * 60 * 1000);
const MINUTE_MS = 60 * 1000;
const RETRY_MS = MERGE_SUGGESTION_DEFAULTS.aiRetryMinutes * MINUTE_MS;

const CONFIRMS: Answer = { content: '{"continues": true, "confidence": 0.9, "reason": "the terms it refers to"}' };
const REJECTS: Answer = { content: '{"continues": false, "confidence": 1, "reason": "a new document starts"}' };

describe('checkUser', () => {
  let db: TestDb;
  let storage: FakeStorage;
  let userId: string;
  let logged: string[];
  let failedSteps: Map<string, Date>;
  let endpoint: Awaited<ReturnType<typeof fakeEndpoint>> | undefined;

  beforeEach(async () => {
    db = await createTestDb();
    storage = createFakeStorage();
    userId = await createUser(db, 'owner@example.com');
    logged = [];
    failedSteps = new Map();
  });

  afterEach(async () => {
    await endpoint?.close();
    endpoint = undefined;
    resetAll();
  });

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
      temperature: null,
      textFormat: null,
      prompt: null,
      ...NO_SAMPLER,
    });
    return endpoint;
  }

  /** Files the morning's invoice and form for `owner` and scores them. */
  async function seedAndRescore(owner = userId) {
    await seedCandidates(db, storage, owner, [...invoicePages, ...frontAndBack]);
    await rescoreUser({ db, storage }, owner, { now: NOW });
  }

  const check = (now = NOW, owner = userId) =>
    checkUser({ db, storage, failedSteps }, owner, { now, log: (message) => logged.push(message) });
  const rowsOf = (owner = userId) => db.select().from(mergeSuggestions).where(eq(mergeSuggestions.userId, owner));
  const formRow = async (owner = userId) => {
    const rows = await rowsOf(owner);
    const row = rows.find((each) => each.documentIds.length === 2);
    if (!row) {
      throw new Error('The form was not suggested.');
    }
    return row;
  };

  it('asks only about unsure steps with no answer, and records the answer', async () => {
    const { bodies } = await setUpModel(() => CONFIRMS);
    await seedAndRescore();
    const before = await formRow();
    const invoiceBefore = (await rowsOf()).find((row) => row.documentIds.length === 3);

    expect(await check()).toEqual({ asked: 1, recorded: 1 });
    expect(bodies).toHaveLength(1);
    const [body] = bodies;
    expect(body.messages[0]).toEqual({ role: 'system', content: JUDGE_CONTINUATION });
    const user = String(body.messages[1].content);
    expect(user).toMatch(/^First document\nTitle: form-front\nFile name: scan_0006.jpg\nEnd of its text:/);
    expect(user).toContain(
      'Second document\nTitle: form-back\nFile name: scan_0007.jpg\nStart of its text:\n<<<\nTerms of Membership',
    );
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(MERGE_SUGGESTION_DEFAULTS.aiMaxResponseTokens);

    const after = await formRow();
    expect(after.aiVerdicts).toEqual([
      {
        fromId: before.documentIds[0],
        toId: before.documentIds[1],
        continues: true,
        confidence: 0.9,
        reason: 'the terms it refers to',
        model: 'test-vlm',
        checkedAt: NOW.toISOString(),
      },
    ]);
    expect(after.heuristicConfidence).toBe(before.confidence);
    expect(after.confidence).toBeGreaterThan(before.confidence);
    expect(after.reasons.map((reason) => reason.text)).toContain(
      'AI: page 2 continues page 1 (the terms it refers to)',
    );
    // The invoice was sure without it.
    expect((await rowsOf()).find((row) => row.documentIds.length === 3)).toEqual(invoiceBefore);

    // Answered, so not asked again.
    expect(await check()).toEqual({ asked: 0, recorded: 0 });
    expect(bodies).toHaveLength(1);
  });

  it('asks nothing when no model is set up', async () => {
    await seedAndRescore();
    const before = await rowsOf();
    expect(await check()).toEqual({ asked: 0, recorded: 0 });
    expect(await rowsOf()).toEqual(before);
  });

  it('keeps the rules’ score when the endpoint fails, and waits before asking again', async () => {
    const { bodies } = await setUpModel(() => ({ status: 500 }));
    await seedAndRescore();
    const before = await formRow();

    expect(await check()).toEqual({ asked: 1, recorded: 0 });
    expect(await formRow()).toEqual(before);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^\[merge-suggestions\] The model did not judge whether .* The rules' score stands/);

    expect(await check(new Date(NOW.getTime() + RETRY_MS - MINUTE_MS))).toEqual({ asked: 0, recorded: 0 });
    expect(bodies).toHaveLength(1);

    expect(await check(new Date(NOW.getTime() + RETRY_MS))).toEqual({ asked: 1, recorded: 0 });
    expect(bodies).toHaveLength(2);
  });

  it('records no answer from a reply that hit the token limit, or one it cannot read', async () => {
    let reply: Answer = { content: '{"continues": true, "confid', finishReason: 'length' };
    await setUpModel(() => reply);
    await seedAndRescore();
    const before = await formRow();

    expect(await check()).toEqual({ asked: 1, recorded: 0 });
    expect(logged[0]).toMatch(/reply limit/);

    reply = { content: 'They probably belong together.' };
    expect(await check(new Date(NOW.getTime() + RETRY_MS))).toEqual({ asked: 1, recorded: 0 });
    expect(logged[1]).toMatch(/no answer could be read/);
    expect(await formRow()).toEqual(before);
  });

  it('writes nothing to a suggestion dismissed while the model was asked', async () => {
    await setUpModel(async () => {
      await db.update(mergeSuggestions).set({ status: MergeSuggestionStatus.Dismissed });
      return CONFIRMS;
    });
    await seedAndRescore();

    expect(await check()).toEqual({ asked: 1, recorded: 0 });
    const after = await formRow();
    expect(after.status).toBe(MergeSuggestionStatus.Dismissed);
    expect(after.aiVerdicts).toEqual([]);
  });

  it('never asks about or touches another user’s suggestions', async () => {
    const otherId = await createUser(db, 'other@example.com');
    const { bodies } = await setUpModel(() => CONFIRMS);
    await seedAndRescore();
    await seedAndRescore(otherId);
    const theirs = await rowsOf(otherId);
    const mine = await formRow();

    expect(await check()).toEqual({ asked: 1, recorded: 1 });
    expect(bodies).toHaveLength(1);
    expect(await rowsOf(otherId)).toEqual(theirs);
    expect((await formRow()).aiVerdicts.map((verdict) => verdict.fromId)).toEqual([mine.documentIds[0]]);
  });

  it('keeps a verdict and its confidence through a rescore', async () => {
    await setUpModel(() => CONFIRMS);
    await seedAndRescore();
    await check();
    const checked = await formRow();

    expect(await rescoreUser({ db, storage }, userId, { now: NOW })).toMatchObject({ updated: 2 });
    const rescored = await formRow();
    expect(rescored.aiVerdicts).toEqual(checked.aiVerdicts);
    expect(rescored.confidence).toBe(checked.confidence);
    expect(rescored.confidence).toBeGreaterThan(rescored.heuristicConfidence);
    expect(rescored.reasons).toEqual(checked.reasons);
  });

  it('keeps a suggestion the model rejected, without showing it, and never asks about it again', async () => {
    const { bodies } = await setUpModel(() => REJECTS);
    await seedAndRescore();
    await check();
    const rejected = await formRow();
    expect(rejected.status).toBe(MergeSuggestionStatus.Open);
    expect(rejected.confidence).toBeLessThan(MERGE_SUGGESTION_DEFAULTS.minConfidence);

    await rescoreUser({ db, storage }, userId, { now: NOW });
    expect((await formRow()).confidence).toBe(rejected.confidence);
    expect(await check()).toEqual({ asked: 0, recorded: 0 });
    expect(bodies).toHaveLength(1);
  });
});

describe('recordVerdict', () => {
  let db: TestDb;
  let userId: string;

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
  });

  const verdict = (fromId: string, toId: string): MergeVerdict => ({
    fromId,
    toId,
    continues: true,
    confidence: 0.9,
    reason: '',
    model: 'test-vlm',
    checkedAt: NOW.toISOString(),
  });

  async function seedRow() {
    const storage = createFakeStorage();
    await seedCandidates(db, storage, userId, frontAndBack);
    await rescoreUser({ db, storage }, userId, { now: NOW });
    const [row] = await db.select().from(mergeSuggestions);
    return row;
  }

  it('refuses a set that changed since the question was put', async () => {
    const row = await seedRow();
    const [fromId, toId] = row.documentIds;
    const asked = { id: row.id, memberKey: `${row.memberKey},another` };
    expect(await recordVerdict(db, userId, asked, verdict(fromId, toId))).toBe(false);
  });

  it('refuses a step the suggestion no longer has, and another user’s row', async () => {
    const row = await seedRow();
    const [fromId, toId] = row.documentIds;
    const asked = { id: row.id, memberKey: row.memberKey };
    expect(await recordVerdict(db, userId, asked, verdict(toId, fromId))).toBe(false);
    const otherId = await createUser(db, 'other@example.com');
    expect(await recordVerdict(db, otherId, asked, verdict(fromId, toId))).toBe(false);

    expect(await recordVerdict(db, userId, asked, verdict(fromId, toId))).toBe(true);
    const [after] = await db.select().from(mergeSuggestions);
    expect(after.aiVerdicts).toHaveLength(1);
  });
});

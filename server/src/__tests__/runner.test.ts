import { documents, processingSteps } from '@cubicecho/engrafo-db/schema';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPipelineEvents, type PipelineEvents } from '../pipeline/events.ts';
import { createPipeline } from '../pipeline/runner.ts';
import { inspectStep } from '../pipeline/steps/inspect.ts';
import { textStep } from '../pipeline/steps/text.ts';
import type { PipelineConfig, PipelineStep } from '../pipeline/types.ts';
import { createFakeStorage, createTestDb, createUser, type FakeStorage, type TestDb } from './helpers.ts';

const CONFIG: PipelineConfig = { ocrAvailable: false, ocrLanguages: 'eng', concurrency: 1 };

describe('pipeline runner', () => {
  let db: TestDb;
  let userId: string;
  let storage: FakeStorage;
  let events: PipelineEvents;

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
    storage = createFakeStorage();
    events = createPipelineEvents();
  });

  async function insertDocument(values: Record<string, unknown> = {}) {
    const [doc] = await db
      .insert(documents)
      .values({
        userId,
        title: 'Note',
        originalFilename: 'note.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        originalKey: `originals/${userId}/note`,
        status: 'uploaded',
        ...values,
      })
      .returning();
    return doc;
  }

  const stepsOf = async (documentId: string) =>
    (await db
      .select()
      .from(processingSteps)
      .where(eq(processingSteps.documentId, documentId))
      .orderBy(asc(processingSteps.position))) as Array<{ step: string; status: string; attempts: number }>;

  const reload = async (id: string) => (await db.select().from(documents).where(eq(documents.id, id)))[0];

  it('runs every enabled step, skips the rest, and marks the document ready', async () => {
    const skipped: PipelineStep = { name: 'never', enabled: () => false, run: async () => ({ contentKey: 'nope' }) };
    const pipeline = createPipeline({ db, storage, events, steps: [inspectStep, textStep, skipped], config: CONFIG });
    storage.files.objects.set(`originals/${userId}/note`, { body: Buffer.from('hello'), contentType: 'text/plain' });
    const doc = await insertDocument();

    await pipeline.run(doc.id);

    const done = await reload(doc.id);
    expect(done.status).toBe('ready');
    expect(done.contentKey).toBe(`text/${userId}/${doc.id}.txt`);
    expect(storage.text.objects.get(done.contentKey)?.body.toString()).toBe('hello');
    expect(done.checksumSha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect((await stepsOf(doc.id)).map((step) => [step.step, step.status])).toEqual([
      ['inspect', 'succeeded'],
      ['text', 'succeeded'],
      ['never', 'skipped'],
    ]);
  });

  it('records a failure, and a retry resumes from the failed step without re-running earlier ones', async () => {
    let firstRuns = 0;
    let shouldFail = true;
    const first: PipelineStep = { name: 'first', enabled: () => true, run: async () => void firstRuns++ };
    const flaky: PipelineStep = {
      name: 'flaky',
      enabled: () => true,
      run: async () => {
        if (shouldFail) throw new Error('boom');
        return { contentKey: 'text/ok.txt' };
      },
    };
    const pipeline = createPipeline({ db, storage, events, steps: [first, flaky], config: CONFIG, log: () => {} });
    const doc = await insertDocument();

    await pipeline.run(doc.id);
    expect(await reload(doc.id)).toMatchObject({ status: 'failed', error: 'flaky: boom' });
    expect((await stepsOf(doc.id)).map((step) => step.status)).toEqual(['succeeded', 'failed']);

    shouldFail = false;
    await db.update(documents).set({ status: 'uploaded' }).where(eq(documents.id, doc.id));
    await pipeline.run(doc.id);

    expect(await reload(doc.id)).toMatchObject({ status: 'ready', error: null, contentKey: 'text/ok.txt' });
    expect(firstRuns).toBe(1);
    expect((await stepsOf(doc.id)).find((step) => step.step === 'flaky')?.attempts).toBe(2);
  });

  it('runs a document emitted twice only once', async () => {
    let runs = 0;
    const slow: PipelineStep = {
      name: 'slow',
      enabled: () => true,
      run: async () => {
        runs++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return undefined;
      },
    };
    const pipeline = createPipeline({ db, storage, events, steps: [slow], config: CONFIG });
    const doc = await insertDocument();

    events.emit('document.uploaded', { documentId: doc.id });
    events.emit('document.uploaded', { documentId: doc.id });
    await pipeline.idle();

    expect(runs).toBe(1);
    expect((await reload(doc.id)).status).toBe('ready');
  });

  it('leaves pending uploads alone', async () => {
    const pipeline = createPipeline({ db, storage, events, steps: [inspectStep], config: CONFIG });
    const doc = await insertDocument({ status: 'pending_upload' });
    await pipeline.run(doc.id);
    expect((await reload(doc.id)).status).toBe('pending_upload');
    expect(await stepsOf(doc.id)).toEqual([]);
  });

  it('fails a file whose bytes are not the type it claimed', async () => {
    const pipeline = createPipeline({ db, storage, events, steps: [inspectStep], config: CONFIG, log: () => {} });
    storage.files.objects.set(`originals/${userId}/note`, {
      body: Buffer.from('hello'),
      contentType: 'application/pdf',
    });
    const doc = await insertDocument({ mimeType: 'application/pdf' });
    await pipeline.run(doc.id);
    expect((await reload(doc.id)).status).toBe('failed');
  });

  it('resumes documents a previous process left unfinished', async () => {
    const pipeline = createPipeline({ db, storage, events, steps: [], config: CONFIG });
    const uploaded = await insertDocument();
    const processing = await insertDocument({ status: 'processing' });
    const ready = await insertDocument({ status: 'ready' });

    expect(await pipeline.resume()).toBe(2);
    await pipeline.idle();

    expect((await reload(uploaded.id)).status).toBe('ready');
    expect((await reload(processing.id)).status).toBe('ready');
    expect((await reload(ready.id)).status).toBe('ready');
  });
});

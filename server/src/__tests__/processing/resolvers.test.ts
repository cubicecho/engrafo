import { randomUUID } from 'node:crypto';
import { documents, processingSteps } from '@cubicecho/engrafo-db/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { createClient, createTestDb, createUser, type TestDb } from '../helpers.ts';

const PROCESSING = `
  query ($state: ProcessingState!) {
    processing {
      counts { running queued failed finished }
      entries(state: $state) { document { id title status } steps { step status progressDone progressTotal } finishedAt }
      finishedWithinHours
    }
  }
`;

const HOUR_MS = 3_600_000;

describe('processing', () => {
  let db: TestDb;
  let userId: string;

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, 'owner@example.com');
  });

  const client = (id: string | null = userId) => createClient(db, id);

  /** A document in a status, with its steps, the last of them ended `endedHoursAgo` ago. */
  async function insert(
    title: string,
    status: 'uploaded' | 'processing' | 'failed' | 'ready' | 'pending_upload',
    {
      owner = userId,
      endedHoursAgo = null as number | null,
      updatedAt = new Date(),
      deletedAt = null as Date | null,
    } = {},
  ) {
    const id = randomUUID();
    await db.insert(documents).values({
      id,
      userId: owner,
      title,
      originalFilename: `${title}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 5,
      originalKey: `originals/${owner}/${id}`,
      status,
      updatedAt,
      deletedAt,
    });
    const ended = endedHoursAgo === null ? null : new Date(Date.now() - endedHoursAgo * HOUR_MS);
    await db.insert(processingSteps).values([
      { userId: owner, documentId: id, step: 'inspect', position: 0, status: 'succeeded', finishedAt: ended },
      {
        userId: owner,
        documentId: id,
        step: 'vision',
        position: 1,
        status: status === 'processing' ? 'running' : status === 'failed' ? 'failed' : 'succeeded',
        progressDone: status === 'processing' ? 3 : null,
        progressTotal: status === 'processing' ? 12 : null,
        finishedAt: status === 'processing' ? null : ended,
      },
    ]);
    return id;
  }

  const read = async (state: string) => (await client().expectOk(PROCESSING, { state })).processing;

  it('counts each state, leaving out the trash, pending uploads, old finishes and other people', async () => {
    await insert('running', 'processing');
    await insert('waiting 1', 'uploaded');
    await insert('waiting 2', 'uploaded');
    await insert('broke', 'failed', { endedHoursAgo: 1 });
    await insert('done lately', 'ready', { endedHoursAgo: 2 });
    await insert('done long ago', 'ready', { endedHoursAgo: 48 });
    await insert('uploading', 'pending_upload');
    await insert('trashed', 'uploaded', { deletedAt: new Date() });
    await insert('theirs', 'processing', { owner: await createUser(db, 'other@example.com') });

    const processing = await read('RUNNING');
    expect(processing.counts).toEqual({ running: 1, queued: 2, failed: 1, finished: 1 });
    expect(processing.finishedWithinHours).toBe(24);
    expect(processing.entries).toHaveLength(1);
    expect(processing.entries[0]).toMatchObject({
      document: { title: 'running', status: 'processing' },
      steps: [
        { step: 'inspect', status: 'succeeded' },
        { step: 'vision', status: 'running', progressDone: 3, progressTotal: 12 },
      ],
    });
  });

  it('lists the queue oldest first, as the pipeline takes it', async () => {
    await insert('second', 'uploaded', { updatedAt: new Date(Date.now() - 1000) });
    await insert('first', 'uploaded', { updatedAt: new Date(Date.now() - 5000) });
    const { entries } = await read('QUEUED');
    expect(entries.map((entry: { document: { title: string } }) => entry.document.title)).toEqual(['first', 'second']);
  });

  it('lists what finished within the window newest first, with when it ended', async () => {
    await insert('earlier', 'ready', { endedHoursAgo: 5 });
    await insert('later', 'ready', { endedHoursAgo: 1 });
    await insert('too old', 'ready', { endedHoursAgo: 30 });
    const { entries } = await read('FINISHED');
    expect(entries.map((entry: { document: { title: string } }) => entry.document.title)).toEqual(['later', 'earlier']);
    const ended = new Date(entries[0].finishedAt).getTime();
    expect(Math.abs(Date.now() - HOUR_MS - ended)).toBeLessThan(60_000);
  });

  it('is UNAUTHENTICATED signed out', async () => {
    const error = await client(null).expectError(PROCESSING, { state: 'RUNNING' });
    expect(error.code).toBe(ErrorCode.Unauthenticated);
  });
});

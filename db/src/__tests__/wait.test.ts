import { describe, expect, it } from 'vitest';
import { type Queryable, waitForDatabase } from '../wait.ts';

/** Small enough that a test waits milliseconds, not the minute boot allows. */
const FAST = { connectTimeoutMs: 200, firstRetryDelayMs: 1, maxRetryDelayMs: 2 };

/** An error shaped like the one postgres-js throws while the socket is refused. */
function withCode(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * A database that fails a set number of times before it answers.
 *
 * @param failures - What each attempt throws, in order. Once they run out, it answers.
 * @returns The database and how many times it was asked.
 */
function flakyDatabase(failures: Error[]): { db: Queryable; attempts: () => number } {
  let attempts = 0;
  const db: Queryable = {
    execute: async () => {
      const failure = failures[attempts];
      attempts += 1;
      if (failure !== undefined) {
        throw failure;
      }
    },
  };
  return { db, attempts: () => attempts };
}

describe('waitForDatabase', () => {
  it('returns as soon as the database answers', async () => {
    const { db, attempts } = flakyDatabase([]);

    await waitForDatabase(db, FAST, () => {});

    expect(attempts()).toBe(1);
  });

  it('keeps asking while Postgres is still coming up', async () => {
    const { db, attempts } = flakyDatabase([withCode('ECONNREFUSED'), withCode('57P03')]);
    const logged: string[] = [];

    await waitForDatabase(db, FAST, (message) => logged.push(message));

    expect(attempts()).toBe(3);
    expect(logged).toHaveLength(2);
  });

  it('reads the code off the cause, where postgres-js puts the socket error', async () => {
    const wrapped = new Error('connect failed', { cause: withCode('ENOTFOUND') });
    const { db, attempts } = flakyDatabase([wrapped]);

    await waitForDatabase(db, FAST, () => {});

    expect(attempts()).toBe(2);
  });

  it('gives up at once on an error waiting cannot fix', async () => {
    const wrongPassword = withCode('28P01');
    const { db, attempts } = flakyDatabase([wrongPassword, wrongPassword]);

    await expect(waitForDatabase(db, FAST, () => {})).rejects.toBe(wrongPassword);
    expect(attempts()).toBe(1);
  });

  it('gives up once the time allowed has passed', async () => {
    const refused = withCode('ECONNREFUSED');
    const never: Queryable = {
      execute: async () => {
        throw refused;
      },
    };

    await expect(waitForDatabase(never, { ...FAST, connectTimeoutMs: 10 }, () => {})).rejects.toBe(refused);
  });
});

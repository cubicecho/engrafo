import { describe, expect, it } from 'vitest';
import { createLimiter } from '../../pipeline/limiter.ts';

/** Waits `depth` microtasks, then calls `then`: an arrival at a chosen moment. */
function afterMicrotasks(depth: number, then: () => void) {
  let chain = Promise.resolve();
  for (let i = 0; i < depth; i++) {
    chain = chain.then(() => undefined);
  }
  void chain.then(then);
}

describe('createLimiter', () => {
  it('runs everything, in the order it came, never more than the limit at once', async () => {
    const limit = createLimiter(2);
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const task = (n: number) => async () => {
      running += 1;
      most = Math.max(most, running);
      order.push(n);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return n;
    };
    await expect(Promise.all([1, 2, 3, 4, 5].map((n) => limit(task(n))))).resolves.toEqual([1, 2, 3, 4, 5]);
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(most).toBe(2);
  });

  it('lets nothing in while a finishing task hands its slot to the next one waiting', async () => {
    const limit = createLimiter(1);
    let running = 0;
    let most = 0;
    const late: Promise<void>[] = [];
    const task = async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
    };
    const first = limit(async () => {
      await task();
      // Arrivals at every moment of the hand-over to the task waiting behind this one.
      for (let depth = 0; depth < 8; depth++) {
        afterMicrotasks(depth, () => late.push(limit(task)));
      }
    });
    const second = limit(task);
    await Promise.all([first, second]);
    await Promise.all(late);
    expect(late).toHaveLength(8);
    expect(most).toBe(1);
  });

  it('frees the slot when a task fails', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});

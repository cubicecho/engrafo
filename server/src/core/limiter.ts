/** Runs a task once fewer than the limit are running, and resolves with its result. */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * A counting semaphore: at most `concurrency` tasks run at once, and the rest wait their turn in
 * the order they asked.
 *
 * @param concurrency - How many may run at once.
 * @returns The limiter, shared by every task it should bound.
 */
export function createLimiter(concurrency: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

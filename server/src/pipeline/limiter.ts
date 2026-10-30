/**
 * A counting semaphore: at most `concurrency` tasks run at once, and the rest wait their turn in
 * the order they came. OCR is CPU-bound, and without a limit a folder dropped on the upload form
 * forks one ocrmypdf per file at once.
 *
 * @param concurrency - How many tasks may run at once.
 * @returns A function that runs a task when a slot is free, resolving or rejecting as it does.
 *
 * @remarks
 * A finishing task hands its slot to the next one waiting rather than freeing it, so the count
 * never dips between the two. Freed and then taken, a task arriving in that moment would find a
 * slot and start too, one more than the limit, which the processing page then shows.
 */
export function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < concurrency) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        active -= 1;
      }
    }
  };
}

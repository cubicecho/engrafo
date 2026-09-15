import { afterEach, describe, expect, it } from 'vitest';
import { clientId } from './id';

const original = globalThis.crypto.randomUUID;

afterEach(() => {
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
});

/** What an insecure context looks like: `crypto` is there, `randomUUID` is not. */
function withoutRandomUUID() {
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
}

describe('clientId', () => {
  it('is unique per call', () => {
    const ids = new Set(Array.from({ length: 100 }, clientId));
    expect(ids.size).toBe(100);
  });

  it('still works where crypto.randomUUID does not exist', () => {
    withoutRandomUUID();

    // Over plain HTTP to a LAN address — how a self-hosted instance is reached —
    // this used to throw, and it threw inside the upload handler.
    const ids = new Set(Array.from({ length: 100 }, clientId));

    expect(ids.size).toBe(100);
    expect(ids.has('undefined')).toBe(false);
  });
});

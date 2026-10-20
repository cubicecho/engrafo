import { describe, expect, it } from 'vitest';
import { errorChainMessage } from '../../core/errors.ts';

describe('errorChainMessage', () => {
  it('reads down the causes, outermost first', () => {
    const postgres = new Error('extension "vector" is not available');
    const drizzle = new Error('Failed query: CREATE EXTENSION IF NOT EXISTS vector;', { cause: postgres });
    expect(errorChainMessage(drizzle)).toBe(
      'Failed query: CREATE EXTENSION IF NOT EXISTS vector;\nextension "vector" is not available',
    );
  });

  it('takes a thrown non-error, and stops at a cycle', () => {
    expect(errorChainMessage('plain')).toBe('plain');
    const loop = new Error('again');
    loop.cause = loop;
    expect(errorChainMessage(loop)).toBe('again');
  });
});

import { describe, expect, it } from 'vitest';
import { magicLinkSearch } from './magic-link';

const ORIGIN = 'http://nas.local:3004';

describe('magicLinkSearch', () => {
  it('takes the token from a link to another origin', () => {
    expect(magicLinkSearch('http://localhost:3004/auth/verify?token=abc', ORIGIN)).toBe('?token=abc');
  });

  it('reads a relative link', () => {
    expect(magicLinkSearch('/auth/verify?token=abc', ORIGIN)).toBe('?token=abc');
  });

  it('answers null for a link that is not a URL, where `new URL` would throw during render', () => {
    expect(magicLinkSearch('http://', ORIGIN)).toBeNull();
  });
});

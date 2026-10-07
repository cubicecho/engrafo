import { afterEach, describe, expect, it } from 'vitest';
import { clearToken, getToken, setToken } from './auth';

// This project runs without a DOM, so `window.localStorage` throws on every
// access — which is what a browser with site data blocked does too.

afterEach(() => {
  clearToken();
});

describe('the session token where storage is blocked', () => {
  it('has none to begin with', () => {
    expect(getToken()).toBeNull();
  });

  it('keeps a token it is given, rather than throwing in the middle of sign-in', () => {
    expect(() => setToken('abc')).not.toThrow();
    expect(getToken()).toBe('abc');
  });

  it('forgets it on sign-out', () => {
    setToken('abc');
    clearToken();
    expect(getToken()).toBeNull();
  });
});

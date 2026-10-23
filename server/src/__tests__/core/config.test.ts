import { afterEach, describe, expect, it, vi } from 'vitest';
import { envPositiveInteger, s3Config, watchConfig } from '../../core/config.ts';
import { STORAGE_DEFAULTS, WATCH_DEFAULTS } from '../../core/defaults.ts';

const FALLBACK = 7;

describe('envPositiveInteger', () => {
  it('reads a whole number', () => {
    expect(envPositiveInteger('3', FALLBACK)).toBe(3);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['zero', '0'],
    ['negative', '-2'],
    ['a fraction', '0.5'],
    ['a fraction above one', '1.5'],
    ['not a number', 'many'],
    ['infinite', 'Infinity'],
  ])('falls back when the value is %s', (_name, value) => {
    expect(envPositiveInteger(value, FALLBACK)).toBe(FALLBACK);
  });
});

describe('s3Config forcePathStyle', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to path-style', () => {
    vi.stubEnv('S3_FORCE_PATH_STYLE', undefined);
    expect(s3Config().forcePathStyle).toBe(STORAGE_DEFAULTS.forcePathStyle);
  });

  it('turns off with S3_FORCE_PATH_STYLE=false', () => {
    vi.stubEnv('S3_FORCE_PATH_STYLE', 'false');
    expect(s3Config().forcePathStyle).toBe(false);
  });

  it('ignores a value that is neither yes nor no', () => {
    vi.stubEnv('S3_FORCE_PATH_STYLE', 'maybe');
    expect(s3Config().forcePathStyle).toBe(STORAGE_DEFAULTS.forcePathStyle);
  });
});

describe('watchConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off without WATCH_DIR', () => {
    vi.stubEnv('WATCH_DIR', '');
    vi.stubEnv('WATCH_OWNER', 'me@example.com');
    expect(watchConfig()).toBeNull();
  });

  it('reads the directory, the owner in lower case, and the intervals in milliseconds', () => {
    vi.stubEnv('WATCH_DIR', '/consume');
    vi.stubEnv('WATCH_OWNER', ' Me@Example.com ');
    vi.stubEnv('WATCH_POLL_SECONDS', '2');
    vi.stubEnv('WATCH_STABLE_SECONDS', undefined);
    expect(watchConfig()).toEqual({
      dir: '/consume',
      owner: 'me@example.com',
      pollMs: 2000,
      stableMs: WATCH_DEFAULTS.stableSeconds * 1000,
    });
  });

  it('leaves the owner null when WATCH_OWNER is unset, for the watcher to refuse', () => {
    vi.stubEnv('WATCH_DIR', '/consume');
    vi.stubEnv('WATCH_OWNER', undefined);
    expect(watchConfig()?.owner).toBeNull();
  });
});

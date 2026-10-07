import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEV_SECRET, PLACEHOLDER_SECRET } from '../../core/config.ts';
import { TEST_SECRET } from '../helpers.ts';

// Preflight exits the process, so each case runs it in a process of its own.

const PREFLIGHT = fileURLToPath(new URL('../../core/preflight.ts', import.meta.url));

/** Everything preflight asks for, valid. */
const VALID_ENV = {
  DATABASE_URL: 'postgres://engrafo:engrafo@localhost:5432/engrafo',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'engrafo',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET: TEST_SECRET,
};

/**
 * Runs preflight alone under an environment.
 *
 * @param overrides - Variables that differ from `VALID_ENV`. An empty string unsets one.
 * @returns The exit status and what was printed to stderr.
 */
function runPreflight(overrides: Record<string, string> = {}): { status: number | null; stderr: string } {
  const env = { PATH: process.env.PATH ?? '', ...VALID_ENV, ...overrides };
  const { status, stderr } = spawnSync(process.execPath, [PREFLIGHT], { env, encoding: 'utf8' });
  return { status, stderr };
}

describe('preflight', () => {
  it('passes a complete production environment', () => {
    expect(runPreflight()).toEqual({ status: 0, stderr: '' });
  });

  it.each([['DATABASE_URL'], ['S3_ENDPOINT'], ['S3_BUCKET'], ['S3_ACCESS_KEY_ID'], ['S3_SECRET_ACCESS_KEY']])(
    'refuses to start without %s',
    (name) => {
      const { status, stderr } = runPreflight({ [name]: '' });
      expect(status).toBe(1);
      expect(stderr).toContain(`${name} is required`);
    },
  );

  it.each([
    ['an unset secret', ''],
    ['a short secret', 'too-short'],
    ['the development secret', DEV_SECRET],
    ['the .env.example placeholder', PLACEHOLDER_SECRET],
  ])('refuses %s in production', (_label, secret) => {
    const { status, stderr } = runPreflight({ BETTER_AUTH_SECRET: secret });
    expect(status).toBe(1);
    expect(stderr).toContain('BETTER_AUTH_SECRET must be a random value');
  });

  it('says JWT_SECRET was renamed when it is still set', () => {
    const { stderr } = runPreflight({ BETTER_AUTH_SECRET: '', JWT_SECRET: TEST_SECRET });
    expect(stderr).toContain('JWT_SECRET is no longer read');
  });

  it('accepts any secret outside production', () => {
    expect(runPreflight({ NODE_ENV: 'development', BETTER_AUTH_SECRET: '' }).status).toBe(0);
  });
});

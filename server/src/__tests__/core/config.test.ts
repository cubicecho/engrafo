import { describe, expect, it } from 'vitest';
import { envPositiveInteger } from '../../core/config.ts';

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

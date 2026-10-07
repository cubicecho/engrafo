import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../auth/rate-limit.ts';
import { RATE_LIMIT_DEFAULTS } from '../../core/defaults.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../../core/wire.ts';

describe('createRateLimiter', () => {
  it('lets a key through again once its window has passed', () => {
    let clock = 0;
    const limiter = createRateLimiter({ maxAttempts: 1, windowMinutes: 1 }, () => clock);
    limiter.hit('k');
    const refused = { code: 'TOO_MANY_REQUESTS', retryAfter: SECONDS_PER_MINUTE };
    expect(() => limiter.hit('k')).toThrow(expect.objectContaining({ extensions: refused }));

    clock = SECONDS_PER_MINUTE * MS_PER_SECOND + 1;

    expect(() => limiter.hit('k')).not.toThrow();
  });

  it('records nothing against the other keys when one is full', () => {
    const limiter = createRateLimiter({ maxAttempts: 1 }, () => 0);
    limiter.hit('full');

    expect(() => limiter.hit('full', 'fresh')).toThrow();

    expect(() => limiter.hit('fresh')).not.toThrow();
  });

  it('keeps the default for a setting the overrides leave out', () => {
    const limiter = createRateLimiter({ windowMinutes: 1 }, () => 0);
    for (let attempt = 0; attempt < RATE_LIMIT_DEFAULTS.maxAttempts; attempt += 1) {
      limiter.hit('k');
    }

    expect(() => limiter.hit('k')).toThrow();
  });
});

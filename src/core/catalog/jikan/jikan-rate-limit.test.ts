import { describe, expect, it, jest } from '@jest/globals';

import { FIXED_NOW } from '../../../../test/core/fixed-clock';
import { createRateLimiter } from '../http/rate-limiter';
import { JIKAN_RATE_LIMIT } from './jikan-rate-limit';

// documented jikan v4 limit per second
const PER_SECOND_LIMIT = 3;
const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
// the policy's own bound for a minute, below the documented 60 per minute
const PER_MINUTE_BOUND = 50;
const SUSTAINED_PER_MINUTE = 40;
const REQUESTS = 150;

// a small seeded linear congruential generator: the same arrivals on every run
const createLcg = (seed: number) => {
  let state = seed;
  return (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
};

// arrival offsets: bursts of simultaneous requests mixed with gaps of up to 2 s
const randomArrivals = (seed: number): number[] => {
  const random = createLcg(seed);
  let at = 0;
  return Array.from({ length: REQUESTS }, () => {
    at += random() < 0.3 ? 0 : Math.floor(random() * 2_000);
    return at;
  });
};

// grant times, in ms from the start, of one acquire per arrival offset
const grantTimes = async (arrivals: readonly number[]): Promise<number[]> => {
  const limiter = createRateLimiter(JIKAN_RATE_LIMIT);
  const grants: number[] = [];
  for (const arrival of arrivals) {
    setTimeout(() => {
      void limiter.acquire().then(() => {
        grants.push(Date.now() - FIXED_NOW);
      });
    }, arrival);
  }
  await jest.runAllTimersAsync();
  return grants;
};

// the most grants in any closed window [t, t + windowMs], as the documented bounds count; a
// fullest window starts on a grant
const maxInWindow = (grants: readonly number[], windowMs: number): number =>
  Math.max(
    ...grants.map((start) => grants.filter((at) => at >= start && at <= start + windowMs).length),
  );

describe('JIKAN_RATE_LIMIT', () => {
  it.each([1, 42, 2026])(
    'stays within 3 per second and 50 per minute under random arrivals (seed %p)',
    async (seed) => {
      const grants = await grantTimes(randomArrivals(seed));

      expect(grants).toHaveLength(REQUESTS);
      expect(maxInWindow(grants, SECOND_MS)).toBeLessThanOrEqual(PER_SECOND_LIMIT);
      expect(maxInWindow(grants, MINUTE_MS)).toBeLessThanOrEqual(PER_MINUTE_BOUND);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('stays within its bounds under a backlog, then sustains 40 per minute', async () => {
    const grants = await grantTimes(Array.from({ length: REQUESTS }, () => 0));
    const last = grants.at(-1) ?? 0;

    expect(grants).toHaveLength(REQUESTS);
    expect(maxInWindow(grants, SECOND_MS)).toBe(PER_SECOND_LIMIT);
    // a full backlog reaches the bound exactly: capacity 10 + floor(60 s / 1.5 s) = 50
    expect(maxInWindow(grants, MINUTE_MS)).toBe(PER_MINUTE_BOUND);
    // the last minute of the backlog: one grant every 1.5 s
    expect(grants.filter((at) => at > last - MINUTE_MS)).toHaveLength(SUSTAINED_PER_MINUTE);
  });
});

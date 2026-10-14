import { describe, expect, it, jest } from '@jest/globals';

import { FIXED_NOW } from '../../../../test/core/fixed-clock';
import { createRateLimiter, type RateLimitPolicy } from '../http/rate-limiter';
import { SELF_HOSTED_JIKAN_RATE_LIMIT, TENRAI_RATE_LIMIT } from './jikan-rate-limit';

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const REQUESTS = 150;

interface PolicyCase {
  readonly name: string;
  readonly policy: RateLimitPolicy;
  // the documented limits of the instance
  readonly perSecondLimit: number;
  readonly perMinuteLimit: number;
  // the policy's own bounds, below the documented limits
  readonly perSecondBound: number;
  readonly perMinuteBound: number;
  readonly sustainedPerMinute: number;
}

const POLICIES: readonly PolicyCase[] = [
  {
    // documented: 4 per second and 120 per minute per ip
    name: 'TENRAI_RATE_LIMIT',
    policy: TENRAI_RATE_LIMIT,
    perSecondLimit: 4,
    perMinuteLimit: 120,
    perSecondBound: 3,
    // capacity 2 + 60 s / 750 ms
    perMinuteBound: 82,
    sustainedPerMinute: 80,
  },
  {
    // the public jikan's documented 3 per second and 60 per minute
    name: 'SELF_HOSTED_JIKAN_RATE_LIMIT',
    policy: SELF_HOSTED_JIKAN_RATE_LIMIT,
    perSecondLimit: 3,
    perMinuteLimit: 60,
    perSecondBound: 3,
    // capacity 10 + 60 s / 1.5 s
    perMinuteBound: 50,
    sustainedPerMinute: 40,
  },
];

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
const grantTimes = async (
  policy: RateLimitPolicy,
  arrivals: readonly number[],
): Promise<number[]> => {
  const limiter = createRateLimiter(policy);
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

describe.each(POLICIES)('$name', (policyCase) => {
  const { policy, perSecondBound, perMinuteBound, sustainedPerMinute } = policyCase;

  it('keeps its bounds under the documented limits', () => {
    expect(perSecondBound).toBeLessThanOrEqual(policyCase.perSecondLimit);
    expect(perMinuteBound).toBeLessThan(policyCase.perMinuteLimit);
  });

  it.each([1, 42, 2026])(
    'stays within its per second and per minute bounds under random arrivals (seed %p)',
    async (seed) => {
      const grants = await grantTimes(policy, randomArrivals(seed));

      expect(grants).toHaveLength(REQUESTS);
      expect(maxInWindow(grants, SECOND_MS)).toBeLessThanOrEqual(perSecondBound);
      expect(maxInWindow(grants, MINUTE_MS)).toBeLessThanOrEqual(perMinuteBound);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('reaches its bounds exactly under a backlog, then sustains its rate per minute', async () => {
    const grants = await grantTimes(
      policy,
      Array.from({ length: REQUESTS }, () => 0),
    );
    const last = grants.at(-1) ?? 0;

    expect(grants).toHaveLength(REQUESTS);
    expect(maxInWindow(grants, SECOND_MS)).toBe(perSecondBound);
    expect(maxInWindow(grants, MINUTE_MS)).toBe(perMinuteBound);
    // the last minute of the backlog: one grant every refill interval of the slowest bucket
    expect(grants.filter((at) => at > last - MINUTE_MS)).toHaveLength(sustainedPerMinute);
  });
});

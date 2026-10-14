import { describe, expect, it, jest } from '@jest/globals';

import { FIXED_NOW } from '../../../../test/core/fixed-clock';
import { MAX_PAUSE_MS, createRateLimiter, type RateLimitPolicy } from './rate-limiter';

// the limiter against jumps of the wall clock, backwards and forwards: its buckets and its pause
// neither stall nor speed up

const INTERVAL_MS = 1_000;
// one request, then one more per second
const ONE_PER_SECOND: RateLimitPolicy = {
  buckets: [{ capacity: 1, refillIntervalMs: INTERVAL_MS }],
};
// never limits within a test: isolates the pause
const UNLIMITED: RateLimitPolicy = { buckets: [{ capacity: 1_000, refillIntervalMs: 1 }] };
const ONE_HOUR_MS = 3_600_000;
// the jump the wall clock would need to release the 10-token burst of TWO_BUCKETS
const FORWARD_JUMP_MS = 15_000;
const PER_SECOND_INTERVAL_MS = 750;
// a per-second and a per-minute bucket, the shape of the jikan policy
const TWO_BUCKETS: RateLimitPolicy = {
  buckets: [
    { capacity: 2, refillIntervalMs: PER_SECOND_INTERVAL_MS },
    { capacity: 10, refillIntervalMs: 1_500 },
  ],
};

// the default clock is monotonic: jest.setSystemTime moves Date.now, never the fake performance.now
describe('a wall clock change', () => {
  it('does not stall the buckets when it jumps backwards', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    await limiter.acquire();
    jest.setSystemTime(FIXED_NOW - ONE_HOUR_MS);
    const granted = jest.fn();

    void limiter.acquire().then(granted);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(granted).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not stall a pause when it jumps backwards', async () => {
    const limiter = createRateLimiter(UNLIMITED);
    limiter.pauseFor(MAX_PAUSE_MS);
    jest.setSystemTime(FIXED_NOW - ONE_HOUR_MS);
    const granted = jest.fn();

    void limiter.acquire().then(granted);
    await jest.advanceTimersByTimeAsync(MAX_PAUSE_MS);

    expect(granted).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('grants no extra token after a burst when it jumps forwards', async () => {
    const limiter = createRateLimiter(TWO_BUCKETS);
    await Promise.all([limiter.acquire(), limiter.acquire()]);
    // a wall clock reading would see both buckets refilled: the next request would go at once
    jest.setSystemTime(FIXED_NOW + FORWARD_JUMP_MS);
    const granted = jest.fn();

    void limiter.acquire().then(granted);
    await jest.advanceTimersByTimeAsync(PER_SECOND_INTERVAL_MS - 1);
    expect(granted).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(granted).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not shorten a running pause when it jumps forwards', async () => {
    const limiter = createRateLimiter(UNLIMITED);
    limiter.pauseFor(MAX_PAUSE_MS);
    jest.setSystemTime(FIXED_NOW + FORWARD_JUMP_MS);
    const granted = jest.fn();

    void limiter.acquire().then(granted);
    await jest.advanceTimersByTimeAsync(MAX_PAUSE_MS - 1);
    expect(granted).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(granted).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

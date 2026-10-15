import { describe, expect, it, jest } from '@jest/globals';

import { CatalogAbortedError } from '../../errors/catalog-errors';
import { elapsed } from '../../../../test/core/catalog-http-test-support';
import {
  MAX_PAUSE_MS,
  createRateLimiter,
  type RateLimitPolicy,
  type RateLimiter,
} from './rate-limiter';

const INTERVAL_MS = 1_000;
// one request, then one more per second
const ONE_PER_SECOND: RateLimitPolicy = {
  buckets: [{ capacity: 1, refillIntervalMs: INTERVAL_MS }],
};
// never limits within a test: isolates the pause
const UNLIMITED: RateLimitPolicy = { buckets: [{ capacity: 1_000, refillIntervalMs: 1 }] };
const PER_SECOND_INTERVAL_MS = 750;
// a per-second and a per-minute bucket, the shape of the jikan policy
const TWO_BUCKETS: RateLimitPolicy = {
  buckets: [
    { capacity: 2, refillIntervalMs: PER_SECOND_INTERVAL_MS },
    { capacity: 10, refillIntervalMs: 1_500 },
  ],
};

// acquires one token per label at once and records when each one is granted, in grant order
const acquireAll = (limiter: RateLimiter, labels: readonly string[]) => {
  const grants: { label: string; at: number }[] = [];
  const done = Promise.all(
    labels.map((label) =>
      limiter.acquire().then(() => {
        grants.push({ label, at: elapsed() });
      }),
    ),
  );
  return { grants, done };
};

const labelsOf = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `#${String(index)}`);

describe('createRateLimiter', () => {
  it('grants a burst, then one request per interval of the tightest bucket', async () => {
    const { grants, done } = acquireAll(createRateLimiter(TWO_BUCKETS), labelsOf(6));

    await jest.advanceTimersByTimeAsync(3_000);
    await done;

    expect(grants.map(({ at }) => at)).toStrictEqual([0, 0, 750, 1_500, 2_250, 3_000]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('spaces grants by the slower bucket once its burst is used up', async () => {
    const { grants, done } = acquireAll(createRateLimiter(TWO_BUCKETS), labelsOf(21));

    await jest.advanceTimersByTimeAsync(16_500);
    await done;

    const times = grants.map(({ at }) => at);
    // 18 grants 750 ms apart use up the minute bucket's burst of 10 plus its refill
    expect(times.slice(15)).toStrictEqual([10_500, 11_250, 12_000, 13_500, 15_000, 16_500]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('grants in arrival order', async () => {
    const { grants, done } = acquireAll(createRateLimiter(ONE_PER_SECOND), ['a', 'b', 'c']);

    await jest.advanceTimersByTimeAsync(2 * INTERVAL_MS);
    await done;

    expect(grants).toStrictEqual([
      { label: 'a', at: 0 },
      { label: 'b', at: INTERVAL_MS },
      { label: 'c', at: 2 * INTERVAL_MS },
    ]);
  });

  it('drops a waiter aborted in the queue without taking its token', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const controller = new AbortController();
    await limiter.acquire();
    const aborted = limiter.acquire(controller.signal);
    const { grants, done } = acquireAll(limiter, ['next']);

    await jest.advanceTimersByTimeAsync(INTERVAL_MS / 2);
    controller.abort();

    await expect(aborted).rejects.toBeInstanceOf(CatalogAbortedError);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS / 2);
    await done;
    // granted at the time the aborted waiter would have had
    expect(grants).toStrictEqual([{ label: 'next', at: INTERVAL_MS }]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the others in arrival order when a waiter in the middle of the queue aborts', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const controller = new AbortController();
    const grants: { label: string; at: number }[] = [];
    const record = (label: string) => (): void => {
      grants.push({ label, at: elapsed() });
    };
    await limiter.acquire();
    void limiter.acquire().then(record('head'));
    const middle = limiter.acquire(controller.signal).then(record('middle'));
    void limiter.acquire().then(record('tail'));

    await jest.advanceTimersByTimeAsync(INTERVAL_MS / 2);
    controller.abort();

    await expect(middle).rejects.toBeInstanceOf(CatalogAbortedError);
    await jest.advanceTimersByTimeAsync(2 * INTERVAL_MS - INTERVAL_MS / 2);
    // the head keeps its turn, and the tail takes the token the aborted waiter would have had
    expect(grants).toStrictEqual([
      { label: 'head', at: INTERVAL_MS },
      { label: 'tail', at: 2 * INTERVAL_MS },
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects an already aborted signal without queueing or taking a token', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const controller = new AbortController();
    controller.abort();

    await expect(limiter.acquire(controller.signal)).rejects.toBeInstanceOf(CatalogAbortedError);
    await limiter.acquire();

    expect(elapsed()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears its timer when the only waiter leaves', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const controller = new AbortController();
    await limiter.acquire();
    const aborted = limiter.acquire(controller.signal);
    expect(jest.getTimerCount()).toBe(1);

    controller.abort();

    await expect(aborted).rejects.toBeInstanceOf(CatalogAbortedError);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('holds no timer when idle', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    expect(jest.getTimerCount()).toBe(0);

    await limiter.acquire();
    limiter.pauseFor(INTERVAL_MS);

    expect(jest.getTimerCount()).toBe(0);
  });

  it('reads the injected clock, not the global one', async () => {
    let now = 0;
    const limiter = createRateLimiter(ONE_PER_SECOND, { now: () => now });
    await limiter.acquire();
    const granted = jest.fn();
    void limiter.acquire().then(granted);

    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    // the timer fired, but the injected clock has not moved: the waiter is rescheduled
    expect(granted).not.toHaveBeenCalled();

    now = INTERVAL_MS;
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(granted).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('pauseFor', () => {
  it('delays every waiter until the pause ends', async () => {
    const limiter = createRateLimiter(UNLIMITED);
    limiter.pauseFor(2_000);
    const { grants, done } = acquireAll(limiter, ['a', 'b']);

    await jest.advanceTimersByTimeAsync(2_000);
    await done;

    expect(grants).toStrictEqual([
      { label: 'a', at: 2_000 },
      { label: 'b', at: 2_000 },
    ]);
  });

  it('reschedules a waiter already queued', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    await limiter.acquire();
    const { grants, done } = acquireAll(limiter, ['queued']);

    limiter.pauseFor(5_000);
    await jest.advanceTimersByTimeAsync(5_000);
    await done;

    expect(grants).toStrictEqual([{ label: 'queued', at: 5_000 }]);
  });

  it('never shortens a running pause', async () => {
    const limiter = createRateLimiter(UNLIMITED);
    limiter.pauseFor(3_000);
    limiter.pauseFor(1_000);
    const { grants, done } = acquireAll(limiter, ['a']);

    await jest.advanceTimersByTimeAsync(3_000);
    await done;

    expect(grants).toStrictEqual([{ label: 'a', at: 3_000 }]);
  });

  it('caps a pause at MAX_PAUSE_MS', async () => {
    const limiter = createRateLimiter(UNLIMITED);
    limiter.pauseFor(10 * MAX_PAUSE_MS);
    const { grants, done } = acquireAll(limiter, ['a']);

    await jest.advanceTimersByTimeAsync(MAX_PAUSE_MS);
    await done;

    expect(grants).toStrictEqual([{ label: 'a', at: MAX_PAUSE_MS }]);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects a pause of %p ms', (ms) => {
    expect(() => {
      createRateLimiter(UNLIMITED).pauseFor(ms);
    }).toThrow(RangeError);
  });
});

describe('policy validation', () => {
  it.each([
    ['no bucket', []],
    ['a zero capacity', [{ capacity: 0, refillIntervalMs: INTERVAL_MS }]],
    ['a fractional capacity', [{ capacity: 1.5, refillIntervalMs: INTERVAL_MS }]],
    ['a negative interval', [{ capacity: 1, refillIntervalMs: -INTERVAL_MS }]],
    ['an infinite interval', [{ capacity: 1, refillIntervalMs: Number.POSITIVE_INFINITY }]],
  ])('rejects %s', (_, buckets) => {
    expect(() => createRateLimiter({ buckets })).toThrow(RangeError);
  });
});

import { describe, expect, it, jest } from '@jest/globals';

import { CatalogAbortedError } from '../../errors/catalog-errors';
import { elapsed } from '../../../../test/core/catalog-http-test-support';
import { createRateLimiter, type RateLimitPolicy } from './rate-limiter';

// the background queue of the limiter (C-06): behind every foreground waiter, with a token kept for
// the foreground in every bucket, promotable, and held by pauses like the foreground queue

const INTERVAL_MS = 1_000;
// one request, then one more per second: no reserve is possible
const ONE_PER_SECOND: RateLimitPolicy = {
  buckets: [{ capacity: 1, refillIntervalMs: INTERVAL_MS }],
};
const BURST_INTERVAL_MS = 750;
// the shape of the tenrai policy: 2 at once, then one every 750 ms
const BURST_OF_TWO: RateLimitPolicy = {
  buckets: [{ capacity: 2, refillIntervalMs: BURST_INTERVAL_MS }],
};
// a loose bucket and a tight one: the tight one decides the reserve
const LOOSE_AND_TIGHT: RateLimitPolicy = {
  buckets: [
    { capacity: 5, refillIntervalMs: 100 },
    { capacity: 2, refillIntervalMs: INTERVAL_MS },
  ],
};
const UNLIMITED: RateLimitPolicy = { buckets: [{ capacity: 1_000, refillIntervalMs: 1 }] };
const LONG_AFTER_MS = 10_000;

// records when each labelled grant happens, in grant order
const createRecorder = () => {
  const grants: { label: string; at: number }[] = [];
  const record =
    (label: string) =>
    (granted: Promise<void>): void => {
      void granted.then(() => {
        grants.push({ label, at: elapsed() });
      });
    };
  return { grants, record };
};

describe('acquireBackground', () => {
  it('serves a foreground waiter before an earlier queued background one', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const { grants, record } = createRecorder();
    await limiter.acquire();

    record('background')(limiter.acquireBackground().granted);
    record('foreground')(limiter.acquire());
    // one timer for the head that drains next
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(grants).toStrictEqual([
      { label: 'foreground', at: INTERVAL_MS },
      { label: 'background', at: 2 * INTERVAL_MS },
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits for the reserve token, which a foreground request then takes at once', async () => {
    const limiter = createRateLimiter(BURST_OF_TWO);
    const { grants, record } = createRecorder();
    await limiter.acquire();

    // a foreground request would be granted now; a background one waits for a full bucket
    record('background')(limiter.acquireBackground().granted);
    await jest.advanceTimersByTimeAsync(BURST_INTERVAL_MS);
    record('foreground')(limiter.acquire());
    await jest.advanceTimersByTimeAsync(0);

    expect(grants).toStrictEqual([
      { label: 'background', at: BURST_INTERVAL_MS },
      { label: 'foreground', at: BURST_INTERVAL_MS },
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('grants at once from an idle limiter', async () => {
    const limiter = createRateLimiter(BURST_OF_TWO);

    await limiter.acquireBackground().granted;

    expect(elapsed()).toBe(0);
  });

  it('keeps a token in every bucket', async () => {
    const limiter = createRateLimiter(LOOSE_AND_TIGHT);
    const { grants, record } = createRecorder();
    await limiter.acquire();

    record('background')(limiter.acquireBackground().granted);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    // the loose bucket has tokens to spare, the tight one only its last
    expect(grants).toStrictEqual([{ label: 'background', at: INTERVAL_MS }]);
  });

  it('keeps no reserve in a bucket of capacity 1', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const { grants, record } = createRecorder();

    record('first')(limiter.acquireBackground().granted);
    record('second')(limiter.acquireBackground().granted);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    // the times a foreground request would get
    expect(grants).toStrictEqual([
      { label: 'first', at: 0 },
      { label: 'second', at: INTERVAL_MS },
    ]);
  });
});

describe('promote', () => {
  it('moves a queued background waiter to the tail of the foreground queue', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const { grants, record } = createRecorder();
    await limiter.acquire();

    record('foreground-1')(limiter.acquire());
    const background = limiter.acquireBackground();
    record('background')(background.granted);
    background.promote();
    record('foreground-2')(limiter.acquire());
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(grants).toStrictEqual([
      { label: 'foreground-1', at: INTERVAL_MS },
      { label: 'background', at: 2 * INTERVAL_MS },
      { label: 'foreground-2', at: 3 * INTERVAL_MS },
    ]);
  });

  it('drops the reserve wait of the promoted waiter', async () => {
    const limiter = createRateLimiter(BURST_OF_TWO);
    await limiter.acquire();
    const background = limiter.acquireBackground();

    background.promote();
    await background.granted;

    expect(elapsed()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does nothing once the waiter was granted', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const background = limiter.acquireBackground();
    await background.granted;

    background.promote();

    // no second waiter was queued: nothing waits, and the next token comes on time
    expect(jest.getTimerCount()).toBe(0);
    const { grants, record } = createRecorder();
    record('next')(limiter.acquire());
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(grants).toStrictEqual([{ label: 'next', at: INTERVAL_MS }]);
  });

  it('does nothing once the waiter aborted', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const controller = new AbortController();
    await limiter.acquire();
    const background = limiter.acquireBackground(controller.signal);
    controller.abort();

    background.promote();

    await expect(background.granted).rejects.toBeInstanceOf(CatalogAbortedError);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('a background abort', () => {
  it('leaves the queue without a token and keeps the single timer', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const { grants, record } = createRecorder();
    const controller = new AbortController();
    await limiter.acquire();
    const background = limiter.acquireBackground(controller.signal);
    record('foreground')(limiter.acquire());
    expect(jest.getTimerCount()).toBe(1);

    controller.abort();

    await expect(background.granted).rejects.toBeInstanceOf(CatalogAbortedError);
    expect(jest.getTimerCount()).toBe(1);
    record('later')(limiter.acquire());
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);
    // the aborted waiter took nothing: the later waiter has the second token
    expect(grants).toStrictEqual([
      { label: 'foreground', at: INTERVAL_MS },
      { label: 'later', at: 2 * INTERVAL_MS },
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the timer when the only waiter is an aborted background one', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const controller = new AbortController();
    await limiter.acquire();
    const background = limiter.acquireBackground(controller.signal);
    expect(jest.getTimerCount()).toBe(1);

    controller.abort();

    await expect(background.granted).rejects.toBeInstanceOf(CatalogAbortedError);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects an already aborted signal, even awaited later, without queueing', async () => {
    const limiter = createRateLimiter(ONE_PER_SECOND);
    const controller = new AbortController();
    controller.abort();

    const background = limiter.acquireBackground(controller.signal);
    // the handle is held across timers before its promise is awaited: no unhandled rejection
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    background.promote();

    await expect(background.granted).rejects.toBeInstanceOf(CatalogAbortedError);
    await limiter.acquire();
    expect(elapsed()).toBe(INTERVAL_MS);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('pauseFor', () => {
  it('holds the background queue too', async () => {
    const limiter = createRateLimiter(UNLIMITED);
    const { grants, record } = createRecorder();
    limiter.pauseFor(2_000);

    record('background')(limiter.acquireBackground().granted);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(grants).toStrictEqual([{ label: 'background', at: 2_000 }]);
  });
});

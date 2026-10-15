// shared token bucket rate limiter of the catalog providers (docs/ARCHITECTURE.md §6, ADR-0005).
// it reads a monotonic clock: a wall clock change (ntp step, manual change) never moves its state
import { CatalogAbortedError } from '../../errors/catalog-errors';
import { onAbort } from './abortable';

/** `capacity` requests at once, then one more every `refillIntervalMs`. */
export interface RateLimitBucket {
  readonly capacity: number;
  readonly refillIntervalMs: number;
}

/** a request is granted only when every bucket allows it. */
export interface RateLimitPolicy {
  readonly buckets: readonly RateLimitBucket[];
}

/** a queued background request: its token, and the way to make it foreground. */
export interface BackgroundAcquire {
  /** resolves when the caller may send one request; rejects with `CatalogAbortedError` on abort. */
  readonly granted: Promise<void>;
  /** moves the still queued waiter to the tail of the foreground queue; a no-op once it left. */
  promote(): void;
}

export interface RateLimiter {
  /** resolves when the caller may send one request; rejects with `CatalogAbortedError` on abort. */
  acquire(signal?: AbortSignal): Promise<void>;
  /**
   * a token for a prefetch: granted only when no foreground waiter is queued, no pause runs and
   * every bucket keeps one token after the grant (a bucket of capacity 1 keeps none), so it never
   * delays a foreground request.
   */
  acquireBackground(signal?: AbortSignal): BackgroundAcquire;
  /** holds every waiter of both queues for `ms` (a 429 pauses everyone); never shortens a pause. */
  pauseFor(ms: number): void;
}

export interface RateLimiterOptions {
  /**
   * monotonic clock in ms: it must never decrease. default `performance.now()`, read on each call
   * so fake timers apply. never the wall clock: a wall clock change would refill the buckets or
   * shorten a pause (forward), or stall the queue (backward).
   */
  readonly now?: () => number;
}

/** upper bound of a pause, so a huge Retry-After never blocks the queue for long. */
export const MAX_PAUSE_MS = 60_000;

// tokens a bucket keeps for the foreground after a background grant, when its capacity allows it
const BACKGROUND_RESERVE_TOKENS = 1;

// the integer virtual-scheduling form of the token bucket (gcra): `tat` is the theoretical arrival
// time of the next request. a request at t is allowed when t >= tat - (capacity - 1) * interval, so
// at most capacity + floor(w / interval) are granted in any window of length w. a background
// request keeps the reserve: t >= tat - max(capacity - 1 - reserve, 0) * interval
interface BucketState {
  readonly capacity: number;
  readonly intervalMs: number;
  tat: number;
}

interface Waiter {
  readonly granted: Promise<void>;
  // detaches the abort listener, then resolves `granted`
  readonly grant: () => void;
}

type Lane = 'foreground' | 'background';

const isPositiveSafeInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const validatePolicy = ({ buckets }: RateLimitPolicy): void => {
  if (buckets.length === 0) {
    throw new RangeError('A rate limit policy needs at least one bucket');
  }
  for (const { capacity, refillIntervalMs } of buckets) {
    if (!isPositiveSafeInteger(capacity) || !isPositiveSafeInteger(refillIntervalMs)) {
      throw new RangeError('Bucket capacity and refill interval must be positive safe integers');
    }
  }
};

// removes `waiter` from `queue` in place; whether it was there
const removeFrom = (queue: Waiter[], waiter: Waiter): boolean => {
  const index = queue.indexOf(waiter);
  if (index === -1) {
    return false;
  }
  queue.splice(index, 1);
  return true;
};

// how many intervals before `tat` a bucket allows a request of the lane
const allowanceOf = (capacity: number, lane: Lane): number =>
  lane === 'foreground' ? capacity - 1 : Math.max(capacity - 1 - BACKGROUND_RESERVE_TOKENS, 0);

const noop = (): void => undefined;

export const createRateLimiter = (
  policy: RateLimitPolicy,
  options: RateLimiterOptions = {},
): RateLimiter => {
  validatePolicy(policy);
  const now = options.now ?? (() => performance.now());
  const buckets: BucketState[] = policy.buckets.map(({ capacity, refillIntervalMs }) => ({
    capacity,
    intervalMs: refillIntervalMs,
    tat: Number.NEGATIVE_INFINITY,
  }));
  // two fifo queues: a new caller never overtakes a queued one of its lane, and the foreground head
  // always goes first
  const foreground: Waiter[] = [];
  const background: Waiter[] = [];
  let pausedUntil = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // the earliest time every bucket and the pause allow the next grant of the lane
  const readyAt = (lane: Lane): number =>
    buckets.reduce(
      (latest, { capacity, intervalMs, tat }) =>
        Math.max(latest, tat - allowanceOf(capacity, lane) * intervalMs),
      pausedUntil,
    );

  const take = (t: number): void => {
    for (const bucket of buckets) {
      bucket.tat = Math.max(bucket.tat, t) + bucket.intervalMs;
    }
  };

  // grants queued waiters in order while allowed, then keeps at most one timer, for the head that
  // drains next. the background head is served only once the foreground queue is empty
  const drain = (): void => {
    clearTimeout(timer);
    timer = undefined;
    for (;;) {
      const lane: Lane = foreground.length > 0 ? 'foreground' : 'background';
      const queue = lane === 'foreground' ? foreground : background;
      const head = queue[0];
      if (head === undefined) {
        return;
      }
      const t = now();
      const ready = readyAt(lane);
      if (t < ready) {
        timer = setTimeout(drain, Math.max(0, Math.ceil(ready - t)));
        return;
      }
      queue.shift();
      take(t);
      head.grant();
    }
  };

  // queues a waiter whose signal has not aborted
  const enqueue = (queue: Waiter[], signal: AbortSignal | undefined): Waiter => {
    let resolveGrant: () => void = noop;
    let rejectGrant: (error: CatalogAbortedError) => void = noop;
    const granted = new Promise<void>((resolve, reject) => {
      resolveGrant = resolve;
      rejectGrant = reject;
    });
    // a granted waiter is detached first: this only runs while the waiter is queued
    const detach = onAbort(signal, () => {
      detach();
      // a waiter that leaves takes no token, from whichever queue holds it
      if (!removeFrom(foreground, waiter)) {
        removeFrom(background, waiter);
      }
      rejectGrant(new CatalogAbortedError());
      drain();
    });
    const waiter: Waiter = {
      granted,
      grant: () => {
        detach();
        resolveGrant();
      },
    };
    queue.push(waiter);
    drain();
    return waiter;
  };

  // the caller may hold a handle a moment before it awaits `granted`: the rejection is marked as
  // handled here, and the caller still gets it when it awaits
  const handled = (granted: Promise<void>): Promise<void> => {
    void granted.catch(noop);
    return granted;
  };

  return {
    acquire: (signal) => {
      if (signal?.aborted === true) {
        return Promise.reject(new CatalogAbortedError());
      }
      return enqueue(foreground, signal).granted;
    },
    acquireBackground: (signal) => {
      if (signal?.aborted === true) {
        return { granted: handled(Promise.reject(new CatalogAbortedError())), promote: noop };
      }
      const waiter = enqueue(background, signal);
      return {
        granted: handled(waiter.granted),
        promote: () => {
          // a no-op once granted or aborted: the waiter already left the background queue
          if (removeFrom(background, waiter)) {
            foreground.push(waiter);
            drain();
          }
        },
      };
    },
    pauseFor: (ms) => {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError('A pause must be a finite, non-negative duration');
      }
      pausedUntil = Math.max(pausedUntil, now() + Math.min(ms, MAX_PAUSE_MS));
      drain();
    },
  };
};

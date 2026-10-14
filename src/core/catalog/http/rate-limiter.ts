// shared token bucket rate limiter of the catalog providers (docs/ARCHITECTURE.md §6, ADR-0005).
// it reads a monotonic clock: a wall clock change (ntp step, manual change) never moves its state
import { CatalogAbortedError } from '../../errors/catalog-errors';
import { onAbort, type Detach } from './abortable';

/** `capacity` requests at once, then one more every `refillIntervalMs`. */
export interface RateLimitBucket {
  readonly capacity: number;
  readonly refillIntervalMs: number;
}

/** a request is granted only when every bucket allows it. */
export interface RateLimitPolicy {
  readonly buckets: readonly RateLimitBucket[];
}

export interface RateLimiter {
  /** resolves when the caller may send one request; rejects with `CatalogAbortedError` on abort. */
  acquire(signal?: AbortSignal): Promise<void>;
  /** holds every waiter for `ms` (a 429 pauses everyone); never shortens a running pause. */
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

// the integer virtual-scheduling form of the token bucket (gcra): `tat` is the theoretical arrival
// time of the next request. a request at t is allowed when t >= tat - (capacity - 1) * interval, so
// at most capacity + floor(w / interval) are granted in any window of length w
interface BucketState {
  readonly capacity: number;
  readonly intervalMs: number;
  tat: number;
}

interface Waiter {
  readonly resolve: () => void;
  readonly detach: Detach;
}

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
  // fifo: a new caller never overtakes a queued one
  let queue: Waiter[] = [];
  let pausedUntil = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // the earliest time every bucket and the pause allow the next grant
  const readyAt = (): number =>
    buckets.reduce(
      (latest, { capacity, intervalMs, tat }) =>
        Math.max(latest, tat - (capacity - 1) * intervalMs),
      pausedUntil,
    );

  const grant = (t: number): void => {
    for (const bucket of buckets) {
      bucket.tat = Math.max(bucket.tat, t) + bucket.intervalMs;
    }
  };

  // grants queued waiters in order while allowed, then keeps at most one timer, for the head
  const drain = (): void => {
    clearTimeout(timer);
    timer = undefined;
    for (let head = queue[0]; head !== undefined; head = queue[0]) {
      const t = now();
      const ready = readyAt();
      if (t < ready) {
        timer = setTimeout(drain, Math.max(0, Math.ceil(ready - t)));
        return;
      }
      queue.shift();
      grant(t);
      head.detach();
      head.resolve();
    }
  };

  return {
    acquire: (signal) => {
      if (signal?.aborted === true) {
        return Promise.reject(new CatalogAbortedError());
      }
      return new Promise<void>((resolve, reject) => {
        // a granted waiter is detached first: this only runs while the waiter is queued
        const detach = onAbort(signal, () => {
          detach();
          // a waiter that leaves takes no token
          queue = queue.filter((queued) => queued !== waiter);
          reject(new CatalogAbortedError());
          drain();
        });
        const waiter: Waiter = { resolve, detach };
        queue.push(waiter);
        drain();
      });
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

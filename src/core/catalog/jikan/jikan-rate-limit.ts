import type { RateLimitPolicy } from '../http/rate-limiter';

// a token bucket grants at most floor(capacity + w / interval) requests in any window of length w
// (rate-limiter.ts), so each policy below keeps under the documented limits with a margin

// 2 requests at once, then one every 750 ms: a 4th request in a row needs 1.5 s
const BURST_CAPACITY = 2;
const BURST_REFILL_MS = 750;
const MINUTE_BUCKET_CAPACITY = 10;
const MINUTE_BUCKET_REFILL_MS = 1_500;

/**
 * the rate limit of the tenrai instance. tenrai documents 4 requests per second and 120 per
 * minute per ip, then a 429 with Retry-After. this single bucket keeps under both:
 * - per second: at most 3 in any 1 s window (2 + floor(1000 / 750)), 25 % under the limit
 * - per minute: at most 82 in any 60 s window (2 + 60000 / 750), 80 per minute sustained, 32 %
 *   under the limit
 * the margins absorb network jitter (requests sent 750 ms apart can reach the provider closer
 * together) and devices sharing one ip behind a nat.
 */
export const TENRAI_RATE_LIMIT: RateLimitPolicy = {
  buckets: [{ capacity: BURST_CAPACITY, refillIntervalMs: BURST_REFILL_MS }],
};

/**
 * the rate limit of a self-hosted jikan instance, whose limits are unknown: the conservative
 * default of the public jikan's documented 3 requests per second and 60 per minute. two buckets:
 * - per second: at most 3 in any 1 s window; a 4th needs 1.5 s, a 500 ms margin for network
 *   jitter (requests sent 1.5 s apart can reach the provider closer together)
 * - per minute: at most 50 in any 60 s window (51 need 61.5 s), 40 per minute sustained
 */
export const SELF_HOSTED_JIKAN_RATE_LIMIT: RateLimitPolicy = {
  buckets: [
    { capacity: BURST_CAPACITY, refillIntervalMs: BURST_REFILL_MS },
    { capacity: MINUTE_BUCKET_CAPACITY, refillIntervalMs: MINUTE_BUCKET_REFILL_MS },
  ],
};

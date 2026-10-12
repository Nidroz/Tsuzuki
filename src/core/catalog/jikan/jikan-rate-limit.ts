import type { RateLimitPolicy } from '../http/rate-limiter';

// jikan v4 documents 3 requests per second and 60 per minute. the token bucket grants at most
// floor(capacity + w / interval) requests in any window of length w, so these two buckets keep
// under both limits with a margin:
// - per second: at most 3 in any 1 s window; a 4th needs 1.5 s, a 500 ms margin for network
//   jitter (requests sent 1.5 s apart can reach the provider closer together)
// - per minute: at most 50 in any 60 s window (51 need 61.5 s), 40 per minute sustained
const SECOND_BUCKET_CAPACITY = 2;
const SECOND_BUCKET_REFILL_MS = 750;
const MINUTE_BUCKET_CAPACITY = 10;
const MINUTE_BUCKET_REFILL_MS = 1_500;

/** the rate limit of the jikan adapter's http client. */
export const JIKAN_RATE_LIMIT: RateLimitPolicy = {
  buckets: [
    { capacity: SECOND_BUCKET_CAPACITY, refillIntervalMs: SECOND_BUCKET_REFILL_MS },
    { capacity: MINUTE_BUCKET_CAPACITY, refillIntervalMs: MINUTE_BUCKET_REFILL_MS },
  ],
};

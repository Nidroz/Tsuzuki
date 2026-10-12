// retry rules of the catalog http client: what is retried, how long to wait, and the Retry-After
// header (docs/ARCHITECTURE.md §6)
import {
  CatalogHttpError,
  CatalogNetworkError,
  CatalogTimeoutError,
} from '../../errors/catalog-errors';

export interface RetryPolicy {
  // attempts in total, the first one included
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  // a longer Retry-After fails the request instead of waiting
  readonly maxRetryAfterMs: number;
  // no retry is scheduled later than this after the call started, its first token wait
  // included; the retry then queues for a token at the tail like any request
  readonly retryDeadlineMs: number;
}

// 3 retries after the first attempt, waiting 0.5-1 s, 1-2 s, then 2-4 s
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
  maxRetryAfterMs: 10_000,
  retryDeadlineMs: 20_000,
};

export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_SERVER_ERROR_MAX = 599;

const BACKOFF_FACTOR = 2;
// equal jitter: half of the delay is fixed, the other half random
const JITTER_FIXED_SHARE = 0.5;

const MS_PER_SECOND = 1_000;

/** a rate limit, a server error, a network failure or a timeout; never a client error or an abort. */
export const isRetryable = (error: unknown): boolean => {
  if (error instanceof CatalogHttpError) {
    return (
      error.status === HTTP_TOO_MANY_REQUESTS ||
      (error.status >= HTTP_SERVER_ERROR_MIN && error.status <= HTTP_SERVER_ERROR_MAX)
    );
  }
  return error instanceof CatalogNetworkError || error instanceof CatalogTimeoutError;
};

/** exponential backoff with equal jitter before the given retry (1-based), capped at maxDelayMs. */
export const backoffDelayMs = (
  retry: number,
  policy: RetryPolicy,
  random: () => number,
): number => {
  const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * BACKOFF_FACTOR ** (retry - 1));
  const fixed = delay * JITTER_FIXED_SHARE;
  return Math.round(fixed + random() * (delay - fixed));
};

const DELTA_SECONDS = /^\d+$/;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
// imf-fixdate (rfc 9110 §5.6.7): Sun, 06 Nov 1994 08:49:37 GMT
const IMF_FIXDATE = new RegExp(
  `^(?:${DAY_NAMES.join('|')}), (\\d{2}) (${MONTH_NAMES.join('|')}) (\\d{4}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$`,
);
// capture groups of IMF_FIXDATE
const DAY_GROUP = 1;
const MONTH_GROUP = 2;
const YEAR_GROUP = 3;
const HOURS_GROUP = 4;
const MINUTES_GROUP = 5;
const SECONDS_GROUP = 6;

// the Date.UTC call rolls impossible fields over (Feb 30 into March, hour 24 into the next day)
// and maps years 0-99 to 1900-1999: a date whose fields do not read back unchanged is rejected
const parseImfFixdate = (value: string): number | null => {
  const match = IMF_FIXDATE.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[YEAR_GROUP]);
  const month = MONTH_NAMES.indexOf(String(match[MONTH_GROUP]));
  const day = Number(match[DAY_GROUP]);
  const hours = Number(match[HOURS_GROUP]);
  const minutes = Number(match[MINUTES_GROUP]);
  const seconds = Number(match[SECONDS_GROUP]);
  const time = Date.UTC(year, month, day, hours, minutes, seconds);
  const date = new Date(time);
  const readsBack =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hours &&
    date.getUTCMinutes() === minutes &&
    date.getUTCSeconds() === seconds;
  return readsBack ? time : null;
};

/**
 * the Retry-After header in ms from `nowMs`: delta-seconds, or an imf-fixdate (0 when in the past).
 * null when absent or invalid (negative, decimal, any other date format).
 */
export const parseRetryAfter = (value: string | null, nowMs: number): number | null => {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (DELTA_SECONDS.test(trimmed)) {
    // a huge value stays finite: the caller compares it with its own bounds
    return Math.min(Number(trimmed) * MS_PER_SECOND, Number.MAX_SAFE_INTEGER);
  }
  const time = parseImfFixdate(trimmed);
  return time === null ? null : Math.max(0, time - nowMs);
};

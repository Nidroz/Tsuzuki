// the http client of the catalog adapters: rate limited, deduplicated, retried with backoff
// (docs/ARCHITECTURE.md §6). adapters parse what it returns with zod
import {
  CatalogAbortedError,
  CatalogHttpError,
  CatalogNetworkError,
  CatalogResponseError,
  CatalogTimeoutError,
} from '../../errors/catalog-errors';
import { onAbort, raceAbort, sleep } from './abortable';
import { createInFlightDedup } from './in-flight-dedup';
import { createRateLimiter, type RateLimitPolicy } from './rate-limiter';
import {
  DEFAULT_RETRY_POLICY,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_TOO_MANY_REQUESTS,
  backoffDelayMs,
  isRetryable,
  parseRetryAfter,
  type RetryPolicy,
} from './retry-policy';

/** one attempt, headers and body included, fails with `CatalogTimeoutError` after this. */
export const REQUEST_TIMEOUT_MS = 10_000;

export interface CatalogHttpClient {
  /**
   * fetches `url` (https only) and returns its parsed json body. identical urls in flight share one
   * request; every attempt, retries included, takes a rate limiter token. rejects with a
   * `CatalogError` subclass, or a `RangeError` for a url that is not https.
   */
  getJson(url: string, signal?: AbortSignal): Promise<unknown>;
}

export interface CatalogHttpClientOptions {
  readonly rateLimit: RateLimitPolicy;
  readonly retry?: RetryPolicy;
  readonly timeoutMs?: number;
  // default Math.random, for the backoff jitter
  readonly random?: () => number;
  // default Date.now, shared with the rate limiter
  readonly now?: () => number;
}

const HTTPS_PREFIX = 'https://';
const REQUEST_HEADERS = { Accept: 'application/json' } as const;
const RETRY_AFTER_HEADER = 'Retry-After';
const SYNTAX_ERROR_NAME = 'SyntaxError';

// by name: a json parse error may come from another realm (node's fetch under jest), where
// instanceof SyntaxError is false
const isSyntaxError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === SYNTAX_ERROR_NAME;

// a 429 pauses every request of the client; so does a 503 that says how long to wait
const pausesEveryone = (error: CatalogHttpError): boolean =>
  error.status === HTTP_TOO_MANY_REQUESTS ||
  (error.status === HTTP_SERVICE_UNAVAILABLE && error.retryAfterMs !== null);

/** one limiter and one dedup map per client: one client per provider instance, no singleton. */
export const createCatalogHttpClient = (options: CatalogHttpClientOptions): CatalogHttpClient => {
  const retry = options.retry ?? DEFAULT_RETRY_POLICY;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const random = options.random ?? (() => Math.random());
  const now = options.now ?? (() => Date.now());
  const limiter = createRateLimiter(options.rateLimit, { now });
  const dedup = createInFlightDedup<unknown>();

  const attempt = async (url: string, shared: AbortSignal): Promise<unknown> => {
    // the shared signal may have aborted between the token grant and this call
    if (shared.aborted) {
      throw new CatalogAbortedError();
    }
    const controller = new AbortController();
    let timedOut = false;
    const unlink = onAbort(shared, () => {
      controller.abort();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    // an abort or a timeout wins over whatever the transfer reported
    const interrupted = (): CatalogAbortedError | CatalogTimeoutError | null => {
      if (shared.aborted) {
        return new CatalogAbortedError();
      }
      return timedOut ? new CatalogTimeoutError(timeoutMs) : null;
    };
    try {
      let response: Response;
      try {
        // read at call time: never a fetch captured at module load
        response = await raceAbort(
          globalThis.fetch(url, { signal: controller.signal, headers: REQUEST_HEADERS }),
          controller.signal,
        );
      } catch {
        throw interrupted() ?? new CatalogNetworkError();
      }
      // an abort or a timeout before the response rejects through raceAbort; one in the same
      // microtask turn still ends at the raced body read or at the backoff sleep
      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(response.headers.get(RETRY_AFTER_HEADER), now());
        throw new CatalogHttpError(response.status, retryAfterMs);
      }
      let body: unknown;
      try {
        // raced: the timeout and the caller's abort also end a body read that ignores the signal
        body = await raceAbort(response.json(), controller.signal);
      } catch (error: unknown) {
        throw (
          interrupted() ??
          (isSyntaxError(error) ? new CatalogResponseError() : new CatalogNetworkError())
        );
      }
      return body;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  };

  const withRetries = async (url: string, shared: AbortSignal): Promise<unknown> => {
    const startedAt = now();
    for (let attemptNumber = 1; ; attemptNumber += 1) {
      await limiter.acquire(shared);
      try {
        return await attempt(url, shared);
      } catch (error: unknown) {
        const backoff = backoffDelayMs(attemptNumber, retry, random);
        const httpError = error instanceof CatalogHttpError ? error : null;
        const retryAfter = httpError?.retryAfterMs ?? null;
        // before deciding to retry: the provider's window is full even when this request gives up
        if (httpError !== null && pausesEveryone(httpError)) {
          limiter.pauseFor(retryAfter ?? backoff);
        }
        if (!isRetryable(error) || attemptNumber >= retry.maxAttempts) {
          throw error;
        }
        if (retryAfter !== null && retryAfter > retry.maxRetryAfterMs) {
          throw error;
        }
        const delay = Math.max(retryAfter ?? 0, backoff);
        if (now() + delay - startedAt > retry.retryDeadlineMs) {
          throw error;
        }
        await sleep(delay, shared);
      }
    }
  };

  return {
    getJson: (url, signal) => {
      if (!url.startsWith(HTTPS_PREFIX)) {
        // the url may hold search text: it stays out of the message
        return Promise.reject(new RangeError('Catalog requests must use https'));
      }
      // get requests only: the exact url is the dedup key
      return dedup.run(url, (shared) => withRetries(url, shared), signal);
    },
  };
};

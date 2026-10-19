// the http client of the catalog adapters: rate limited, deduplicated, retried with backoff
// (docs/ARCHITECTURE.md §6). adapters parse what it returns with zod
import type { CatalogRequestOptions, CatalogRequestPriority } from '../catalog-provider';
import {
  CatalogAbortedError,
  CatalogHttpError,
  CatalogNetworkError,
  CatalogResponseError,
  CatalogTimeoutError,
} from '../../errors/catalog-errors';
import { onAbort, raceAbort, sleep } from './abortable';
import { createInFlightDedup } from './in-flight-dedup';
import { createRateLimiter, type BackgroundAcquire, type RateLimitPolicy } from './rate-limiter';
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
   * request; every attempt, retries included, takes a rate limiter token. `priority: 'background'`
   * (a prefetch) joins a request in flight, or starts one that takes its tokens behind every
   * foreground request; a foreground call (the default) for a url in flight as background promotes
   * it. rejects with a `CatalogError` subclass, or a `RangeError` for a url that is not https.
   */
  getJson(url: string, signal?: AbortSignal, options?: CatalogRequestOptions): Promise<unknown>;
}

export interface CatalogHttpClientOptions {
  readonly rateLimit: RateLimitPolicy;
  readonly retry?: RetryPolicy;
  readonly timeoutMs?: number;
  /** for the backoff jitter, in [0, 1). default `Math.random()`. */
  readonly random?: () => number;
  /**
   * monotonic clock in ms: it must never decrease. default `performance.now()`, read on each call
   * so fake timers apply. shared with the rate limiter and measures the retry deadline, so a wall
   * clock change never refills a bucket, shortens a pause or moves the deadline.
   */
  readonly now?: () => number;
  /**
   * wall clock in epoch ms, default `Date.now()`, read on each call. only resolves a `Retry-After`
   * http date, never a duration.
   */
  readonly wallClock?: () => number;
}

const HTTPS_PREFIX = 'https://';
const REQUEST_HEADERS = { Accept: 'application/json' } as const;
const RETRY_AFTER_HEADER = 'Retry-After';
const SYNTAX_ERROR_NAME = 'SyntaxError';
const BACKGROUND_PRIORITY = 'background' satisfies CatalogRequestPriority;

// the priority of a request in flight, beside its dedup entry. `pending` is the token wait of its
// current attempt while the request is background, so a foreground caller can promote it
interface RequestLane {
  background: boolean;
  pending: BackgroundAcquire | null;
}

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
  const now = options.now ?? (() => performance.now());
  const wallClock = options.wallClock ?? (() => Date.now());
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
        const retryAfterMs = parseRetryAfter(response.headers.get(RETRY_AFTER_HEADER), wallClock());
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
      // a non-2xx body is never read: on undici and in browsers it would hold the connection, so
      // the attempt's transfer is aborted. a no-op on a request that already settled (body read,
      // network error): the outcome is decided above, and a raceAbort listener still attached for
      // a microtask only rejects an already settled promise
      controller.abort();
    }
  };

  // lane state per url, beside the dedup map: registered when a task starts and removed only by
  // that task, since a later task may own the url once every caller of an older one left
  const lanes = new Map<string, RequestLane>();

  // a token for the next attempt: background while the request is, foreground once promoted
  const takeToken = async (lane: RequestLane, shared: AbortSignal): Promise<void> => {
    if (!lane.background) {
      await limiter.acquire(shared);
      return;
    }
    const pending = limiter.acquireBackground(shared);
    lane.pending = pending;
    try {
      await pending.granted;
    } finally {
      lane.pending = null;
    }
  };

  const promote = (url: string): void => {
    const lane = lanes.get(url);
    if (lane?.background === true) {
      lane.background = false;
      // the attempt waiting for its token now; later attempts use acquire
      lane.pending?.promote();
    }
  };

  const withRetries = async (
    url: string,
    shared: AbortSignal,
    lane: RequestLane,
  ): Promise<unknown> => {
    // the retry deadline of a foreground request counts from the call, its first token wait
    // included. a request started in the background counts from its first token grant: its wait
    // behind every foreground request is not on the user's clock, and a promotion keeps that start
    let startedAt = lane.background ? null : now();
    for (let attemptNumber = 1; ; attemptNumber += 1) {
      await takeToken(lane, shared);
      startedAt ??= now();
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

  // the task of a dedup entry: dedup starts it synchronously, so its lane is registered before any
  // other caller can join
  const run = async (url: string, shared: AbortSignal, background: boolean): Promise<unknown> => {
    const lane: RequestLane = { background, pending: null };
    lanes.set(url, lane);
    try {
      return await withRetries(url, shared, lane);
    } finally {
      if (lanes.get(url) === lane) {
        lanes.delete(url);
      }
    }
  };

  return {
    getJson: (url, signal, requestOptions) => {
      if (!url.startsWith(HTTPS_PREFIX)) {
        // the url may hold search text: it stays out of the message
        return Promise.reject(new RangeError('Catalog requests must use https'));
      }
      const background = requestOptions?.priority === BACKGROUND_PRIORITY;
      // get requests only: the exact url is the dedup key. a background caller joins whatever is
      // in flight, without an extra token
      const result = dedup.run(url, (shared) => run(url, shared, background), signal);
      // a foreground caller that joined a background request promotes it; one that left at once
      // (signal already aborted) joined nothing
      if (!background && signal?.aborted !== true) {
        promote(url);
      }
      return result;
    },
  };
};

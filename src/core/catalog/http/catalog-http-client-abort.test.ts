import { describe, expect, it, jest } from '@jest/globals';
import { HttpResponse } from 'msw';

import {
  CatalogAbortedError,
  CatalogNetworkError,
  CatalogTimeoutError,
} from '../../errors/catalog-errors';
import {
  expectNoPendingTimer,
  neverAnswer,
  recordRequests,
  settle,
} from '../../../../test/core/catalog-http-test-support';
import { createCatalogHttpClient, type CatalogHttpClientOptions } from './catalog-http-client';
import type { RateLimitPolicy } from './rate-limiter';
import { DEFAULT_RETRY_POLICY } from './retry-policy';

// aborts and timeouts at each stage of a call: queued for a token, sleeping before a retry,
// waiting for the headers and reading the body; callers sharing a url are in the release suite.
// a rejection left unhandled fails the test that left it (jest-circus watches the real process;
// the sandbox `process` is a copy whose listeners never fire)

const URL = 'https://catalog.test/anime/1';
const OTHER_URL = 'https://catalog.test/anime/2';
const THIRD_URL = 'https://catalog.test/anime/3';
const PAYLOAD = { data: { mal_id: 1, title: 'Frieren' } };
const UNLIMITED: RateLimitPolicy = { buckets: [{ capacity: 100, refillIntervalMs: 1 }] };
const TOKEN_INTERVAL_MS = 1_000;
const ONE_PER_SECOND: RateLimitPolicy = {
  buckets: [{ capacity: 1, refillIntervalMs: TOKEN_INTERVAL_MS }],
};
// first retry with random() = 0: half of the 1 s base delay
const FIRST_BACKOFF_MS = 500;
const TIMEOUT_MS = 1_000;
// longer than any retry sequence of these tests: whatever was left to send has been sent
const LONG_AFTER_MS = 60_000;

const createClient = (options: Partial<CatalogHttpClientOptions> = {}) =>
  createCatalogHttpClient({ rateLimit: UNLIMITED, random: () => 0, ...options });

const answerPayload = (): Response => HttpResponse.json(PAYLOAD);

const partialJson = (): Uint8Array => new TextEncoder().encode('{"data": {"mal_id": 1, ');

// a body that sends its first bytes and never ends. like a real fetch body, it errors with the
// abort reason when its request aborts: msw would leave a mocked body running
const endlessBody = (request: Request): Response => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(partialJson());
      request.signal.addEventListener('abort', () => {
        controller.error(request.signal.reason);
      });
    },
  });
  return new HttpResponse(body, { headers: { 'Content-Type': 'application/json' } });
};

// a body cut after its first chunk, as by a connection reset: the stream only pulls once that
// chunk was read
const brokenBody = (): Response => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(partialJson());
    },
    pull(controller) {
      controller.error(new TypeError('terminated'));
    },
  });
  return new HttpResponse(body, { headers: { 'Content-Type': 'application/json' } });
};

// the platform fetch rejects once its signal aborts. msw instead answers a request aborted before
// its handler answered with a 500, so this stub covers the rejection path
const stubFetchRejectingOnAbort = () =>
  jest.spyOn(globalThis, 'fetch').mockImplementation(
    (_, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      }),
  );

describe('an abort while queued for a token', () => {
  it('sends nothing and hands the token to the next caller', async () => {
    recordRequests(OTHER_URL, answerPayload);
    const aborted = recordRequests(URL, answerPayload);
    const next = recordRequests(THIRD_URL, answerPayload);
    const client = createClient({ rateLimit: ONE_PER_SECOND });
    const controller = new AbortController();

    const results = Promise.all([
      settle(client.getJson(OTHER_URL)),
      settle(client.getJson(URL, controller.signal)),
      settle(client.getJson(THIRD_URL)),
    ]);
    await jest.advanceTimersByTimeAsync(TOKEN_INTERVAL_MS / 2);
    controller.abort();
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    const [first, left, last] = await results;
    expect(left).toBeInstanceOf(CatalogAbortedError);
    expect([first, last]).toEqual([PAYLOAD, PAYLOAD]);
    expect(aborted).toHaveLength(0);
    // the second token, which the aborted caller would have had
    expect(next.map(({ at }) => at)).toStrictEqual([TOKEN_INTERVAL_MS]);
    await expectNoPendingTimer();
  });
});

describe('an abort during the backoff', () => {
  it('rejects at once, cancels the sleep and sends no retry', async () => {
    const requests = recordRequests(URL, () => new HttpResponse(null, { status: 500 }));
    const controller = new AbortController();

    const result = settle(createClient().getJson(URL, controller.signal));
    await jest.advanceTimersByTimeAsync(FIRST_BACKOFF_MS / 2);
    // the backoff sleep is the only timer
    expect(jest.getTimerCount()).toBe(1);
    controller.abort();

    // no time passed: the abort itself rejected the caller and cleared the sleep
    expect(await result).toBeInstanceOf(CatalogAbortedError);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(requests).toHaveLength(1);
    await expectNoPendingTimer();
  });
});

describe('an abort during the fetch', () => {
  // msw's 500 lands after the abort: the client discards it, neither reported nor retried
  it('aborts the request the provider sees and discards its late answer', async () => {
    const requests = recordRequests(URL, neverAnswer);
    const controller = new AbortController();

    const result = settle(createClient().getJson(URL, controller.signal));
    await jest.advanceTimersByTimeAsync(0);
    expect(requests[0]?.signal.aborted).toBe(false);
    controller.abort();

    const outcome = await result;
    expect(outcome).toBeInstanceOf(CatalogAbortedError);
    expect(outcome).not.toBeInstanceOf(CatalogNetworkError);
    expect(requests[0]?.signal.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(requests).toHaveLength(1);
    await expectNoPendingTimer();
  });

  it('reports a timeout, not a network error, when the fetch rejects on it', async () => {
    const fetchStub = stubFetchRejectingOnAbort();
    const client = createClient({
      timeoutMs: TIMEOUT_MS,
      retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 },
    });

    const result = settle(client.getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await result).toBeInstanceOf(CatalogTimeoutError);
    // a timeout is retried: two attempts, each cut at TIMEOUT_MS
    expect(fetchStub).toHaveBeenCalledTimes(2);
    await expectNoPendingTimer();
  });
});

describe('reading the body', () => {
  it('times out on a body that never ends', async () => {
    const requests = recordRequests(URL, endlessBody);
    const client = createClient({
      timeoutMs: TIMEOUT_MS,
      retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 },
    });

    const result = settle(client.getJson(URL));
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(requests[0]?.signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    expect(await result).toBeInstanceOf(CatalogTimeoutError);
    expect(await result).toMatchObject({ timeoutMs: TIMEOUT_MS });
    expect(requests[0]?.signal.aborted).toBe(true);
    await expectNoPendingTimer();
  });

  it('reports an abort, and clears the timeout, when the caller leaves during the body', async () => {
    const requests = recordRequests(URL, endlessBody);
    const controller = new AbortController();

    const result = settle(createClient({ timeoutMs: TIMEOUT_MS }).getJson(URL, controller.signal));
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS / 2);
    controller.abort();

    expect(await result).toBeInstanceOf(CatalogAbortedError);
    expect(requests[0]?.signal.aborted).toBe(true);
    // the attempt settled: its timeout was cleared and nothing was retried
    await expectNoPendingTimer();
    expect(requests).toHaveLength(1);
  });

  it('reports a body cut mid-stream as a network error, and retries it', async () => {
    const requests = recordRequests(URL, brokenBody);
    const client = createClient({ retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 } });

    const result = settle(client.getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await result).toBeInstanceOf(CatalogNetworkError);
    expect(requests.map(({ at }) => at)).toStrictEqual([0, FIRST_BACKOFF_MS]);
    await expectNoPendingTimer();
  });
});

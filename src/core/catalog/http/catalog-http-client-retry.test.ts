import { describe, expect, it, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import { CatalogHttpError } from '../../errors/catalog-errors';
import {
  elapsed,
  expectNoPendingTimer,
  settle,
} from '../../../../test/core/catalog-http-test-support';
import { createCatalogHttpClient, type CatalogHttpClientOptions } from './catalog-http-client';
import type { RateLimitPolicy } from './rate-limiter';
import { DEFAULT_RETRY_POLICY } from './retry-policy';

// retry rules of the client through msw: statuses, backoff timing, Retry-After, the shared pause
// and the retry deadline. handlers record each dispatch time from the fake clock

const URL = 'https://catalog.test/anime/1';
const OTHER_URL = 'https://catalog.test/anime/2';
const PAYLOAD = { data: { mal_id: 1, title: 'Frieren' } };
const UNLIMITED: RateLimitPolicy = { buckets: [{ capacity: 100, refillIntervalMs: 1 }] };
// one token, then one more every 400 ms: a second request waits in the queue
const TOKEN_INTERVAL_MS = 400;
const ONE_TOKEN_PER_INTERVAL: RateLimitPolicy = {
  buckets: [{ capacity: 1, refillIntervalMs: TOKEN_INTERVAL_MS }],
};
// just below 1, the largest value Math.random returns
const ALMOST_ONE = 1 - Number.EPSILON;
// first retry with random() = 0: half of the 1 s base delay
const FIRST_BACKOFF_MS = 500;
// longer than any retry sequence of these tests: whatever was left to send has been sent
const LONG_AFTER_MS = 60_000;

// random() = 0 unless a test says otherwise: the shortest backoff, 0.5 s, 1 s, then 2 s
const createClient = (options: Partial<CatalogHttpClientOptions> = {}) =>
  createCatalogHttpClient({ rateLimit: UNLIMITED, random: () => 0, ...options });

interface Tracked {
  settled: boolean;
  outcome: unknown;
}

// the outcome of a request as soon as it settles, readable while the clock is still advancing
const track = (request: Promise<unknown>): Tracked => {
  const tracked: Tracked = { settled: false, outcome: undefined };
  const done = (outcome: unknown): void => {
    tracked.settled = true;
    tracked.outcome = outcome;
  };
  void request.then(done, done);
  return tracked;
};

// answers the n-th request to url (1-based) with answer(n); returns the dispatch times in ms
const recordDispatches = (url: string, answer: (dispatch: number) => Response): number[] => {
  const dispatches: number[] = [];
  server.use(
    http.get(url, () => {
      dispatches.push(elapsed());
      return answer(dispatches.length);
    }),
  );
  return dispatches;
};

const failure = (status: number, retryAfter?: string): Response =>
  new HttpResponse(null, {
    status,
    headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
  });

// fails the first dispatch, then answers the payload
const failOnce =
  (status: number, retryAfter?: string) =>
  (dispatch: number): Response =>
    dispatch === 1 ? failure(status, retryAfter) : HttpResponse.json(PAYLOAD);

const answerPayload = (): Response => HttpResponse.json(PAYLOAD);

describe('statuses', () => {
  it.each([500, 503, 504])('retries a %p after the backoff', async (status) => {
    const dispatches = recordDispatches(URL, failOnce(status));

    const result = settle(createClient().getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await result).toEqual(PAYLOAD);
    expect(dispatches).toStrictEqual([0, FIRST_BACKOFF_MS]);
    await expectNoPendingTimer();
  });

  it.each([400, 403, 404])('sends a %p once', async (status) => {
    const dispatches = recordDispatches(URL, () => failure(status));

    const result = settle(createClient().getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await result).toBeInstanceOf(CatalogHttpError);
    expect(await result).toMatchObject({ status, retryAfterMs: null });
    expect(dispatches).toStrictEqual([0]);
    await expectNoPendingTimer();
  });

  it('gives up on a persistent 503 after maxAttempts requests', async () => {
    const dispatches = recordDispatches(URL, () => failure(503));

    const result = settle(createClient().getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await result).toBeInstanceOf(CatalogHttpError);
    expect(await result).toMatchObject({ status: 503, retryAfterMs: null });
    // the default maxAttempts
    expect(dispatches).toHaveLength(4);
    await expectNoPendingTimer();
  });
});

describe('backoff', () => {
  it.each([
    ['the lowest', 0, [0, 500, 1_500, 3_500]],
    ['the highest', ALMOST_ONE, [0, 1_000, 3_000, 7_000]],
  ])('spaces the attempts of a persistent 500 with %s jitter', async (_, random, expected) => {
    const dispatches = recordDispatches(URL, () => failure(500));

    const result = settle(createClient({ random: () => random }).getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await result).toMatchObject({ status: 500 });
    expect(dispatches).toStrictEqual(expected);
    await expectNoPendingTimer();
  });
});

describe('Retry-After', () => {
  // on a 500 nothing is paused: the wait is the retry's own sleep, max(Retry-After, 0.5 s backoff)
  it.each([
    ['a Retry-After longer than the backoff', '2', 2_000],
    ['an invalid Retry-After, so the backoff', '1.5', FIRST_BACKOFF_MS],
    ['an invalid Retry-After, so the backoff', 'soon', FIRST_BACKOFF_MS],
    ['a Retry-After of exactly 10 s', '10', 10_000],
    ['an imf-fixdate, 3 s after the fixed clock', 'Thu, 01 Jan 2026 00:00:03 GMT', 3_000],
  ])('waits %s (%p) and retries at %p ms', async (_, retryAfter, retryAt) => {
    const dispatches = recordDispatches(URL, failOnce(500, retryAfter));

    const result = settle(createClient().getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await result).toEqual(PAYLOAD);
    expect(dispatches).toStrictEqual([0, retryAt]);
    await expectNoPendingTimer();
  });

  it('waits the backoff once it outgrows the Retry-After', async () => {
    const dispatches = recordDispatches(URL, () => failure(500, '1'));

    const result = settle(createClient().getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await result).toMatchObject({ status: 500, retryAfterMs: 1_000 });
    // backoffs of 0.5 s, 1 s and 2 s against a 1 s Retry-After
    expect(dispatches).toStrictEqual([0, 1_000, 2_000, 4_000]);
    await expectNoPendingTimer();
  });

  it('fails at once on a Retry-After of 11 s, which it carries', async () => {
    const dispatches = recordDispatches(URL, failOnce(429, '11'));

    const result = track(createClient().getJson(URL));
    await jest.advanceTimersByTimeAsync(0);
    expect(result.settled).toBe(true);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(result.outcome).toBeInstanceOf(CatalogHttpError);
    expect(result.outcome).toMatchObject({ status: 429, retryAfterMs: 11_000 });
    expect(dispatches).toStrictEqual([0]);
    await expectNoPendingTimer();
  });
});

describe('shared pause', () => {
  // without a pause, the queued request gets the second token, at TOKEN_INTERVAL_MS
  it.each([
    ['a 429 with Retry-After', 2_000, 429, '2'],
    ['a 429 without Retry-After, for the backoff', FIRST_BACKOFF_MS, 429, undefined],
    ['a 503 with Retry-After', 2_000, 503, '2'],
    ['a 503 without Retry-After', TOKEN_INTERVAL_MS, 503, undefined],
    ['a 500 with Retry-After', TOKEN_INTERVAL_MS, 500, '2'],
  ])('after %s, the queued request is sent at %p ms', async (_, sentAt, status, retryAfter) => {
    recordDispatches(URL, failOnce(status, retryAfter));
    const others = recordDispatches(OTHER_URL, answerPayload);
    const client = createClient({ rateLimit: ONE_TOKEN_PER_INTERVAL });

    const results = Promise.all([settle(client.getJson(URL)), settle(client.getJson(OTHER_URL))]);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    // json parsed by node's fetch, in another realm: equal, not strictly equal
    expect(await results).toEqual([PAYLOAD, PAYLOAD]);
    expect(others).toStrictEqual([sentAt]);
    await expectNoPendingTimer();
  });

  it('pauses the other requests on a 429 that is not retried', async () => {
    recordDispatches(URL, () => failure(429, '2'));
    const others = recordDispatches(OTHER_URL, answerPayload);
    const client = createClient({
      rateLimit: ONE_TOKEN_PER_INTERVAL,
      retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 },
    });

    const result = track(client.getJson(URL));
    const other = settle(client.getJson(OTHER_URL));
    await jest.advanceTimersByTimeAsync(0);
    // the last attempt failed: the error surfaces at once, the pause stays
    expect(result.outcome).toMatchObject({ status: 429, retryAfterMs: 2_000 });
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await other).toEqual(PAYLOAD);
    expect(others).toStrictEqual([2_000]);
    await expectNoPendingTimer();
  });
});

describe('retry deadline', () => {
  // the deadline is 20 s and the first backoff 0.5 s: from 19.6 s on, no retry fits
  it.each([19_600, 25_000])(
    'does not retry a call whose first token came at %p ms',
    async (tokenAt) => {
      const others = recordDispatches(OTHER_URL, answerPayload);
      const dispatches = recordDispatches(URL, () => failure(503));
      const client = createClient({
        rateLimit: { buckets: [{ capacity: 1, refillIntervalMs: tokenAt }] },
      });

      const first = settle(client.getJson(OTHER_URL));
      const result = track(client.getJson(URL));
      await jest.advanceTimersByTimeAsync(tokenAt);
      expect(result.settled).toBe(true);
      await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

      expect(result.outcome).toBeInstanceOf(CatalogHttpError);
      expect(result.outcome).toMatchObject({ status: 503 });
      expect(dispatches).toStrictEqual([tokenAt]);
      expect(await first).toEqual(PAYLOAD);
      expect(others).toStrictEqual([0]);
      await expectNoPendingTimer();
    },
  );

  it('still retries when the retry starts exactly at the deadline', async () => {
    const dispatches = recordDispatches(URL, () => failure(500));
    const client = createClient({ retry: { ...DEFAULT_RETRY_POLICY, retryDeadlineMs: 1_500 } });

    const result = settle(client.getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await result).toMatchObject({ status: 500 });
    // the third attempt starts at 1.5 s, on the deadline; a fourth would start at 3.5 s
    expect(dispatches).toStrictEqual([0, 500, 1_500]);
    await expectNoPendingTimer();
  });

  it('cuts a series of 10 s Retry-After at the default deadline', async () => {
    const dispatches = recordDispatches(URL, () => failure(503, '10'));

    const result = settle(createClient().getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await result).toMatchObject({ status: 503, retryAfterMs: 10_000 });
    expect(dispatches).toStrictEqual([0, 10_000, 20_000]);
    await expectNoPendingTimer();
  });
});

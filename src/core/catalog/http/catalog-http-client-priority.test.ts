import { describe, expect, it, jest } from '@jest/globals';
import { HttpResponse } from 'msw';

import { CatalogAbortedError } from '../../errors/catalog-errors';
import {
  expectNoPendingTimer,
  recordRequests,
  settle,
} from '../../../../test/core/catalog-http-test-support';
import { createCatalogHttpClient, type CatalogHttpClientOptions } from './catalog-http-client';
import type { RateLimitPolicy } from './rate-limiter';

// request priorities of the client (C-06): a background request takes its tokens behind every
// foreground one, joins and is joined like any request, and a foreground caller promotes it

const URL = 'https://catalog.test/anime/1';
const OTHER_URL = 'https://catalog.test/anime/2';
const THIRD_URL = 'https://catalog.test/anime/3';
const PAYLOAD = { data: { mal_id: 1, title: 'Frieren' } };
// one token, then one more every 400 ms: no reserve
const TOKEN_INTERVAL_MS = 400;
const ONE_TOKEN_PER_INTERVAL: RateLimitPolicy = {
  buckets: [{ capacity: 1, refillIntervalMs: TOKEN_INTERVAL_MS }],
};
// the shape of the tenrai policy: 2 at once, then one every 750 ms; a background request keeps one
const BURST_INTERVAL_MS = 750;
const BURST_OF_TWO: RateLimitPolicy = {
  buckets: [{ capacity: 2, refillIntervalMs: BURST_INTERVAL_MS }],
};
// first retry with random() = 0: half of the 1 s base delay
const FIRST_BACKOFF_MS = 500;
const LONG_AFTER_MS = 60_000;
const BACKGROUND = { priority: 'background' } as const;

const createClient = (options: Partial<CatalogHttpClientOptions> = {}) =>
  createCatalogHttpClient({ rateLimit: BURST_OF_TWO, random: () => 0, ...options });

const answerPayload = (): Response => HttpResponse.json(PAYLOAD);

// fails the first dispatch with a 500, then answers the payload
const failOnce = (_: Request, dispatch: number): Response =>
  dispatch === 1 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(PAYLOAD);

const timesOf = (dispatches: readonly { at: number }[]): number[] => dispatches.map(({ at }) => at);

describe('a background request', () => {
  it('never delays a foreground request queued after it', async () => {
    const first = recordRequests(OTHER_URL, answerPayload);
    const background = recordRequests(URL, answerPayload);
    const foreground = recordRequests(THIRD_URL, answerPayload);
    const client = createClient({ rateLimit: ONE_TOKEN_PER_INTERVAL });

    const results = Promise.all([
      settle(client.getJson(OTHER_URL)),
      settle(client.getJson(URL, undefined, BACKGROUND)),
      settle(client.getJson(THIRD_URL)),
    ]);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await results).toEqual([PAYLOAD, PAYLOAD, PAYLOAD]);
    expect(timesOf(first)).toStrictEqual([0]);
    expect(timesOf(foreground)).toStrictEqual([TOKEN_INTERVAL_MS]);
    expect(timesOf(background)).toStrictEqual([2 * TOKEN_INTERVAL_MS]);
    await expectNoPendingTimer();
  });

  it('is sent without the reserve wait once a foreground caller joins it', async () => {
    recordRequests(OTHER_URL, answerPayload);
    const requests = recordRequests(URL, answerPayload);
    const client = createClient();
    const joinAtMs = 100;

    const first = settle(client.getJson(OTHER_URL));
    const background = settle(client.getJson(URL, undefined, BACKGROUND));
    await jest.advanceTimersByTimeAsync(joinAtMs);
    expect(requests).toHaveLength(0);
    const foreground = settle(client.getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect([await first, await background, await foreground]).toEqual([PAYLOAD, PAYLOAD, PAYLOAD]);
    // one request, sent when the foreground caller came instead of at BURST_INTERVAL_MS
    expect(timesOf(requests)).toStrictEqual([joinAtMs]);
    await expectNoPendingTimer();
  });

  it('joins a foreground request in flight without taking a token', async () => {
    const requests = recordRequests(URL, answerPayload);
    const next = recordRequests(OTHER_URL, answerPayload);
    const client = createClient({ rateLimit: ONE_TOKEN_PER_INTERVAL });

    const results = Promise.all([
      settle(client.getJson(URL)),
      settle(client.getJson(URL, undefined, BACKGROUND)),
      settle(client.getJson(OTHER_URL)),
    ]);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await results).toEqual([PAYLOAD, PAYLOAD, PAYLOAD]);
    expect(requests).toHaveLength(1);
    // the second token, which a request of the background caller would have taken
    expect(timesOf(next)).toStrictEqual([TOKEN_INTERVAL_MS]);
    await expectNoPendingTimer();
  });
});

describe('retries of a background request', () => {
  it('stay background: a foreground request goes first', async () => {
    const requests = recordRequests(URL, failOnce);
    const foreground = recordRequests(OTHER_URL, answerPayload);
    const client = createClient();
    const foregroundAtMs = 600;

    // a full bucket: granted at once, keeping one token
    const background = settle(client.getJson(URL, undefined, BACKGROUND));
    await jest.advanceTimersByTimeAsync(foregroundAtMs);
    // the retry, due at 500 ms, still waits for the bucket to refill to its reserve
    expect(timesOf(requests)).toStrictEqual([0]);
    const other = settle(client.getJson(OTHER_URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect([await background, await other]).toEqual([PAYLOAD, PAYLOAD]);
    expect(timesOf(foreground)).toStrictEqual([foregroundAtMs]);
    // after the foreground grant, the bucket keeps its reserve again at 1.5 s
    expect(timesOf(requests)).toStrictEqual([0, 2 * BURST_INTERVAL_MS]);
    await expectNoPendingTimer();
  });

  it('turn foreground once a caller joins during the backoff', async () => {
    recordRequests(OTHER_URL, answerPayload);
    const requests = recordRequests(URL, failOnce);
    const client = createClient();
    const joinAtMs = 1_000;

    const first = settle(client.getJson(OTHER_URL));
    const background = settle(client.getJson(URL, undefined, BACKGROUND));
    await jest.advanceTimersByTimeAsync(joinAtMs);
    // sent at the reserve time, then failed: the backoff runs until 1.25 s
    expect(timesOf(requests)).toStrictEqual([BURST_INTERVAL_MS]);
    const foreground = settle(client.getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect([await first, await background, await foreground]).toEqual([PAYLOAD, PAYLOAD, PAYLOAD]);
    // a foreground token at the end of the backoff; a background one would wait until 1.5 s
    expect(timesOf(requests)).toStrictEqual([
      BURST_INTERVAL_MS,
      BURST_INTERVAL_MS + FIRST_BACKOFF_MS,
    ]);
    await expectNoPendingTimer();
  });

  it('count the retry deadline from the first token grant', async () => {
    // a 25 s wait for the first token: past the 20 s deadline of a foreground call
    const tokenAtMs = 25_000;
    const first = recordRequests(OTHER_URL, answerPayload);
    const requests = recordRequests(URL, (request, dispatch) =>
      dispatch === 1 ? new HttpResponse(null, { status: 503 }) : answerPayload(),
    );
    const client = createClient({
      rateLimit: { buckets: [{ capacity: 1, refillIntervalMs: tokenAtMs }] },
    });

    const results = Promise.all([
      settle(client.getJson(OTHER_URL)),
      settle(client.getJson(URL, undefined, BACKGROUND)),
    ]);
    await jest.advanceTimersByTimeAsync(3 * tokenAtMs);

    expect(await results).toEqual([PAYLOAD, PAYLOAD]);
    expect(timesOf(first)).toStrictEqual([0]);
    // retried: the deadline started at the 25 s grant
    expect(timesOf(requests)).toStrictEqual([tokenAtMs, 2 * tokenAtMs]);
    await expectNoPendingTimer();
  });
});

describe('the lane of a url', () => {
  it('belongs to the latest request when an abandoned one ends after it started', async () => {
    recordRequests(OTHER_URL, answerPayload);
    const requests = recordRequests(URL, answerPayload);
    const client = createClient();
    const controller = new AbortController();
    const joinAtMs = 100;

    const first = settle(client.getJson(OTHER_URL));
    const abandoned = settle(client.getJson(URL, controller.signal, BACKGROUND));
    // the only caller leaves, and a new background request of the url starts at once
    controller.abort();
    const background = settle(client.getJson(URL, undefined, BACKGROUND));
    await jest.advanceTimersByTimeAsync(joinAtMs);
    const foreground = settle(client.getJson(URL));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await abandoned).toBeInstanceOf(CatalogAbortedError);
    expect([await first, await background, await foreground]).toEqual([PAYLOAD, PAYLOAD, PAYLOAD]);
    // the end of the abandoned request kept the new lane: the foreground caller promoted it
    expect(timesOf(requests)).toStrictEqual([joinAtMs]);
    await expectNoPendingTimer();
  });

  it('is not promoted by a foreground caller whose signal already aborted', async () => {
    recordRequests(OTHER_URL, answerPayload);
    const requests = recordRequests(URL, answerPayload);
    const client = createClient();
    const controller = new AbortController();
    controller.abort();

    const first = settle(client.getJson(OTHER_URL));
    const background = settle(client.getJson(URL, undefined, BACKGROUND));
    const left = settle(client.getJson(URL, controller.signal));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await left).toBeInstanceOf(CatalogAbortedError);
    expect([await first, await background]).toEqual([PAYLOAD, PAYLOAD]);
    expect(timesOf(requests)).toStrictEqual([BURST_INTERVAL_MS]);
    await expectNoPendingTimer();
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import { FIXED_NOW } from '../../../../test/core/fixed-clock';
import { server } from '../../../../test/core/msw-server';
import {
  CatalogAbortedError,
  CatalogHttpError,
  CatalogNetworkError,
  CatalogResponseError,
  CatalogTimeoutError,
} from '../../errors/catalog-errors';
import { createCatalogHttpClient, type CatalogHttpClientOptions } from './catalog-http-client';
import type { RateLimitPolicy } from './rate-limiter';
import { DEFAULT_RETRY_POLICY } from './retry-policy';

// smoke suite of the client; the exhaustive msw suites live next to it in their own files

const URL = 'https://catalog.test/anime/1';
const OTHER_URL = 'https://catalog.test/anime/2';
const PAYLOAD = { data: { mal_id: 1, title: 'Frieren' } };
// one request, then nothing for a minute: a second token would stall the test
const ONE_PER_MINUTE: RateLimitPolicy = { buckets: [{ capacity: 1, refillIntervalMs: 60_000 }] };
const UNLIMITED: RateLimitPolicy = { buckets: [{ capacity: 100, refillIntervalMs: 1 }] };
// first retry with random() = 0: half of the 1 s base delay
const FIRST_BACKOFF_MS = 500;
const TIMEOUT_MS = 1_000;
const RETRY_AFTER_S = 30;
const RETRY_AFTER_MS = 30_000;
const SINGLE_ATTEMPT = { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 };

const createClient = (options: Partial<CatalogHttpClientOptions> = {}) =>
  createCatalogHttpClient({ rateLimit: UNLIMITED, ...options });

// the outcome of a request, value or error, with its rejection handled from the start
const settle = (request: Promise<unknown>): Promise<unknown> =>
  request.catch((error: unknown) => error);

// lets msw finish its bookkeeping, then checks that nothing is left scheduled
const expectNoPendingTimer = async (): Promise<void> => {
  await jest.advanceTimersByTimeAsync(0);
  expect(jest.getTimerCount()).toBe(0);
};

// counts the requests to a url answered by the resolver
const countRequests = (url: string, resolver: (count: number) => Response | Promise<Response>) => {
  const counter = { requests: 0 };
  server.use(
    http.get(url, () => {
      counter.requests += 1;
      return resolver(counter.requests);
    }),
  );
  return counter;
};

const neverAnswer = (): Promise<Response> => new Promise<Response>(() => undefined);

describe('createCatalogHttpClient', () => {
  it('returns the parsed json body and asks for json', async () => {
    let accept: string | null = null;
    server.use(
      http.get(URL, ({ request }) => {
        accept = request.headers.get('Accept');
        return HttpResponse.json(PAYLOAD);
      }),
    );

    await expect(createClient().getJson(URL)).resolves.toEqual(PAYLOAD);
    expect(accept).toBe('application/json');
    await expectNoPendingTimer();
  });

  it('does not retry a client error', async () => {
    const counter = countRequests(URL, () => new HttpResponse(null, { status: 404 }));

    const failure = await settle(createClient().getJson(URL));

    expect(failure).toBeInstanceOf(CatalogHttpError);
    expect(failure).toMatchObject({ status: 404, retryAfterMs: null });
    expect(counter.requests).toBe(1);
    await expectNoPendingTimer();
  });

  it('retries a 429 after the backoff and succeeds', async () => {
    const counter = countRequests(URL, (count) =>
      count === 1 ? new HttpResponse(null, { status: 429 }) : HttpResponse.json(PAYLOAD),
    );

    const result = settle(createClient({ random: () => 0 }).getJson(URL));
    await jest.advanceTimersByTimeAsync(FIRST_BACKOFF_MS - 1);
    expect(counter.requests).toBe(1);
    await jest.advanceTimersByTimeAsync(1);

    expect(await result).toEqual(PAYLOAD);
    expect(counter.requests).toBe(2);
    await expectNoPendingTimer();
  });

  it('rejects a url that is not https before any request or token', async () => {
    server.use(http.get(URL, () => HttpResponse.json(PAYLOAD)));
    const client = createClient({ rateLimit: ONE_PER_MINUTE });

    const failure = await settle(client.getJson('http://catalog.test/anime/1?q=frieren'));

    expect(failure).toBeInstanceOf(RangeError);
    expect(String(failure)).not.toMatch(/catalog\.test|frieren/);
    // the only token of the minute is still there
    await expect(client.getJson(URL)).resolves.toEqual(PAYLOAD);
    await expectNoPendingTimer();
  });

  it('rejects a malformed body without retrying', async () => {
    const counter = countRequests(URL, () => new HttpResponse('{"data": ', { status: 200 }));

    const failure = await settle(createClient().getJson(URL));

    expect(failure).toBeInstanceOf(CatalogResponseError);
    expect(counter.requests).toBe(1);
    await expectNoPendingTimer();
  });

  it('retries a network error until the last attempt', async () => {
    const counter = countRequests(URL, () => HttpResponse.error());
    const client = createClient({
      random: () => 0,
      retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 },
    });

    const failure = settle(client.getJson(URL));
    await jest.advanceTimersByTimeAsync(FIRST_BACKOFF_MS);

    expect(await failure).toBeInstanceOf(CatalogNetworkError);
    expect(counter.requests).toBe(2);
    await expectNoPendingTimer();
  });

  it('fails with a timeout when the provider does not answer in time', async () => {
    countRequests(URL, neverAnswer);
    const client = createClient({ timeoutMs: TIMEOUT_MS, retry: SINGLE_ATTEMPT });

    const failure = settle(client.getJson(URL));
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(await failure).toBeInstanceOf(CatalogTimeoutError);
    expect(await failure).toMatchObject({ timeoutMs: TIMEOUT_MS });
    await expectNoPendingTimer();
  });

  it('times out on a body read that ignores the abort', async () => {
    // a fetch implementation whose body read never settles and does not listen to the signal
    const response = new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    jest.spyOn(response, 'json').mockReturnValue(new Promise<unknown>(() => undefined));
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const client = createClient({ timeoutMs: TIMEOUT_MS, retry: SINGLE_ATTEMPT });
    const done = jest.fn();

    const failure = settle(client.getJson(URL));
    void failure.then(done);
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(done).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(await failure).toBeInstanceOf(CatalogTimeoutError);
    await expectNoPendingTimer();
  });

  it('rejects at once when the caller aborts, and cancels the request', async () => {
    const counter = countRequests(URL, neverAnswer);
    const controller = new AbortController();

    const failure = settle(createClient().getJson(URL, controller.signal));
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();

    expect(await failure).toBeInstanceOf(CatalogAbortedError);
    expect(counter.requests).toBe(1);
    // the cancelled attempt cleared its timeout: no retry, nothing scheduled
    await expectNoPendingTimer();
  });

  it('sends nothing when the caller aborts right after its token is granted', async () => {
    countRequests(OTHER_URL, () => HttpResponse.json(PAYLOAD));
    const counter = countRequests(URL, () => HttpResponse.json(PAYLOAD));
    const client = createClient({
      rateLimit: { buckets: [{ capacity: 1, refillIntervalMs: TIMEOUT_MS }] },
    });
    await client.getJson(OTHER_URL);
    const controller = new AbortController();

    const failure = settle(client.getJson(URL, controller.signal));
    setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);
    // synchronous: the abort timer fires right after the grant, before the request can start
    jest.advanceTimersByTime(TIMEOUT_MS);

    expect(await failure).toBeInstanceOf(CatalogAbortedError);
    expect(counter.requests).toBe(0);
    await expectNoPendingTimer();
  });

  it('gives up when the next retry would start past the deadline', async () => {
    const counter = countRequests(URL, () => new HttpResponse(null, { status: 500 }));
    const client = createClient({
      random: () => 0,
      retry: { ...DEFAULT_RETRY_POLICY, retryDeadlineMs: FIRST_BACKOFF_MS - 1 },
    });

    const failure = await settle(client.getJson(URL));

    expect(failure).toMatchObject({ status: 500 });
    expect(counter.requests).toBe(1);
    await expectNoPendingTimer();
  });

  it('fails on a long Retry-After and pauses every request for it', async () => {
    countRequests(
      URL,
      () =>
        new HttpResponse(null, { status: 503, headers: { 'Retry-After': String(RETRY_AFTER_S) } }),
    );
    const other = countRequests(OTHER_URL, () => HttpResponse.json(PAYLOAD));
    const client = createClient();

    const failure = await settle(client.getJson(URL));
    const next = settle(client.getJson(OTHER_URL));
    await jest.advanceTimersByTimeAsync(RETRY_AFTER_MS - 1);
    expect(other.requests).toBe(0);
    await jest.advanceTimersByTimeAsync(1);

    expect(failure).toMatchObject({ status: 503, retryAfterMs: RETRY_AFTER_MS });
    expect(await next).toEqual(PAYLOAD);
    await expectNoPendingTimer();
  });

  it('reads a Retry-After date against the injected clock', async () => {
    countRequests(
      URL,
      () =>
        new HttpResponse(null, {
          status: 503,
          headers: { 'Retry-After': 'Thu, 01 Jan 2026 00:00:00 GMT' },
        }),
    );
    // the injected clock is 30 s behind the date the provider sends
    const client = createClient({ now: () => Date.now() - RETRY_AFTER_MS });

    const failure = await settle(client.getJson(URL));

    expect(Date.now()).toBe(FIXED_NOW);
    expect(failure).toMatchObject({ status: 503, retryAfterMs: RETRY_AFTER_MS });
    await expectNoPendingTimer();
  });
});

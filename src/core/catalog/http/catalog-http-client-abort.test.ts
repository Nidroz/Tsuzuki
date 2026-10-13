import { describe, expect, it, jest } from '@jest/globals';
import { delay, http, HttpResponse } from 'msw';

import { FIXED_NOW } from '../../../../test/core/fixed-clock';
import { server } from '../../../../test/core/msw-server';
import {
  CatalogAbortedError,
  CatalogNetworkError,
  CatalogTimeoutError,
} from '../../errors/catalog-errors';
import { createCatalogHttpClient, type CatalogHttpClientOptions } from './catalog-http-client';
import type { RateLimitPolicy } from './rate-limiter';
import { DEFAULT_RETRY_POLICY } from './retry-policy';

// aborts and timeouts at each stage of a call: queued for a token, sleeping before a retry,
// waiting for the headers, reading the body, and shared with other callers of the same url.
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
const RESPONSE_DELAY_MS = 100;
// longer than any retry sequence of these tests: whatever was left to send has been sent
const LONG_AFTER_MS = 60_000;

const createClient = (options: Partial<CatalogHttpClientOptions> = {}) =>
  createCatalogHttpClient({ rateLimit: UNLIMITED, random: () => 0, ...options });

const elapsed = (): number => Date.now() - FIXED_NOW;

// the outcome of a request, value or error, with its rejection handled from the start
const settle = (request: Promise<unknown>): Promise<unknown> =>
  request.catch((error: unknown) => error);

// lets msw finish its bookkeeping, then checks that nothing is left scheduled
const expectNoPendingTimer = async (): Promise<void> => {
  await jest.advanceTimersByTimeAsync(0);
  expect(jest.getTimerCount()).toBe(0);
};

// a request as the provider sees it
interface Dispatch {
  readonly at: number;
  readonly signal: AbortSignal;
}

// answers each request to url with answer(request, n), n from 1; returns what each one carried
const recordRequests = (
  url: string,
  answer: (request: Request, dispatch: number) => Response | Promise<Response>,
): Dispatch[] => {
  const dispatches: Dispatch[] = [];
  server.use(
    http.get(url, ({ request }) => {
      dispatches.push({ at: elapsed(), signal: request.signal });
      return answer(request, dispatches.length);
    }),
  );
  return dispatches;
};

const answerPayload = (): Response => HttpResponse.json(PAYLOAD);

const answerLater = async (): Promise<Response> => {
  await delay(RESPONSE_DELAY_MS);
  return HttpResponse.json(PAYLOAD);
};

const neverAnswer = (): Promise<Response> => new Promise<Response>(() => undefined);

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

describe('a caller joining a url during its backoff', () => {
  it.each([
    ['a 503', 503],
    ['a 429', 429],
  ])('gets the result of the shared retry after %s', async (_, status) => {
    const requests = recordRequests(URL, (_request, dispatch) =>
      dispatch === 1 ? new HttpResponse(null, { status }) : answerPayload(),
    );
    const client = createClient();

    const first = settle(client.getJson(URL));
    await jest.advanceTimersByTimeAsync(FIRST_BACKOFF_MS / 2);
    // the shared operation sleeps before its retry: the backoff is the only timer
    expect(jest.getTimerCount()).toBe(1);
    const joined = settle(client.getJson(URL, new AbortController().signal));
    await jest.advanceTimersByTimeAsync(FIRST_BACKOFF_MS / 2);

    expect(await Promise.all([first, joined])).toEqual([PAYLOAD, PAYLOAD]);
    // the joining caller sent nothing of its own
    expect(requests.map(({ at }) => at)).toStrictEqual([0, FIRST_BACKOFF_MS]);
    await expectNoPendingTimer();
  });

  it('stops the retry, with no timer left, once the joining caller left last', async () => {
    const requests = recordRequests(URL, (_, dispatch) =>
      dispatch === 1 ? new HttpResponse(null, { status: 503 }) : answerPayload(),
    );
    const client = createClient();
    const original = new AbortController();
    const joining = new AbortController();

    const left = settle(client.getJson(URL, original.signal));
    await jest.advanceTimersByTimeAsync(FIRST_BACKOFF_MS / 4);
    const joined = settle(client.getJson(URL, joining.signal));
    original.abort();
    expect(await left).toBeInstanceOf(CatalogAbortedError);
    // the joining caller keeps the backoff running
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(FIRST_BACKOFF_MS / 4);
    joining.abort();

    // no time passed: the abort itself rejected the last caller and cleared the sleep
    expect(await joined).toBeInstanceOf(CatalogAbortedError);
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

describe('callers sharing a url', () => {
  it.each([
    ['with a signal', new AbortController().signal],
    ['without a signal', undefined],
  ])('keep one request alive for a caller %s when the other aborts', async (_, signal) => {
    const requests = recordRequests(URL, answerLater);
    const client = createClient();
    const leaving = new AbortController();

    const stayed = settle(client.getJson(URL, signal));
    const left = settle(client.getJson(URL, leaving.signal));
    await jest.advanceTimersByTimeAsync(RESPONSE_DELAY_MS / 2);
    leaving.abort();
    expect(await left).toBeInstanceOf(CatalogAbortedError);
    // checked in flight: a settled attempt releases its request
    expect(requests[0]?.signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(RESPONSE_DELAY_MS / 2);

    expect(await stayed).toEqual(PAYLOAD);
    expect(requests).toHaveLength(1);
    await expectNoPendingTimer();
  });

  it('cancel the request once all of them left, and a later call sends a new one', async () => {
    const requests = recordRequests(URL, (_, dispatch) =>
      dispatch === 1 ? neverAnswer() : answerPayload(),
    );
    const client = createClient();
    const first = new AbortController();
    const second = new AbortController();

    const left = Promise.all([
      settle(client.getJson(URL, first.signal)),
      settle(client.getJson(URL, second.signal)),
    ]);
    await jest.advanceTimersByTimeAsync(RESPONSE_DELAY_MS);
    first.abort();
    expect(requests[0]?.signal.aborted).toBe(false);
    second.abort();
    expect(await left).toEqual([expect.any(CatalogAbortedError), expect.any(CatalogAbortedError)]);
    expect(requests[0]?.signal.aborted).toBe(true);

    await expect(client.getJson(URL)).resolves.toEqual(PAYLOAD);
    expect(requests.map(({ at }) => at)).toStrictEqual([0, RESPONSE_DELAY_MS]);
    await expectNoPendingTimer();
  });
});

// the attempt aborts its own transfer once settled: the unread body of a non-2xx response would
// hold the connection on undici and in browsers
describe('a settled attempt', () => {
  it('releases the transfer of a non-2xx response once the call rejected', async () => {
    recordRequests(URL, async () => {
      await delay(RESPONSE_DELAY_MS);
      return HttpResponse.json({ message: 'Resource does not exist' }, { status: 404 });
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const result = settle(createClient().getJson(URL));
    await jest.advanceTimersByTimeAsync(RESPONSE_DELAY_MS / 2);
    const signal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(RESPONSE_DELAY_MS / 2);

    expect(await result).toMatchObject({ status: 404 });
    expect(signal?.aborted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expectNoPendingTimer();
  });

  it('releases the transfer of a 2xx response only after its body was read', async () => {
    recordRequests(URL, answerPayload);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(createClient().getJson(URL)).resolves.toEqual(PAYLOAD);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expectNoPendingTimer();
  });
});

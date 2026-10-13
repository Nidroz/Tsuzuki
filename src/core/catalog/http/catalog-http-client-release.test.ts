import { describe, expect, it, jest } from '@jest/globals';
import { delay, http, HttpResponse } from 'msw';

import { FIXED_NOW } from '../../../../test/core/fixed-clock';
import { server } from '../../../../test/core/msw-server';
import { CatalogAbortedError } from '../../errors/catalog-errors';
import { createCatalogHttpClient, type CatalogHttpClientOptions } from './catalog-http-client';
import type { RateLimitPolicy } from './rate-limiter';

// how long a request lives: callers of the same url share it, through its backoff too, it stays
// alive while one of them waits and is cancelled once the last one left, and a settled attempt
// releases its transfer. a rejection left unhandled fails the test that left it (jest-circus
// watches the real process; the sandbox `process` is a copy whose listeners never fire)

const URL = 'https://catalog.test/anime/1';
const PAYLOAD = { data: { mal_id: 1, title: 'Frieren' } };
const UNLIMITED: RateLimitPolicy = { buckets: [{ capacity: 100, refillIntervalMs: 1 }] };
// first retry with random() = 0: half of the 1 s base delay
const FIRST_BACKOFF_MS = 500;
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

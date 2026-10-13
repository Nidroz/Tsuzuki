import { describe, expect, it, jest } from '@jest/globals';
import { delay } from 'msw';

import { server } from '../../../../test/core/msw-server';
import {
  CatalogAbortedError,
  CatalogHttpError,
  CatalogResponseError,
  CatalogTimeoutError,
} from '../../errors/catalog-errors';
import { JIKAN_ENDPOINTS, SEARCH_ENDPOINT } from './__fixtures__/jikan-endpoints';
import {
  JIKAN_BASE,
  firstThen,
  jikanError,
  jikanHandler,
  jsonAnswer,
  neverAnswer,
  notJsonAnswer,
  type JikanAnswer,
  type JikanRequest,
} from './__fixtures__/jikan-handlers';
import { createJikanCatalogProvider } from './jikan-catalog-provider';

// the scenario matrix of every endpoint (CONTRIBUTING.md §6): success, empty, 429, timeout and
// malformed payload, through the provider, its http client and msw on the real jikan urls.
// random() = 0: a retry comes 0.5 s, 1 s, then 2 s after a failure

// query parameters that would filter content at the provider (ADR-0004)
const CONTENT_FILTER_PARAMS = ['sfw', 'rating', 'unapproved', 'continuing'];
const FIRST_RETRY_AT_MS = 500;
// a persistent failure: 4 attempts, 0.5 s, 1 s and 2 s apart
const ATTEMPTS_AT_MS = [0, 500, 1_500, 3_500];
const TIMEOUT_MS = 10_000;
// 10 s attempts, 0.5 s apart: a third would start past the 20 s retry deadline
const TIMED_OUT_ATTEMPTS_AT_MS = [0, 10_500];
// longer than any retry sequence: whatever was left to send has been sent
const LONG_AFTER_MS = 60_000;

const createProvider = () => createJikanCatalogProvider({ random: () => 0 });

// installs a jikan handler on the msw server and returns the requests it answers
const serveJikan = (path: string, answer: JikanAnswer): readonly JikanRequest[] => {
  const { handler, requests } = jikanHandler(path, answer);
  server.use(handler);
  return requests;
};

// the outcome of a call, value or error, with its rejection handled from the start
const settle = (call: Promise<unknown>): Promise<unknown> => call.catch((error: unknown) => error);

const timesOf = (requests: readonly JikanRequest[]): number[] => requests.map(({ at }) => at);

// lets msw finish its bookkeeping, then checks that nothing is left scheduled
const expectNoPendingTimer = async (): Promise<void> => {
  await jest.advanceTimersByTimeAsync(0);
  expect(jest.getTimerCount()).toBe(0);
};

describe.each(JIKAN_ENDPOINTS)('$name', ({ scenarios, empty, mismatch }) => {
  const [main] = scenarios;

  it.each(scenarios)(
    'normalizes $label, requested without a content filter',
    async ({ path, url, limit, call, body, expected }) => {
      const requests = serveJikan(path, jsonAnswer(body));

      expect(await call(createProvider())).toMatchObject(expected);
      expect(requests.map((request) => request.url)).toStrictEqual([url]);
      const sent = new URL(requests[0]?.url ?? url);
      expect(sent.searchParams.get('limit')).toBe(limit);
      expect(
        [...sent.searchParams.keys()].filter((name) => CONTENT_FILTER_PARAMS.includes(name)),
      ).toStrictEqual([]);
    },
  );

  it(`maps ${empty.label}, sent once`, async () => {
    const requests = serveJikan(main.path, empty.answer);

    const outcome = settle(main.call(createProvider()));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await outcome).toMatchObject(empty.expected);
    expect(requests).toHaveLength(1);
    await expectNoPendingTimer();
  });

  it('retries a 429 after the backoff and returns the next answer', async () => {
    const requests = serveJikan(
      main.path,
      firstThen(1, () => jikanError(429), jsonAnswer(main.body)),
    );

    const outcome = settle(main.call(createProvider()));
    await jest.advanceTimersByTimeAsync(FIRST_RETRY_AT_MS - 1);
    expect(requests).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await outcome).toMatchObject(main.expected);
    expect(timesOf(requests)).toStrictEqual([0, FIRST_RETRY_AT_MS]);
    await expectNoPendingTimer();
  });

  it('fails with the 429 once every attempt was rate limited', async () => {
    const requests = serveJikan(main.path, () => jikanError(429));

    const outcome = settle(main.call(createProvider()));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    const error = await outcome;
    expect(error).toBeInstanceOf(CatalogHttpError);
    expect(error).toMatchObject({ status: 429 });
    expect(timesOf(requests)).toStrictEqual(ATTEMPTS_AT_MS);
    await expectNoPendingTimer();
  });

  it('fails with a timeout once the retries are spent', async () => {
    const requests = serveJikan(main.path, async () => {
      await delay('infinite');
      return jikanError(500);
    });

    const outcome = settle(main.call(createProvider()));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    const error = await outcome;
    expect(error).toBeInstanceOf(CatalogTimeoutError);
    expect(error).toMatchObject({ timeoutMs: TIMEOUT_MS });
    expect(timesOf(requests)).toStrictEqual(TIMED_OUT_ATTEMPTS_AT_MS);
    expect(requests.map(({ signal }) => signal.aborted)).toStrictEqual([true, true]);
    // the client cleared its timeouts and scheduled nothing: the only timers left are msw's
    // infinite delays, one per attempt. once they run out, nothing else is sent
    expect(jest.getTimerCount()).toBe(requests.length);
    await jest.runOnlyPendingTimersAsync();
    expect(requests).toHaveLength(TIMED_OUT_ATTEMPTS_AT_MS.length);
    await expectNoPendingTimer();
  });

  it.each([
    ['a body that is not json', notJsonAnswer('<html>Service Unavailable</html>')],
    [mismatch.label, jsonAnswer(mismatch.body)],
  ])('rejects %s as malformed, without a retry', async (_, answer) => {
    const requests = serveJikan(main.path, answer);

    const outcome = settle(main.call(createProvider()));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await outcome).toBeInstanceOf(CatalogResponseError);
    expect(requests).toHaveLength(1);
    await expectNoPendingTimer();
  });
});

describe('a caller abort while the request is in flight', () => {
  it('rejects with CatalogAbortedError, cancels the request and leaves no timer', async () => {
    const [scenario] = SEARCH_ENDPOINT.scenarios;
    const requests = serveJikan(scenario.path, neverAnswer);
    const controller = new AbortController();

    const outcome = settle(scenario.call(createProvider(), controller.signal));
    await jest.advanceTimersByTimeAsync(0);
    expect(requests[0]?.signal.aborted).toBe(false);
    controller.abort();

    expect(await outcome).toBeInstanceOf(CatalogAbortedError);
    expect(requests[0]?.signal.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);
    expect(requests).toHaveLength(1);
    await expectNoPendingTimer();
  });
});

describe('identical concurrent searches', () => {
  it('share one request', async () => {
    const [scenario] = SEARCH_ENDPOINT.scenarios;
    const requests = serveJikan(scenario.path, jsonAnswer(scenario.body));
    const provider = createProvider();

    // equivalent params build the same url
    const [first, second] = await Promise.all([
      provider.search({ kind: 'anime', query: 'Sample', genresIncluded: [1, 4], page: 2 }),
      provider.search({ kind: 'anime', query: ' Sample ', genresIncluded: [4, 1, 4], page: 2 }),
    ]);

    expect(second).toStrictEqual(first);
    expect(first.items.map(({ key }) => key)).toStrictEqual([{ kind: 'anime', malId: 5114 }]);
    expect(requests.map(({ url }) => url)).toStrictEqual([
      `${JIKAN_BASE}/anime?q=Sample&genres=1,4&page=2&limit=25`,
    ]);
    await expectNoPendingTimer();
  });
});

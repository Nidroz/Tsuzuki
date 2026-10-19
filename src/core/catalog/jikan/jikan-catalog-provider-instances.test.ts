import { describe, expect, it, jest } from '@jest/globals';

import { settle } from '../../../../test/core/catalog-http-test-support';
import { server } from '../../../../test/core/msw-server';
import { CatalogAbortedError } from '../../errors/catalog-errors';
import type { CatalogProvider } from '../catalog-provider';
import { DEFAULT_RETRY_POLICY } from '../http/retry-policy';
import {
  buildJikanAnime,
  buildJikanDetail,
  buildJikanGenres,
  buildJikanManga,
  buildJikanPage,
} from './__fixtures__/jikan-builders';
import {
  TENRAI_BASE,
  jikanHandler,
  jsonAnswer,
  neverAnswer,
  type JikanAnswer,
  type JikanRequest,
} from './__fixtures__/jikan-handlers';
import {
  createJikanCatalogProvider,
  type JikanCatalogProviderOptions,
} from './jikan-catalog-provider';
import { TENRAI_INSTANCE, selfHostedJikanInstance, type JikanInstance } from './jikan-instances';
import { JIKAN_GENRE_IDS_MAX, JIKAN_QUERY_MAX_LENGTH } from './jikan-urls';

// the instance wiring of the factory: each provider sends to its own instance, under its own rate
// limit, with its own limiter, and names its instance without its url

const SELF_HOSTED_BASE = 'https://jikan.example.test/v4';
const SELF_HOSTED = selfHostedJikanInstance(SELF_HOSTED_BASE);
// what the instance id must look like (CatalogProvider.instanceId)
const INSTANCE_ID_PATTERN = /^[a-z0-9-]+$/;
// both policies grant 2 requests at once
const BURST = 2;
const MINUTE_MS = 60_000;
// more than either policy grants in a minute
const BACKLOG = 90;
// longer than the backlog test: no attempt times out, none is retried
const NO_TIMEOUT: JikanCatalogProviderOptions = {
  timeoutMs: 2 * MINUTE_MS,
  retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 },
};

// installs a handler on the msw server and returns the requests it answers
const serveOn = (base: string, path: string, answer: JikanAnswer): readonly JikanRequest[] => {
  const { handler, requests } = jikanHandler(path, answer, base);
  server.use(handler);
  return requests;
};

// `count` detail calls of distinct anime ids from `firstId`, all cancelled by `signal`
const detailCalls = (
  provider: CatalogProvider,
  firstId: number,
  count: number,
  signal: AbortSignal,
): Promise<unknown>[] =>
  Array.from({ length: count }, (_, index) =>
    settle(
      provider.getDetail({ namespace: 'mal', kind: 'anime', externalId: firstId + index }, signal),
    ),
  );

// aborts every call left and checks that each one ends as aborted
const abortAll = async (
  controller: AbortController,
  calls: readonly Promise<unknown>[],
): Promise<void> => {
  controller.abort();
  for (const outcome of await Promise.all(calls)) {
    expect(outcome).toBeInstanceOf(CatalogAbortedError);
  }
};

describe('the instance of a jikan provider', () => {
  it.each<[string, JikanInstance, string]>([
    ['tenrai', TENRAI_INSTANCE, 'tenrai'],
    ['a self-hosted instance', SELF_HOSTED, 'jikan-self-hosted'],
  ])('names %s and serves the mal namespace', (_, instance, instanceId) => {
    const provider = createJikanCatalogProvider(instance);

    expect(provider.namespace).toBe('mal');
    expect(provider.instanceId).toBe(instanceId);
    expect(provider.instanceId).toMatch(INSTANCE_ID_PATTERN);
    expect(provider.searchQueryMaxLength).toBe(JIKAN_QUERY_MAX_LENGTH);
    expect(provider.searchGenresMax).toBe(JIKAN_GENRE_IDS_MAX);
  });

  it('sends every request of a self-hosted instance to its own base url', async () => {
    const tenrai = serveOn(TENRAI_BASE, '/*', jsonAnswer({}));
    const detail = serveOn(
      SELF_HOSTED_BASE,
      '/manga/201',
      jsonAnswer(buildJikanDetail(buildJikanManga())),
    );
    const search = serveOn(
      SELF_HOSTED_BASE,
      '/anime',
      jsonAnswer(buildJikanPage([buildJikanAnime()])),
    );
    const top = serveOn(SELF_HOSTED_BASE, '/top/anime', jsonAnswer(buildJikanPage([])));
    const season = serveOn(SELF_HOSTED_BASE, '/seasons/now', jsonAnswer(buildJikanPage([])));
    const genres = serveOn(SELF_HOSTED_BASE, '/genres/manga', jsonAnswer(buildJikanGenres([])));
    const provider = createJikanCatalogProvider(SELF_HOSTED);

    const results = Promise.all([
      provider.getDetail({ namespace: 'mal', kind: 'manga', externalId: 201 }),
      provider.search({ kind: 'anime', query: 'sample', page: 1 }),
      provider.getTop({ kind: 'anime', page: 2 }),
      provider.getCurrentSeason(1),
      provider.getGenres('manga'),
    ]);
    // the 5 requests wait for the per second bucket
    await jest.advanceTimersByTimeAsync(MINUTE_MS);
    const [detailResult] = await results;

    expect(detailResult.key).toStrictEqual({ namespace: 'mal', kind: 'manga', externalId: 201 });
    expect(
      [...detail, ...search, ...top, ...season, ...genres].map(({ url }) => url),
    ).toStrictEqual([
      `${SELF_HOSTED_BASE}/manga/201`,
      `${SELF_HOSTED_BASE}/anime?q=sample&page=1&limit=25`,
      `${SELF_HOSTED_BASE}/top/anime?page=2&limit=25`,
      `${SELF_HOSTED_BASE}/seasons/now?page=1&limit=25`,
      `${SELF_HOSTED_BASE}/genres/manga`,
    ]);
    expect(tenrai).toHaveLength(0);
  });
});

describe('the limiter of a jikan provider', () => {
  it.each<[string, JikanInstance, JikanInstance]>([
    ['two providers of one instance', TENRAI_INSTANCE, TENRAI_INSTANCE],
    ['providers of two instances', TENRAI_INSTANCE, SELF_HOSTED],
  ])('is never shared between %s', async (_, firstInstance, secondInstance) => {
    const firstRequests = serveOn(firstInstance.baseUrl, '/anime/:id', neverAnswer);
    const secondRequests =
      secondInstance === firstInstance
        ? firstRequests
        : serveOn(secondInstance.baseUrl, '/anime/:id', neverAnswer);
    const first = createJikanCatalogProvider(firstInstance, NO_TIMEOUT);
    const second = createJikanCatalogProvider(secondInstance, NO_TIMEOUT);
    const controller = new AbortController();

    // the first provider spends its burst and queues 3 more
    const queued = detailCalls(first, 1, BURST + 3, controller.signal);
    await jest.advanceTimersByTimeAsync(0);
    const fromFirst = firstRequests.length;
    // the second one still sends at once, ahead of that queue
    const others = detailCalls(second, 100, BURST, controller.signal);
    await jest.advanceTimersByTimeAsync(0);

    expect(fromFirst).toBe(BURST);
    const sentBySecond = secondRequests.filter(
      ({ url }) => url.endsWith('/anime/100') || url.endsWith('/anime/101'),
    );
    expect(sentBySecond.map(({ at }) => at)).toStrictEqual([0, 0]);
    await abortAll(controller, [...queued, ...others]);
  });

  it.each<[string, JikanInstance, number]>([
    // capacity 2 + 60 s / 750 ms
    ['tenrai', TENRAI_INSTANCE, 82],
    // capacity 10 + 60 s / 1.5 s
    ['a self-hosted instance', SELF_HOSTED, 50],
  ])('applies the rate limit of %s', async (_, instance, perMinute) => {
    const requests = serveOn(instance.baseUrl, '/anime/:id', neverAnswer);
    const provider = createJikanCatalogProvider(instance, NO_TIMEOUT);
    const controller = new AbortController();

    const calls = detailCalls(provider, 1, BACKLOG, controller.signal);
    await jest.advanceTimersByTimeAsync(MINUTE_MS);

    expect(requests).toHaveLength(perMinute);
    await abortAll(controller, calls);
  });
});

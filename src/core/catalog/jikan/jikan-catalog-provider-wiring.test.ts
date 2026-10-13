import { describe, expect, it, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import {
  CatalogAbortedError,
  CatalogHttpError,
  CatalogResponseError,
  CatalogTimeoutError,
} from '../../errors/catalog-errors';
import { DEFAULT_RETRY_POLICY } from '../http/retry-policy';
import {
  buildJikanAnime,
  buildJikanDetail,
  buildJikanGenres,
  buildJikanManga,
  buildJikanPage,
} from './__fixtures__/jikan-builders';
import {
  createJikanCatalogProvider,
  type JikanCatalogProviderOptions,
} from './jikan-catalog-provider';

// the wiring of the factory: urls, client, signal and errors. the scenario matrix per endpoint
// lives in jikan-catalog-provider.test.ts

const BASE = 'https://api.jikan.moe/v4';
const TIMEOUT_MS = 1_000;
// the jikan policy grants 2 requests at once, then one every 750 ms
const BURST = 2;
const REFILL_MS = 750;

// the outcome of a call, value or error, with its rejection handled from the start
const settle = (call: Promise<unknown>): Promise<unknown> => call.catch((error: unknown) => error);

const neverAnswer = (): Promise<Response> => new Promise<Response>(() => undefined);

// answers `path` with `body` and records the full url of every request
const serve = (path: string, body: Record<string, unknown>) => {
  const urls: string[] = [];
  server.use(
    http.get(`${BASE}${path}`, ({ request }) => {
      urls.push(request.url);
      return HttpResponse.json(body);
    }),
  );
  return urls;
};

describe('createJikanCatalogProvider', () => {
  it('is the jikan provider', () => {
    expect(createJikanCatalogProvider().id).toBe('jikan');
  });

  it('loads a detail', async () => {
    const urls = serve('/manga/201', buildJikanDetail(buildJikanManga()));

    const detail = await createJikanCatalogProvider().getDetail({ kind: 'manga', malId: 201 });

    expect(detail).toMatchObject({ key: { kind: 'manga', malId: 201 }, title: 'Sample Manga' });
    expect(urls).toStrictEqual([`${BASE}/manga/201`]);
  });

  it('searches with the normalized url and returns the requested page', async () => {
    const urls = serve(
      '/anime',
      buildJikanPage([buildJikanAnime()], { last_visible_page: 4, has_next_page: true }),
    );

    const page = await createJikanCatalogProvider().search({
      kind: 'anime',
      query: ' sample ',
      genresIncluded: [4, 1],
      page: 2,
    });

    expect(urls).toStrictEqual([`${BASE}/anime?q=sample&genres=1,4&page=2&limit=25`]);
    expect(page).toMatchObject({ page: 2, lastPage: 4, hasNextPage: true });
    expect(page.items.map((item) => item.key)).toStrictEqual([{ kind: 'anime', malId: 101 }]);
  });

  it('loads the top, the current season and the genres', async () => {
    const top = serve('/top/manga', buildJikanPage([buildJikanManga()]));
    const season = serve('/seasons/now', buildJikanPage([buildJikanAnime()]));
    const genres = serve('/genres/anime', buildJikanGenres([[1, 'Action']]));
    const provider = createJikanCatalogProvider();

    const results = Promise.all([
      provider.getTop('manga', 1),
      provider.getCurrentSeason(3),
      provider.getGenres('anime'),
    ]);
    // the third request waits for its token
    await jest.advanceTimersByTimeAsync(REFILL_MS);
    const [topPage, seasonPage, genreList] = await results;

    expect(topPage).toMatchObject({ page: 1, items: [{ key: { kind: 'manga', malId: 201 } }] });
    expect(seasonPage).toMatchObject({ page: 3, items: [{ key: { kind: 'anime', malId: 101 } }] });
    expect(genreList).toStrictEqual([{ id: 1, name: 'Action' }]);
    expect([...top, ...season, ...genres]).toStrictEqual([
      `${BASE}/top/manga?page=1&limit=25`,
      `${BASE}/seasons/now?page=3&limit=25`,
      `${BASE}/genres/anime`,
    ]);
  });

  it('passes the caller signal to the request', async () => {
    server.use(http.get(`${BASE}/anime/101`, neverAnswer));
    const controller = new AbortController();

    const result = settle(
      createJikanCatalogProvider().getDetail({ kind: 'anime', malId: 101 }, controller.signal),
    );
    controller.abort();

    expect(await result).toBeInstanceOf(CatalogAbortedError);
  });

  it('passes the http client errors through and maps a malformed body', async () => {
    server.use(
      http.get(`${BASE}/anime/101`, () => new HttpResponse(null, { status: 404 })),
      http.get(`${BASE}/anime/102`, () => HttpResponse.json({ data: { mal_id: 102 } })),
    );
    const provider = createJikanCatalogProvider();

    const [notFound, malformed] = await Promise.all([
      settle(provider.getDetail({ kind: 'anime', malId: 101 })),
      settle(provider.getDetail({ kind: 'anime', malId: 102 })),
    ]);

    expect(notFound).toBeInstanceOf(CatalogHttpError);
    expect(notFound).toMatchObject({ status: 404 });
    expect(malformed).toBeInstanceOf(CatalogResponseError);
  });

  it('rejects invalid input before any request', async () => {
    // no handler: a request would reach msw and fail as unhandled
    const provider = createJikanCatalogProvider();

    await expect(provider.search({ kind: 'anime', page: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(provider.getDetail({ kind: 'anime', malId: 0 })).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  it('hands its options to the http client', async () => {
    server.use(http.get(`${BASE}/anime/101`, neverAnswer));
    const provider = createJikanCatalogProvider({
      timeoutMs: TIMEOUT_MS,
      retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 },
    });

    const result = settle(provider.getDetail({ kind: 'anime', malId: 101 }));
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(await result).toBeInstanceOf(CatalogTimeoutError);
  });

  it('always applies the jikan rate limit', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${BASE}/anime/:id`, ({ request }) => {
        urls.push(request.url);
        return neverAnswer();
      }),
    );
    // an untyped caller cannot loosen the limit either
    const options = { rateLimit: { buckets: [] } } as unknown as JikanCatalogProviderOptions;
    const provider = createJikanCatalogProvider(options);
    const controller = new AbortController();

    const results = [1, 2, 3].map((malId) =>
      settle(provider.getDetail({ kind: 'anime', malId }, controller.signal)),
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(urls).toHaveLength(BURST);
    await jest.advanceTimersByTimeAsync(REFILL_MS);
    expect(urls).toHaveLength(BURST + 1);

    controller.abort();
    expect(await Promise.all(results)).toStrictEqual([
      expect.any(CatalogAbortedError),
      expect.any(CatalogAbortedError),
      expect.any(CatalogAbortedError),
    ]);
  });
});

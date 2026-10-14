import { describe, expect, it, jest } from '@jest/globals';

import { server } from '../../../../test/core/msw-server';
import type { MediaIdNamespace } from '../../domain/media';
import {
  CatalogHttpError,
  CatalogResponseError,
  CatalogTimeoutError,
} from '../../errors/catalog-errors';
import type { CatalogProvider } from '../catalog-provider';
import {
  buildJikanAnime,
  buildJikanDetail,
  buildJikanManga,
  buildJikanPage,
  genreRef,
} from './__fixtures__/jikan-builders';
import {
  TENRAI_BASE,
  jikanError,
  jikanHandler,
  jsonAnswer,
  neverAnswer,
  notJsonAnswer,
  type JikanAnswer,
  type JikanRequest,
} from './__fixtures__/jikan-handlers';
import { createJikanCatalogProvider } from './jikan-catalog-provider';
import { TENRAI_INSTANCE } from './jikan-instances';

// security proofs through the provider, its http client and msw on the real tenrai urls: the
// BR-06 flag, errors that carry no search text nor provider text, the cover host allowlist, and
// invalid input rejected before any request

const SECRET_QUERY = 'secret query 42';
// short enough for a json parse error to quote it whole
const PROVIDER_TEXT = 'upstream 7f3a';
// what an error reaching the error reporter must never hold
const LEAK_MARKERS = [
  SECRET_QUERY,
  encodeURIComponent(SECRET_QUERY),
  'api.tenrai.org',
  PROVIDER_TEXT,
];
const CDN = 'https://cdn.myanimelist.net/images/anime/1';
// longer than any retry sequence: whatever was left to send has been sent
const LONG_AFTER_MS = 60_000;
// one more than the tenrai maximum per genre filter
const TOO_MANY_GENRES = Array.from({ length: 26 }, (_, index) => index + 1);
// a namespace no jikan instance serves, as an untyped caller could pass it
const OTHER_NAMESPACE = 'anilist' as MediaIdNamespace;

const createProvider = () => createJikanCatalogProvider(TENRAI_INSTANCE, { random: () => 0 });

// installs a jikan handler on the msw server and returns the requests it answers
const serveJikan = (path: string, answer: JikanAnswer): readonly JikanRequest[] => {
  const { handler, requests } = jikanHandler(path, answer);
  server.use(handler);
  return requests;
};

// the outcome of a call, value or error, with its rejection handled from the start
const settle = (call: Promise<unknown>): Promise<unknown> => call.catch((error: unknown) => error);

const asError = (value: unknown): Error => {
  if (!(value instanceof Error)) {
    throw new TypeError('the call did not fail with an error');
  }
  return value;
};

// every text an error reporter can read: String(error), the message, the stack and every own
// property, enumerable or not
const reportableTextOf = (error: Error): string =>
  [
    String(error),
    error.message,
    error.stack ?? '',
    JSON.stringify(error),
    ...Object.getOwnPropertyNames(error).map((name) =>
      String(Object.getOwnPropertyDescriptor(error, name)?.value),
    ),
  ].join('\n');

const leaksOf = (error: Error): string[] => {
  const text = reportableTextOf(error);
  return LEAK_MARKERS.filter((marker) => text.includes(marker));
};

// lets msw finish its bookkeeping, then checks that nothing is left scheduled
const expectNoPendingTimer = async (): Promise<void> => {
  await jest.advanceTimersByTimeAsync(0);
  expect(jest.getTimerCount()).toBe(0);
};

describe('the BR-06 adult flag', () => {
  it('flags an Rx rated anime and one with Hentai only in explicit_genres, on an unfiltered search', async () => {
    const requests = serveJikan(
      '/anime',
      jsonAnswer(
        buildJikanPage([
          buildJikanAnime({ mal_id: 1, rating: 'Rx - Hentai' }),
          buildJikanAnime({
            mal_id: 2,
            rating: 'R+ - Mild Nudity',
            explicit_genres: [genreRef(12, 'Hentai')],
          }),
          buildJikanAnime({ mal_id: 3 }),
        ]),
      ),
    );

    const page = await createProvider().search({ kind: 'anime', page: 1 });

    expect(page.items.map(({ key, isAdult }) => [key.externalId, isAdult])).toStrictEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
    // everything is fetched: the request carries no content filter
    expect(requests.map(({ url }) => url)).toStrictEqual([`${TENRAI_BASE}/anime?page=1&limit=25`]);
  });

  it('flags a manga detail with Erotica in explicit_genres', async () => {
    serveJikan(
      '/manga/201',
      jsonAnswer(
        buildJikanDetail(buildJikanManga({ explicit_genres: [genreRef(49, 'Erotica', 'manga')] })),
      ),
    );

    const detail = await createProvider().getDetail({
      namespace: 'mal',
      kind: 'manga',
      externalId: 201,
    });

    expect(detail.isAdult).toBe(true);
    expect(detail.genres).toContainEqual({ id: 49, name: 'Erotica' });
  });
});

describe('a failed search', () => {
  it.each([
    ['a 500 on every attempt', () => jikanError(500, PROVIDER_TEXT), CatalogHttpError],
    ['a body that is not json', notJsonAnswer(PROVIDER_TEXT), CatalogResponseError],
    [
      'a schema mismatch',
      jsonAnswer(buildJikanPage([buildJikanAnime({ status: PROVIDER_TEXT })])),
      CatalogResponseError,
    ],
    ['a timeout on every attempt', neverAnswer, CatalogTimeoutError],
  ])(
    'reports %s without the search text, the host or any provider text',
    async (_, answer, errorClass) => {
      const requests = serveJikan('/anime', answer);

      const outcome = settle(
        createProvider().search({ kind: 'anime', query: SECRET_QUERY, page: 1 }),
      );
      await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);
      const error = asError(await outcome);

      expect(error).toBeInstanceOf(errorClass);
      // the request did carry the search text
      expect(requests[0]?.url).toContain(encodeURIComponent(SECRET_QUERY));
      expect(leaksOf(error)).toStrictEqual([]);
      expect(error).not.toHaveProperty('cause');
      await expectNoPendingTimer();
    },
  );
});

describe('the cover image', () => {
  const detailWithImages = (webpLarge: string, jpgLarge: string, jpg: string) =>
    buildJikanDetail(
      buildJikanAnime({
        images: {
          jpg: { image_url: jpg, small_image_url: jpg, large_image_url: jpgLarge },
          webp: { image_url: webpLarge, small_image_url: webpLarge, large_image_url: webpLarge },
        },
      }),
    );

  it.each([
    [
      'the cdn jpg url after a webp url on another host',
      detailWithImages(
        'https://images.example.org/anime/1/101l.webp',
        `${CDN}/101l.jpg`,
        `${CDN}/101.jpg`,
      ),
      `${CDN}/101l.jpg`,
    ],
    [
      'no url when every url is http',
      detailWithImages(
        'http://cdn.myanimelist.net/images/anime/1/101l.webp',
        'http://cdn.myanimelist.net/images/anime/1/101l.jpg',
        'http://cdn.myanimelist.net/images/anime/1/101.jpg',
      ),
      null,
    ],
    [
      'no url when every host only looks like the cdn',
      detailWithImages(
        'https://cdn.myanimelist.net.example.org/images/anime/1/101l.webp',
        'https://cdn.myanimelist.net@example.org/images/anime/1/101l.jpg',
        'https://cdn.myanimelist.net:8443/images/anime/1/101.jpg',
      ),
      null,
    ],
  ])('keeps %s', async (_, body, imageUrl) => {
    serveJikan('/anime/101', jsonAnswer(body));

    const detail = await createProvider().getDetail({
      namespace: 'mal',
      kind: 'anime',
      externalId: 101,
    });

    expect(detail.imageUrl).toBe(imageUrl);
  });
});

describe('invalid input', () => {
  it.each([
    [
      'a search page of 0',
      (provider: CatalogProvider) =>
        provider.search({ kind: 'anime', query: SECRET_QUERY, page: 0 }),
    ],
    [
      'a search with two formats',
      (provider: CatalogProvider) =>
        provider.search({ kind: 'anime', query: SECRET_QUERY, formats: ['tv', 'movie'], page: 1 }),
    ],
    ['a top page of 0', (provider: CatalogProvider) => provider.getTop('manga', 0)],
    ['a season page of 1.5', (provider: CatalogProvider) => provider.getCurrentSeason(1.5)],
    [
      'a search text over 300 characters',
      (provider: CatalogProvider) =>
        provider.search({ kind: 'anime', query: SECRET_QUERY.padEnd(301, 'x'), page: 1 }),
    ],
    [
      'a search with 26 included genres',
      (provider: CatalogProvider) =>
        provider.search({
          kind: 'anime',
          query: SECRET_QUERY,
          genresIncluded: TOO_MANY_GENRES,
          page: 1,
        }),
    ],
    [
      'a search with 26 excluded genres',
      (provider: CatalogProvider) =>
        provider.search({
          kind: 'manga',
          query: SECRET_QUERY,
          genresExcluded: TOO_MANY_GENRES,
          page: 1,
        }),
    ],
    [
      'a detail of another id namespace',
      (provider: CatalogProvider) =>
        provider.getDetail({ namespace: OTHER_NAMESPACE, kind: 'anime', externalId: 101 }),
    ],
  ])('rejects %s with a RangeError and sends nothing', async (_, call) => {
    const requests = serveJikan('/*', jsonAnswer({}));

    const error = asError(await settle(call(createProvider())));
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(error).toBeInstanceOf(RangeError);
    expect(leaksOf(error)).toStrictEqual([]);
    expect(requests).toHaveLength(0);
    await expectNoPendingTimer();
  });
});

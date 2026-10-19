// the scenario table of the jikan provider tests (jikan-catalog-provider.test.ts): for each
// endpoint, its calls with their valid answer and normalized result, its empty answer and a body
// that fails its schema. bodies come from the builders until the recorded responses replace them
import type { CatalogProvider } from '../../catalog-provider';
import {
  buildJikanAnime,
  buildJikanDetail,
  buildJikanGenres,
  buildJikanManga,
  buildJikanPage,
  withoutKeys,
} from './jikan-builders';
import { TENRAI_BASE, jikanError, jsonAnswer, type JikanAnswer } from './jikan-handlers';

type JsonObject = Record<string, unknown>;

// what toMatchObject compares a result or an error with
type Expected = JsonObject | JsonObject[];

// one call of an endpoint, its valid answer and the result it gives
export interface JikanScenario {
  readonly label: string;
  // the msw path, without the query
  readonly path: string;
  // the exact url the provider requests
  readonly url: string;
  // the limit query parameter, null on a request without pagination
  readonly limit: string | null;
  readonly call: (provider: CatalogProvider, signal?: AbortSignal) => Promise<unknown>;
  readonly body: JsonObject;
  // compared with toMatchObject: the normalized fields
  readonly expected: Expected;
}

export interface JikanEndpoint {
  readonly name: string;
  // the first scenario also runs the empty, 429, timeout and malformed cases
  readonly scenarios: readonly [JikanScenario, ...JikanScenario[]];
  // the answer when there is nothing to return, and the result or the error fields it gives
  readonly empty: {
    readonly label: string;
    readonly answer: JikanAnswer;
    readonly expected: Expected;
  };
  // a json body that fails the endpoint's schema
  readonly mismatch: { readonly label: string; readonly body: JsonObject };
}

// the jikan maximum, on every paginated request
const PAGE_LIMIT = '25';

const emptyPage = (page: number) => ({ items: [], page, lastPage: 1, hasNextPage: false });

export const SEARCH_ENDPOINT: JikanEndpoint = {
  name: 'search',
  scenarios: [
    {
      label: 'an anime search',
      path: '/anime',
      url: `${TENRAI_BASE}/anime?q=Sample&type=tv&status=airing&page=2&limit=25`,
      limit: PAGE_LIMIT,
      call: (provider, signal) =>
        provider.search(
          { kind: 'anime', query: 'Sample', formats: ['tv'], status: 'ongoing', page: 2 },
          signal,
        ),
      body: buildJikanPage(
        [buildJikanAnime({ mal_id: 5114, status: 'Currently Airing', episodes: null })],
        { current_page: 2, last_visible_page: 7, has_next_page: true },
      ),
      expected: {
        page: 2,
        lastPage: 7,
        hasNextPage: true,
        items: [
          {
            key: { namespace: 'mal', kind: 'anime', externalId: 5114 },
            title: 'Sample Anime',
            format: 'tv',
            status: 'ongoing',
            totalUnits: null,
            isAdult: false,
          },
        ],
      },
    },
    {
      label: 'a manga search',
      path: '/manga',
      url: `${TENRAI_BASE}/manga?q=Sample&type=manhwa&order_by=score&sort=desc&page=1&limit=25`,
      limit: PAGE_LIMIT,
      call: (provider, signal) =>
        provider.search(
          {
            kind: 'manga',
            query: 'Sample',
            formats: ['manhwa'],
            sort: { field: 'score', direction: 'desc' },
            page: 1,
          },
          signal,
        ),
      body: buildJikanPage([buildJikanManga({ mal_id: 2, type: 'Manhwa', status: 'On Hiatus' })]),
      expected: {
        page: 1,
        lastPage: 1,
        hasNextPage: false,
        items: [
          {
            key: { namespace: 'mal', kind: 'manga', externalId: 2 },
            title: 'Sample Manga',
            format: 'manhwa',
            status: 'hiatus',
            totalUnits: 40,
            isAdult: false,
          },
        ],
      },
    },
  ],
  empty: { label: 'an empty page', answer: jsonAnswer(buildJikanPage([])), expected: emptyPage(2) },
  mismatch: { label: 'data that is not an array', body: { ...buildJikanPage([]), data: {} } },
};

export const DETAIL_ENDPOINT: JikanEndpoint = {
  name: 'getDetail',
  scenarios: [
    {
      label: 'an anime detail',
      path: '/anime/101',
      url: `${TENRAI_BASE}/anime/101`,
      limit: null,
      call: (provider, signal) =>
        provider.getDetail({ namespace: 'mal', kind: 'anime', externalId: 101 }, signal),
      body: buildJikanDetail(buildJikanAnime()),
      expected: {
        key: { namespace: 'mal', kind: 'anime', externalId: 101 },
        title: 'Sample Anime',
        titleEnglish: 'Sample Anime in English',
        titleNative: 'サンプルアニメ',
        imageUrl: 'https://cdn.myanimelist.net/images/anime/1/101l.webp',
        format: 'tv',
        status: 'finished',
        totalUnits: 12,
        score: 7.5,
        year: 2020,
        synopsis: 'synopsis placeholder',
        genres: [
          { id: 1, name: 'Action' },
          { id: 4, name: 'Comedy' },
          { id: 23, name: 'School' },
          { id: 27, name: 'Shounen' },
        ],
        isAdult: false,
      },
    },
  ],
  empty: {
    label: 'a 404 for an unknown id',
    answer: () => jikanError(404, 'Resource does not exist'),
    expected: { name: 'CatalogHttpError', status: 404, retryAfterMs: null },
  },
  mismatch: {
    label: 'an item without explicit_genres',
    body: buildJikanDetail(withoutKeys(buildJikanAnime(), 'explicit_genres')),
  },
};

export const TOP_ENDPOINT: JikanEndpoint = {
  name: 'getTop',
  scenarios: [
    {
      label: 'a top manga page',
      path: '/top/manga',
      url: `${TENRAI_BASE}/top/manga?page=3&limit=25`,
      limit: PAGE_LIMIT,
      call: (provider, signal) => provider.getTop({ kind: 'manga', page: 3 }, signal),
      body: buildJikanPage(
        [
          buildJikanManga({
            mal_id: 13,
            type: 'Light Novel',
            status: 'Publishing',
            chapters: null,
          }),
        ],
        { current_page: 3, last_visible_page: 40, has_next_page: true },
      ),
      expected: {
        page: 3,
        lastPage: 40,
        hasNextPage: true,
        items: [
          {
            key: { namespace: 'mal', kind: 'manga', externalId: 13 },
            title: 'Sample Manga',
            format: 'light_novel',
            status: 'ongoing',
            totalUnits: null,
            isAdult: false,
          },
        ],
      },
    },
  ],
  empty: { label: 'an empty page', answer: jsonAnswer(buildJikanPage([])), expected: emptyPage(3) },
  mismatch: {
    label: 'a genre without its name',
    body: buildJikanPage([buildJikanManga({ genres: [{ mal_id: 12, type: 'manga' }] })]),
  },
};

export const SEASON_ENDPOINT: JikanEndpoint = {
  name: 'getCurrentSeason',
  scenarios: [
    {
      label: 'a current season page',
      path: '/seasons/now',
      url: `${TENRAI_BASE}/seasons/now?page=1&limit=25`,
      limit: PAGE_LIMIT,
      call: (provider, signal) => provider.getCurrentSeason(1, signal),
      body: buildJikanPage(
        [buildJikanAnime({ mal_id: 52991, type: 'ONA', status: 'Not yet aired', episodes: null })],
        { last_visible_page: 2, has_next_page: true },
      ),
      expected: {
        page: 1,
        lastPage: 2,
        hasNextPage: true,
        items: [
          {
            key: { namespace: 'mal', kind: 'anime', externalId: 52991 },
            title: 'Sample Anime',
            format: 'ona',
            status: 'upcoming',
            totalUnits: null,
            isAdult: false,
          },
        ],
      },
    },
  ],
  empty: { label: 'an empty page', answer: jsonAnswer(buildJikanPage([])), expected: emptyPage(1) },
  mismatch: {
    label: 'an item without its rating',
    body: buildJikanPage([withoutKeys(buildJikanAnime(), 'rating')]),
  },
};

export const GENRES_ENDPOINT: JikanEndpoint = {
  name: 'getGenres',
  scenarios: [
    {
      label: 'the manga genres, explicit ones included',
      path: '/genres/manga',
      url: `${TENRAI_BASE}/genres/manga`,
      limit: null,
      call: (provider, signal) => provider.getGenres('manga', signal),
      body: buildJikanGenres(
        [
          [1, 'Action'],
          [12, 'Hentai'],
          [49, 'Erotica'],
        ],
        'manga',
      ),
      expected: [
        { id: 1, name: 'Action' },
        { id: 12, name: 'Hentai' },
        { id: 49, name: 'Erotica' },
      ],
    },
  ],
  empty: { label: 'an empty list', answer: jsonAnswer(buildJikanGenres([])), expected: [] },
  mismatch: { label: 'data that is not an array', body: { data: { 1: 'Action' } } },
};

/** every endpoint of the provider, in the order of the `CatalogProvider` interface. */
export const JIKAN_ENDPOINTS = [
  SEARCH_ENDPOINT,
  DETAIL_ENDPOINT,
  TOP_ENDPOINT,
  SEASON_ENDPOINT,
  GENRES_ENDPOINT,
] as const;

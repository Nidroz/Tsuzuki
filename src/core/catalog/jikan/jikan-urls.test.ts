import { describe, expect, it } from '@jest/globals';

import {
  MAL_ID_MAX,
  type MediaFormat,
  type MediaKind,
  type SearchableMediaStatus,
} from '../../domain/media';
import type { SearchParams, SearchSortField, SortDirection } from '../catalog-provider';
import {
  JIKAN_BASE_URL,
  jikanDetailUrl,
  jikanGenresUrl,
  jikanSearchUrl,
  jikanSeasonNowUrl,
  jikanTopUrl,
  jikanYearRange,
} from './jikan-urls';

const BASE = 'https://api.jikan.moe/v4';
const SEARCH_TEXT = 'secret search';

// values outside the declared types, as an untyped caller could pass them
const asKind = (value: string): MediaKind => value as MediaKind;
const asFormat = (value: string): MediaFormat => value as MediaFormat;
const asStatus = (value: string): SearchableMediaStatus => value as SearchableMediaStatus;
const asField = (value: string): SearchSortField => value as SearchSortField;
const asDirection = (value: string): SortDirection => value as SortDirection;

// how `build` fails: the error class, and whether its message quotes the search text
const failureOf = (build: () => unknown) => {
  try {
    build();
  } catch (error: unknown) {
    return {
      rangeError: error instanceof RangeError,
      quotesSearchText: String(error).includes(SEARCH_TEXT),
    };
  }
  return null;
};

const RANGE_ERROR = { rangeError: true, quotesSearchText: false };

const searchQueryOf = (params: SearchParams): string => {
  const url = jikanSearchUrl(params);
  return url.slice(url.indexOf('?') + 1);
};

describe('jikanSearchUrl', () => {
  it('sends every filter in the fixed order, then page and limit', () => {
    expect(JIKAN_BASE_URL).toBe(BASE);
    expect(
      jikanSearchUrl({
        page: 3,
        sort: { field: 'score', direction: 'desc' },
        year: 2020,
        genresExcluded: [9, 12],
        genresIncluded: [4, 1],
        minScore: 7.5,
        status: 'finished',
        formats: ['tv'],
        query: 'sample',
        kind: 'anime',
      }),
    ).toBe(
      `${BASE}/anime?q=sample&type=tv&status=complete&min_score=7.5&genres=1,4&genres_exclude=9,12` +
        '&start_date=2020-01-01&end_date=2020-12-31&order_by=score&sort=desc&page=3&limit=25',
    );
  });

  it('sends only the page and the limit without filters', () => {
    expect(jikanSearchUrl({ kind: 'manga', page: 1 })).toBe(`${BASE}/manga?page=1&limit=25`);
  });

  it('gives equivalent params the identical url', () => {
    const url = jikanSearchUrl({
      kind: 'manga',
      query: 'sample',
      formats: ['manhwa'],
      genresIncluded: [1, 4],
      page: 2,
    });
    expect(
      jikanSearchUrl({
        page: 2,
        genresIncluded: [4, 1, 4],
        genresExcluded: [],
        formats: ['manhwa', 'manhwa'],
        query: '  sample \n',
        kind: 'manga',
      }),
    ).toBe(url);
  });

  it('encodes the search text', () => {
    expect(searchQueryOf({ kind: 'anime', query: 'a b&c#d=é?', page: 1 })).toBe(
      'q=a%20b%26c%23d%3D%C3%A9%3F&page=1&limit=25',
    );
  });

  it('never sends a content filter', () => {
    const urls = [
      jikanSearchUrl({ kind: 'anime', query: 'sample', page: 1 }),
      jikanSearchUrl({ kind: 'manga', formats: ['doujinshi'], page: 1 }),
      jikanTopUrl('anime', 1),
      jikanTopUrl('manga', 1),
      jikanSeasonNowUrl(1),
      jikanGenresUrl('anime'),
      jikanDetailUrl({ kind: 'anime', malId: 1 }),
    ];
    for (const url of urls) {
      expect(url).not.toMatch(/[?&](?:sfw|rating|unapproved|continuing|kids)(?:=|&|$)/);
    }
  });

  it.each<[SearchSortField, SortDirection, string]>([
    ['popularity', 'asc', 'order_by=members&sort=asc'],
    ['popularity', 'desc', 'order_by=members&sort=desc'],
    ['score', 'asc', 'order_by=score&sort=asc'],
    ['title', 'asc', 'order_by=title&sort=asc'],
    ['start_date', 'desc', 'order_by=start_date&sort=desc'],
  ])('sorts by %s %s as %s', (field, direction, expected) => {
    expect(searchQueryOf({ kind: 'anime', sort: { field, direction }, page: 1 })).toBe(
      `${expected}&page=1&limit=25`,
    );
  });

  it.each<[MediaKind, SearchableMediaStatus, string]>([
    ['anime', 'ongoing', 'airing'],
    ['anime', 'finished', 'complete'],
    ['anime', 'upcoming', 'upcoming'],
    ['manga', 'ongoing', 'publishing'],
    ['manga', 'finished', 'complete'],
    ['manga', 'upcoming', 'upcoming'],
  ])('sends the %s status %s as %s', (kind, status, expected) => {
    expect(searchQueryOf({ kind, status, page: 1 })).toBe(`status=${expected}&page=1&limit=25`);
  });

  it.each<[MediaKind, MediaFormat, string]>([
    ['anime', 'tv', 'tv'],
    ['anime', 'movie', 'movie'],
    ['anime', 'ova', 'ova'],
    ['anime', 'ona', 'ona'],
    ['anime', 'special', 'special'],
    ['anime', 'music', 'music'],
    ['manga', 'manga', 'manga'],
    ['manga', 'manhwa', 'manhwa'],
    ['manga', 'manhua', 'manhua'],
    ['manga', 'novel', 'novel'],
    ['manga', 'light_novel', 'lightnovel'],
    ['manga', 'one_shot', 'oneshot'],
    ['manga', 'doujinshi', 'doujin'],
  ])('sends the %s format %s as type %s', (kind, format, expected) => {
    expect(searchQueryOf({ kind, formats: [format], page: 1 })).toBe(
      `type=${expected}&page=1&limit=25`,
    );
  });

  it.each([
    [0, '0'],
    [10, '10'],
    [7.25, '7.25'],
    [7.256, '7.26'],
    [0.0000001, '0'],
  ])('sends the minimum score %p as %s', (minScore, expected) => {
    expect(searchQueryOf({ kind: 'anime', minScore, page: 1 })).toBe(
      `min_score=${expected}&page=1&limit=25`,
    );
  });
});

describe('jikanYearRange', () => {
  it.each([
    [1000, '1000-01-01', '1000-12-31'],
    [2024, '2024-01-01', '2024-12-31'],
    [9999, '9999-01-01', '9999-12-31'],
  ])('covers the whole year %p', (year, startDate, endDate) => {
    expect(jikanYearRange(year)).toStrictEqual([startDate, endDate]);
  });

  it.each([999, 10_000, 2024.5, Number.NaN])('rejects the year %p', (year) => {
    expect(failureOf(() => jikanYearRange(year))).toStrictEqual(RANGE_ERROR);
    expect(
      failureOf(() => jikanSearchUrl({ kind: 'anime', query: SEARCH_TEXT, year, page: 1 })),
    ).toStrictEqual(RANGE_ERROR);
  });
});

describe('the other endpoints', () => {
  it('builds the detail, top, season and genre urls', () => {
    expect(jikanDetailUrl({ kind: 'anime', malId: 101 })).toBe(`${BASE}/anime/101`);
    expect(jikanDetailUrl({ kind: 'manga', malId: MAL_ID_MAX })).toBe(
      `${BASE}/manga/${String(MAL_ID_MAX)}`,
    );
    expect(jikanTopUrl('anime', 2)).toBe(`${BASE}/top/anime?page=2&limit=25`);
    expect(jikanTopUrl('manga', 1)).toBe(`${BASE}/top/manga?page=1&limit=25`);
    expect(jikanSeasonNowUrl(4)).toBe(`${BASE}/seasons/now?page=4&limit=25`);
    expect(jikanGenresUrl('anime')).toBe(`${BASE}/genres/anime`);
    expect(jikanGenresUrl('manga')).toBe(`${BASE}/genres/manga`);
  });
});

describe('input guards', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects the page %p',
    (page) => {
      expect(
        failureOf(() => jikanSearchUrl({ kind: 'anime', query: SEARCH_TEXT, page })),
      ).toStrictEqual(RANGE_ERROR);
      expect(failureOf(() => jikanTopUrl('manga', page))).toStrictEqual(RANGE_ERROR);
      expect(failureOf(() => jikanSeasonNowUrl(page))).toStrictEqual(RANGE_ERROR);
    },
  );

  it.each([0, -5, 1.5, MAL_ID_MAX + 1, Number.NaN])('rejects the media id %p', (malId) => {
    expect(failureOf(() => jikanDetailUrl({ kind: 'anime', malId }))).toStrictEqual(RANGE_ERROR);
  });

  it.each([[[0]], [[1, -2]], [[1.5]], [[Number.NaN]]])('rejects the genre ids %p', (ids) => {
    const search = { kind: 'anime', query: SEARCH_TEXT, page: 1 } as const;
    expect(failureOf(() => jikanSearchUrl({ ...search, genresIncluded: ids }))).toStrictEqual(
      RANGE_ERROR,
    );
    expect(failureOf(() => jikanSearchUrl({ ...search, genresExcluded: ids }))).toStrictEqual(
      RANGE_ERROR,
    );
  });

  it.each([-0.5, 10.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the minimum score %p',
    (minScore) => {
      expect(
        failureOf(() => jikanSearchUrl({ kind: 'anime', query: SEARCH_TEXT, minScore, page: 1 })),
      ).toStrictEqual(RANGE_ERROR);
    },
  );

  it.each<[MediaKind, string[]]>([
    ['anime', ['tv', 'movie']],
    ['anime', ['unknown']],
    ['manga', ['oel']],
    ['manga', ['unknown']],
    ['manga', ['tv']],
    ['anime', ['manga']],
    ['anime', ['constructor']],
  ])('rejects the %s formats %p', (kind, formats) => {
    expect(
      failureOf(() =>
        jikanSearchUrl({ kind, query: SEARCH_TEXT, formats: formats.map(asFormat), page: 1 }),
      ),
    ).toStrictEqual(RANGE_ERROR);
  });

  it.each(['novel', 'constructor', ''])('rejects the kind %p', (kind) => {
    expect(
      failureOf(() => jikanSearchUrl({ kind: asKind(kind), query: SEARCH_TEXT, page: 1 })),
    ).toStrictEqual(RANGE_ERROR);
    expect(failureOf(() => jikanDetailUrl({ kind: asKind(kind), malId: 1 }))).toStrictEqual(
      RANGE_ERROR,
    );
    expect(failureOf(() => jikanTopUrl(asKind(kind), 1))).toStrictEqual(RANGE_ERROR);
    expect(failureOf(() => jikanGenresUrl(asKind(kind)))).toStrictEqual(RANGE_ERROR);
  });

  it('rejects a status or a sort outside the declared values', () => {
    const search = { kind: 'manga', query: SEARCH_TEXT, page: 1 } as const;
    expect(
      failureOf(() => jikanSearchUrl({ ...search, status: asStatus('hiatus') })),
    ).toStrictEqual(RANGE_ERROR);
    expect(
      failureOf(() =>
        jikanSearchUrl({ ...search, sort: { field: asField('members'), direction: 'asc' } }),
      ),
    ).toStrictEqual(RANGE_ERROR);
    expect(
      failureOf(() =>
        jikanSearchUrl({ ...search, sort: { field: 'score', direction: asDirection('up') } }),
      ),
    ).toStrictEqual(RANGE_ERROR);
  });

  it('rejects search text that is not well-formed, without quoting it', () => {
    expect(
      failureOf(() => jikanSearchUrl({ kind: 'anime', query: `${SEARCH_TEXT} \uD800`, page: 1 })),
    ).toStrictEqual(RANGE_ERROR);
  });
});

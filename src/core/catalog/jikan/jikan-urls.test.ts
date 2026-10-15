import { describe, expect, it } from '@jest/globals';

import {
  EXTERNAL_ID_MAX,
  type MediaFormat,
  type MediaKind,
  type SearchableMediaStatus,
} from '../../domain/media';
import type { SearchParams, SearchSortField, SortDirection } from '../catalog-provider';
import {
  jikanDetailUrl,
  jikanGenresUrl,
  jikanSearchUrl,
  jikanSeasonNowUrl,
  jikanTopUrl,
  jikanStartDateFrom,
} from './jikan-urls';

const BASE = 'https://api.tenrai.org/v1';
const SELF_HOSTED_BASE = 'https://jikan.example.test:8443/v4';
const SEARCH_TEXT = 'secret search';

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

// the input guards are in jikan-urls-guards.test.ts

const searchQueryOf = (params: SearchParams): string => {
  const url = jikanSearchUrl(BASE, params);
  return url.slice(url.indexOf('?') + 1);
};

describe('jikanSearchUrl', () => {
  it('sends every filter in the fixed order, then page and limit', () => {
    expect(
      jikanSearchUrl(BASE, {
        page: 3,
        sort: { field: 'score', direction: 'desc' },
        yearFrom: 2020,
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
        '&start_date=2020-01-01&order_by=score&sort=desc&page=3&limit=25',
    );
  });

  it('sends only the page and the limit without filters', () => {
    expect(jikanSearchUrl(BASE, { kind: 'manga', page: 1 })).toBe(`${BASE}/manga?page=1&limit=25`);
  });

  it('gives equivalent params the identical url', () => {
    const url = jikanSearchUrl(BASE, {
      kind: 'manga',
      query: 'sample',
      formats: ['manhwa'],
      genresIncluded: [1, 4],
      page: 2,
    });
    expect(
      jikanSearchUrl(BASE, {
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
      jikanSearchUrl(BASE, { kind: 'anime', query: 'sample', page: 1 }),
      jikanSearchUrl(BASE, { kind: 'manga', formats: ['doujinshi'], page: 1 }),
      jikanTopUrl(BASE, 'anime', 1),
      jikanTopUrl(BASE, 'manga', 1),
      jikanSeasonNowUrl(BASE, 1),
      jikanGenresUrl(BASE, 'anime'),
      jikanDetailUrl(BASE, { namespace: 'mal', kind: 'anime', externalId: 1 }),
    ];
    for (const url of urls) {
      expect(url).not.toMatch(/[?&](?:sfw|sfw-strict|rating|unapproved|continuing|kids)(?:=|&|$)/);
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

describe('jikanStartDateFrom', () => {
  it.each([
    [1000, '1000-01-01'],
    [2024, '2024-01-01'],
    [9999, '9999-01-01'],
  ])('starts the year %p on january 1st', (yearFrom, startDate) => {
    expect(jikanStartDateFrom(yearFrom)).toBe(startDate);
  });

  it('sends start_date alone, never end_date', () => {
    expect(searchQueryOf({ kind: 'anime', yearFrom: 1999, page: 1 })).toBe(
      'start_date=1999-01-01&page=1&limit=25',
    );
    expect(searchQueryOf({ kind: 'manga', yearFrom: 2024, page: 2 })).not.toContain('end_date');
  });

  it.each([999, 10_000, 2024.5, Number.NaN])('rejects the year %p', (yearFrom) => {
    expect(failureOf(() => jikanStartDateFrom(yearFrom))).toStrictEqual(RANGE_ERROR);
    expect(
      failureOf(() =>
        jikanSearchUrl(BASE, { kind: 'anime', query: SEARCH_TEXT, yearFrom, page: 1 }),
      ),
    ).toStrictEqual(RANGE_ERROR);
  });
});

describe('the other endpoints', () => {
  it('builds the detail, top, season and genre urls', () => {
    expect(jikanDetailUrl(BASE, { namespace: 'mal', kind: 'anime', externalId: 101 })).toBe(
      `${BASE}/anime/101`,
    );
    expect(
      jikanDetailUrl(BASE, { namespace: 'mal', kind: 'manga', externalId: EXTERNAL_ID_MAX }),
    ).toBe(`${BASE}/manga/${String(EXTERNAL_ID_MAX)}`);
    expect(jikanTopUrl(BASE, 'anime', 2)).toBe(`${BASE}/top/anime?page=2&limit=25`);
    expect(jikanTopUrl(BASE, 'manga', 1)).toBe(`${BASE}/top/manga?page=1&limit=25`);
    expect(jikanSeasonNowUrl(BASE, 4)).toBe(`${BASE}/seasons/now?page=4&limit=25`);
    expect(jikanGenresUrl(BASE, 'anime')).toBe(`${BASE}/genres/anime`);
    expect(jikanGenresUrl(BASE, 'manga')).toBe(`${BASE}/genres/manga`);
  });
});

describe('the base url', () => {
  it('prefixes every url with the given instance root, as is', () => {
    const key = { namespace: 'mal', kind: 'anime', externalId: 1 } as const;
    expect([
      jikanSearchUrl(SELF_HOSTED_BASE, { kind: 'anime', page: 1 }),
      jikanDetailUrl(SELF_HOSTED_BASE, key),
      jikanTopUrl(SELF_HOSTED_BASE, 'anime', 1),
      jikanSeasonNowUrl(SELF_HOSTED_BASE, 1),
      jikanGenresUrl(SELF_HOSTED_BASE, 'anime'),
    ]).toStrictEqual([
      `${SELF_HOSTED_BASE}/anime?page=1&limit=25`,
      `${SELF_HOSTED_BASE}/anime/1`,
      `${SELF_HOSTED_BASE}/top/anime?page=1&limit=25`,
      `${SELF_HOSTED_BASE}/seasons/now?page=1&limit=25`,
      `${SELF_HOSTED_BASE}/genres/anime`,
    ]);
  });
});

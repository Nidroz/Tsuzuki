import { describe, expect, it } from '@jest/globals';

import {
  EXTERNAL_ID_MAX,
  type MediaFormat,
  type MediaIdNamespace,
  type MediaKind,
  type SearchableMediaStatus,
} from '../../domain/media';
import type { SearchSortField, SortDirection } from '../catalog-provider';
import {
  JIKAN_GENRE_IDS_MAX,
  JIKAN_QUERY_MAX_LENGTH,
  jikanDetailUrl,
  jikanGenresUrl,
  jikanSearchUrl,
  jikanSeasonNowUrl,
  jikanTopUrl,
} from './jikan-urls';

// the input guards of the url builders: each throws a RangeError whose message quotes no value,
// before any request is built. the urls themselves are in jikan-urls.test.ts

const BASE = 'https://api.tenrai.org/v1';
const SEARCH_TEXT = 'secret search';
// the tenrai limits, spelled out: a wrong constant is caught
const QUERY_MAX_LENGTH = 300;
const GENRE_IDS_MAX = 25;

// values outside the declared types, as an untyped caller could pass them
const asNamespace = (value: string): MediaIdNamespace => value as MediaIdNamespace;
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

// `count` distinct genre ids from 1
const genreIds = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index + 1);

describe('input guards', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects the page %p',
    (page) => {
      expect(
        failureOf(() => jikanSearchUrl(BASE, { kind: 'anime', query: SEARCH_TEXT, page })),
      ).toStrictEqual(RANGE_ERROR);
      expect(failureOf(() => jikanTopUrl(BASE, 'manga', page))).toStrictEqual(RANGE_ERROR);
      expect(failureOf(() => jikanSeasonNowUrl(BASE, page))).toStrictEqual(RANGE_ERROR);
    },
  );

  it.each([0, -5, 1.5, EXTERNAL_ID_MAX + 1, Number.NaN])(
    'rejects the media id %p',
    (externalId) => {
      expect(
        failureOf(() => jikanDetailUrl(BASE, { namespace: 'mal', kind: 'anime', externalId })),
      ).toStrictEqual(RANGE_ERROR);
    },
  );

  it.each(['anilist', 'MAL', 'tenrai', ''])('rejects a key of the namespace %p', (namespace) => {
    expect(
      failureOf(() =>
        jikanDetailUrl(BASE, { namespace: asNamespace(namespace), kind: 'anime', externalId: 1 }),
      ),
    ).toStrictEqual(RANGE_ERROR);
  });

  it.each([[[0]], [[1, -2]], [[1.5]], [[Number.NaN]]])('rejects the genre ids %p', (ids) => {
    const search = { kind: 'anime', query: SEARCH_TEXT, page: 1 } as const;
    expect(failureOf(() => jikanSearchUrl(BASE, { ...search, genresIncluded: ids }))).toStrictEqual(
      RANGE_ERROR,
    );
    expect(failureOf(() => jikanSearchUrl(BASE, { ...search, genresExcluded: ids }))).toStrictEqual(
      RANGE_ERROR,
    );
  });

  it.each([-0.5, 10.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the minimum score %p',
    (minScore) => {
      expect(
        failureOf(() =>
          jikanSearchUrl(BASE, { kind: 'anime', query: SEARCH_TEXT, minScore, page: 1 }),
        ),
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
        jikanSearchUrl(BASE, { kind, query: SEARCH_TEXT, formats: formats.map(asFormat), page: 1 }),
      ),
    ).toStrictEqual(RANGE_ERROR);
  });

  it.each(['novel', 'constructor', ''])('rejects the kind %p', (kind) => {
    expect(
      failureOf(() => jikanSearchUrl(BASE, { kind: asKind(kind), query: SEARCH_TEXT, page: 1 })),
    ).toStrictEqual(RANGE_ERROR);
    expect(
      failureOf(() =>
        jikanDetailUrl(BASE, { namespace: 'mal', kind: asKind(kind), externalId: 1 }),
      ),
    ).toStrictEqual(RANGE_ERROR);
    expect(failureOf(() => jikanTopUrl(BASE, asKind(kind), 1))).toStrictEqual(RANGE_ERROR);
    expect(failureOf(() => jikanGenresUrl(BASE, asKind(kind)))).toStrictEqual(RANGE_ERROR);
  });

  it('rejects a status or a sort outside the declared values', () => {
    const search = { kind: 'manga', query: SEARCH_TEXT, page: 1 } as const;
    expect(
      failureOf(() => jikanSearchUrl(BASE, { ...search, status: asStatus('hiatus') })),
    ).toStrictEqual(RANGE_ERROR);
    expect(
      failureOf(() =>
        jikanSearchUrl(BASE, { ...search, sort: { field: asField('members'), direction: 'asc' } }),
      ),
    ).toStrictEqual(RANGE_ERROR);
    expect(
      failureOf(() =>
        jikanSearchUrl(BASE, { ...search, sort: { field: 'score', direction: asDirection('up') } }),
      ),
    ).toStrictEqual(RANGE_ERROR);
  });

  it('rejects search text that is not well-formed, without quoting it', () => {
    expect(
      failureOf(() =>
        jikanSearchUrl(BASE, { kind: 'anime', query: `${SEARCH_TEXT} \uD800`, page: 1 }),
      ),
    ).toStrictEqual(RANGE_ERROR);
  });
});

describe('the tenrai limits', () => {
  it('match the documented values', () => {
    expect(JIKAN_QUERY_MAX_LENGTH).toBe(QUERY_MAX_LENGTH);
    expect(JIKAN_GENRE_IDS_MAX).toBe(GENRE_IDS_MAX);
  });

  it.each([
    ['300 characters', SEARCH_TEXT.padEnd(QUERY_MAX_LENGTH, 'x')],
    ['300 characters once trimmed', `  ${SEARCH_TEXT.padEnd(QUERY_MAX_LENGTH, 'x')}\n`],
    // 150 astral characters are 300 utf-16 code units
    ['150 emoji', '\u{1F600}'.repeat(QUERY_MAX_LENGTH / 2)],
  ])('sends search text of %s', (_, query) => {
    const url = jikanSearchUrl(BASE, { kind: 'anime', query, page: 1 });
    expect(url).toBe(`${BASE}/anime?q=${encodeURIComponent(query.trim())}&page=1&limit=25`);
  });

  it.each([
    ['301 characters', SEARCH_TEXT.padEnd(QUERY_MAX_LENGTH + 1, 'x')],
    ['150 emoji and a letter', `${'\u{1F600}'.repeat(QUERY_MAX_LENGTH / 2)}a`],
  ])('rejects search text of %s, without quoting it', (_, query) => {
    expect(failureOf(() => jikanSearchUrl(BASE, { kind: 'anime', query, page: 1 }))).toStrictEqual(
      RANGE_ERROR,
    );
  });

  it('sends 25 genre ids per filter, counted once deduplicated', () => {
    const ids = genreIds(GENRE_IDS_MAX);
    const list = ids.join(',');
    expect(
      jikanSearchUrl(BASE, {
        kind: 'anime',
        genresIncluded: [...ids, 1],
        genresExcluded: ids.map((id) => id + GENRE_IDS_MAX),
        page: 1,
      }),
    ).toBe(
      `${BASE}/anime?genres=${list}&genres_exclude=${ids.map((id) => id + GENRE_IDS_MAX).join(',')}` +
        '&page=1&limit=25',
    );
  });

  it.each(['genresIncluded', 'genresExcluded'] as const)('rejects 26 genre ids in %s', (filter) => {
    expect(
      failureOf(() =>
        jikanSearchUrl(BASE, {
          kind: 'anime',
          query: SEARCH_TEXT,
          [filter]: genreIds(GENRE_IDS_MAX + 1),
          page: 1,
        }),
      ),
    ).toStrictEqual(RANGE_ERROR);
  });
});

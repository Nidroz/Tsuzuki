// jikan v4 request urls, under the base url of a jikan v4 compatible instance (jikan-instances.ts).
// deterministic: equivalent params give the identical url, so identical requests share one
// in-flight request. built as strings with encodeURIComponent: react native's
// URL and URLSearchParams polyfills are incomplete. no content filter is ever sent (sfw,
// sfw-strict, rating, unapproved, continuing: ADR-0004). invalid input throws a RangeError before
// any request; its message holds no value and never the search text
import {
  EXTERNAL_ID_MAX,
  MEDIA_KINDS,
  type AnimeFormat,
  type MangaFormat,
  type MediaKey,
  type MediaKind,
  type SearchableMediaStatus,
} from '../../domain/media';
import {
  SORT_DIRECTIONS,
  type SearchParams,
  type SearchSortField,
  type SortDirection,
} from '../catalog-provider';
import { normalizeSearchParams } from '../search-params';
import { SCORE_MAX, isFourDigitYear } from './jikan-fields';
import { JIKAN_NAMESPACE } from './jikan-instances';

/** items per page, sent with every paginated request: the public jikan maximum (tenrai: 100). */
export const JIKAN_PAGE_LIMIT = 25;

/** the longest search text sent, in utf-16 code units after normalization: the tenrai maximum. */
export const JIKAN_QUERY_MAX_LENGTH = 300;

/** the most genre ids sent in `genres`, and in `genres_exclude`: the tenrai maximum. */
export const JIKAN_GENRE_IDS_MAX = 25;

// mal scores have two decimals; rounding also keeps String() out of exponent notation
const MIN_SCORE_SCALE = 100;
const LIST_SEPARATOR = ',';

const SEARCH_STATUS = {
  anime: { ongoing: 'airing', finished: 'complete', upcoming: 'upcoming' },
  manga: { ongoing: 'publishing', finished: 'complete', upcoming: 'upcoming' },
} as const satisfies Record<MediaKind, Record<SearchableMediaStatus, string>>;

// mal popularity is a rank where 1 is the most popular: members keeps the asc/desc meaning
const ORDER_BY = {
  score: 'score',
  popularity: 'members',
  title: 'title',
  start_date: 'start_date',
} as const satisfies Record<SearchSortField, string>;

// formats without a jikan search type (unknown, oel) cannot be searched
const ANIME_SEARCH_TYPE = {
  tv: 'tv',
  movie: 'movie',
  ova: 'ova',
  special: 'special',
  ona: 'ona',
  music: 'music',
} as const satisfies Record<Exclude<AnimeFormat, 'unknown'>, string>;

const MANGA_SEARCH_TYPE = {
  manga: 'manga',
  manhwa: 'manhwa',
  manhua: 'manhua',
  light_novel: 'lightnovel',
  novel: 'novel',
  one_shot: 'oneshot',
  doujinshi: 'doujin',
} as const satisfies Record<Exclude<MangaFormat, 'unknown' | 'oel'>, string>;

interface KindTables {
  readonly searchTypes: ReadonlyMap<string, string>;
  readonly statuses: ReadonlyMap<string, string>;
}

// maps, not object lookups: a value outside the types must not reach the prototype
const tableOf = (table: Readonly<Record<string, string>>): ReadonlyMap<string, string> =>
  new Map(Object.entries(table));

const KIND_TABLES = new Map<string, KindTables>([
  ['anime', { searchTypes: tableOf(ANIME_SEARCH_TYPE), statuses: tableOf(SEARCH_STATUS.anime) }],
  ['manga', { searchTypes: tableOf(MANGA_SEARCH_TYPE), statuses: tableOf(SEARCH_STATUS.manga) }],
]);
const ORDER_BY_FIELD = tableOf(ORDER_BY);

type QueryParam = readonly [name: string, value: string];

const withQuery = (baseUrl: string, path: string, params: readonly QueryParam[]): string =>
  `${baseUrl}${path}?${params.map(([name, value]) => `${name}=${value}`).join('&')}`;

const UNSUPPORTED_KIND = 'Catalog media kind is not supported';

const kindOf = (kind: MediaKind): MediaKind => {
  if (!MEDIA_KINDS.includes(kind)) {
    throw new RangeError(UNSUPPORTED_KIND);
  }
  return kind;
};

const tablesOf = (kind: MediaKind): KindTables => {
  const tables = KIND_TABLES.get(kind);
  if (tables === undefined) {
    throw new RangeError(UNSUPPORTED_KIND);
  }
  return tables;
};

const pageOf = (page: number): string => {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError('Catalog page must be a positive integer');
  }
  return String(page);
};

// a key of another namespace holds ids no jikan instance serves. read as a string: the guard
// holds for an untyped caller, and once MEDIA_ID_NAMESPACES grows
const checkNamespace = (namespace: string): void => {
  if (namespace !== JIKAN_NAMESPACE) {
    throw new RangeError('Catalog media id namespace is not supported');
  }
};

const externalIdOf = (externalId: number): string => {
  if (!Number.isSafeInteger(externalId) || externalId < 1 || externalId > EXTERNAL_ID_MAX) {
    throw new RangeError('Catalog media id is out of range');
  }
  return String(externalId);
};

const genreListOf = (ids: readonly number[]): string => {
  if (ids.length > JIKAN_GENRE_IDS_MAX) {
    throw new RangeError('Catalog search has too many genre ids');
  }
  if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new RangeError('Catalog genre ids must be positive integers');
  }
  return ids.map(String).join(LIST_SEPARATOR);
};

const queryTextOf = (query: string): string => {
  if (query.length > JIKAN_QUERY_MAX_LENGTH) {
    throw new RangeError('Catalog search text is too long');
  }
  try {
    return encodeURIComponent(query);
  } catch {
    // a lone surrogate cannot be encoded: an input error, reported without the text
    throw new RangeError('Catalog search text is not well-formed');
  }
};

const searchTypeOf = (tables: KindTables, formats: readonly string[]): string => {
  const [type, ...others] = formats.map((format) => tables.searchTypes.get(format));
  if (type === undefined || others.length > 0) {
    throw new RangeError('Catalog search takes one searchable format of its kind');
  }
  return type;
};

const statusOf = (tables: KindTables, status: SearchableMediaStatus): string => {
  const value = tables.statuses.get(status);
  if (value === undefined) {
    throw new RangeError('Catalog search status is not supported');
  }
  return value;
};

const minScoreOf = (minScore: number): string => {
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > SCORE_MAX) {
    throw new RangeError('Catalog minimum score must be between 0 and 10');
  }
  return String(Math.round(minScore * MIN_SCORE_SCALE) / MIN_SCORE_SCALE);
};

/**
 * the start_date filter of a year Y, Y-01-01, the only place that reads a year as a date: titles
 * started on or after it, still airing or not ("from Y onwards"). end_date is never sent: recorded
 * on tenrai on 2026-10-14, it bounds the end of airing, so a title still airing (aired.to null) or
 * ending after Y would be dropped. one piece (mal 21, airing since 1999-10-20) is missing with
 * start_date=1999-01-01&end_date=1999-12-31 and listed with start_date=1999-01-01 alone.
 */
export const jikanStartDateFrom = (year: number): string => {
  if (!isFourDigitYear(year)) {
    throw new RangeError('Catalog year must have four digits');
  }
  return `${String(year)}-01-01`;
};

const sortOf = (field: SearchSortField, direction: SortDirection): QueryParam[] => {
  const orderBy = ORDER_BY_FIELD.get(field);
  if (orderBy === undefined || !SORT_DIRECTIONS.includes(direction)) {
    throw new RangeError('Catalog search sort is not supported');
  }
  return [
    ['order_by', orderBy],
    ['sort', direction],
  ];
};

const paginationOf = (page: number): QueryParam[] => [
  ['page', pageOf(page)],
  ['limit', String(JIKAN_PAGE_LIMIT)],
];

/**
 * `/anime` or `/manga` with the normalized params in a fixed order, absent ones left out:
 * q, type, status, min_score, genres, genres_exclude, start_date, order_by, sort, page, limit.
 * end_date is never sent. the length and count limits apply to the normalized params.
 */
export const jikanSearchUrl = (baseUrl: string, params: SearchParams): string => {
  const normalized = normalizeSearchParams(params);
  const { kind, query, formats, status, minScore, genresIncluded, genresExcluded, yearFrom, sort } =
    normalized;
  const tables = tablesOf(kind);
  const search: QueryParam[] = [];
  if (query !== undefined) {
    search.push(['q', queryTextOf(query)]);
  }
  if (formats !== undefined) {
    search.push(['type', searchTypeOf(tables, formats)]);
  }
  if (status !== undefined) {
    search.push(['status', statusOf(tables, status)]);
  }
  if (minScore !== undefined) {
    search.push(['min_score', minScoreOf(minScore)]);
  }
  if (genresIncluded !== undefined) {
    search.push(['genres', genreListOf(genresIncluded)]);
  }
  if (genresExcluded !== undefined) {
    search.push(['genres_exclude', genreListOf(genresExcluded)]);
  }
  if (yearFrom !== undefined) {
    search.push(['start_date', jikanStartDateFrom(yearFrom)]);
  }
  if (sort !== undefined) {
    search.push(...sortOf(sort.field, sort.direction));
  }
  return withQuery(baseUrl, `/${kind}`, [...search, ...paginationOf(normalized.page)]);
};

/** `/anime/{id}` or `/manga/{id}`, for a key of the jikan namespace only. */
export const jikanDetailUrl = (baseUrl: string, key: MediaKey): string => {
  checkNamespace(key.namespace);
  return `${baseUrl}/${kindOf(key.kind)}/${externalIdOf(key.externalId)}`;
};

/** `/top/anime` or `/top/manga`, without a type or filter. */
export const jikanTopUrl = (baseUrl: string, kind: MediaKind, page: number): string =>
  withQuery(baseUrl, `/top/${kindOf(kind)}`, paginationOf(page));

/**
 * `/seasons/now`, without the `continuing` parameter. tenrai still lists titles airing from earlier
 * seasons (recorded 2026-10-14); whether discovery keeps them is decided by C-08.
 */
export const jikanSeasonNowUrl = (baseUrl: string, page: number): string =>
  withQuery(baseUrl, '/seasons/now', paginationOf(page));

/** `/genres/anime` or `/genres/manga`: every category, explicit genres included. */
export const jikanGenresUrl = (baseUrl: string, kind: MediaKind): string =>
  `${baseUrl}/genres/${kindOf(kind)}`;

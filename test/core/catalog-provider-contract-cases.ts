// the case tables and invariant checks of the catalog provider contract suite
// (catalog-provider-contract.ts). provider-agnostic: the catalog interface and the domain only
import type {
  CatalogProvider,
  Genre,
  MediaDetail,
  MediaSummary,
  Page,
  SearchParams,
} from '@core/catalog/catalog-provider';
import {
  EXTERNAL_ID_MAX,
  MEDIA_FORMATS_BY_KIND,
  MEDIA_KINDS,
  MEDIA_STATUSES,
  type MediaFormat,
  type MediaIdNamespace,
  type MediaKey,
  type MediaKind,
  type SearchableMediaFormat,
} from '@core/domain/media';

import type { ContractCall, ContractScenario, PageCall } from './catalog-provider-contract-support';

export const SEARCH_ANIME: ContractCall = { method: 'search', kind: 'anime' };
const TOP_ANIME: ContractCall = { method: 'getTop', kind: 'anime' };
const TOP_MANGA: ContractCall = { method: 'getTop', kind: 'manga' };
const DETAIL_ANIME: ContractCall = { method: 'getDetail', kind: 'anime' };
const DETAIL_MANGA: ContractCall = { method: 'getDetail', kind: 'manga' };
const GENRES_ANIME: ContractCall = { method: 'getGenres', kind: 'anime' };

// out-of-contract inputs, as a caller bypassing the types would pass them
const UNKNOWN_KIND = 'novel' as unknown as MediaKind;
const FOREIGN_NAMESPACE = 'contract-foreign' as unknown as MediaIdNamespace;
// a manga format without a jikan type, outside SEARCHABLE_MANGA_FORMATS
const OEL_FORMAT = 'oel' as unknown as SearchableMediaFormat;

// page 2 proves that `page` echoes the request, not the payload
export const PAGE_CASES: readonly {
  readonly label: string;
  readonly call: PageCall;
  readonly page: number;
}[] = [
  { label: 'anime search', call: { method: 'search', kind: 'anime' }, page: 1 },
  { label: 'manga search', call: { method: 'search', kind: 'manga' }, page: 2 },
  { label: 'top anime', call: { method: 'getTop', kind: 'anime' }, page: 2 },
  { label: 'top manga', call: { method: 'getTop', kind: 'manga' }, page: 1 },
  { label: 'current season', call: { method: 'getCurrentSeason' }, page: 1 },
];

export type AdultCall = Extract<ContractCall, { readonly method: 'search' | 'getDetail' }>;

export const ADULT_CASES: readonly {
  readonly scenario: ContractScenario;
  readonly call: AdultCall;
}[] = [
  ...MEDIA_KINDS.flatMap((kind) => [
    { scenario: 'adult-genre', call: { method: 'search', kind } } as const,
    { scenario: 'adult-genre', call: { method: 'getDetail', kind } } as const,
  ]),
  { scenario: 'adult-rating', call: { method: 'search', kind: 'anime' } },
  { scenario: 'adult-rating', call: { method: 'getDetail', kind: 'anime' } },
];

// one call per response shape: a page, a detail and a genre list
export const ERROR_CALLS: readonly ContractCall[] = [SEARCH_ANIME, DETAIL_MANGA, GENRES_ANIME];

export const ABORT_CALLS: readonly ContractCall[] = [
  SEARCH_ANIME,
  DETAIL_MANGA,
  { method: 'getCurrentSeason' },
];

/** inputs each method rejects with a RangeError; `key` is the anime detail key of the harness. */
export const GUARD_CASES: readonly {
  readonly label: string;
  readonly call: ContractCall;
  readonly run: (provider: CatalogProvider, key: MediaKey) => Promise<unknown>;
}[] = [
  { label: 'search page 0', call: SEARCH_ANIME, run: (p) => p.search({ kind: 'anime', page: 0 }) },
  {
    label: 'search page 1.5',
    call: SEARCH_ANIME,
    run: (p) => p.search({ kind: 'manga', page: 1.5 }),
  },
  {
    label: 'top page 0',
    call: TOP_MANGA,
    run: (p) => p.getTop({ kind: 'manga', page: 0 }),
  },
  {
    label: 'season page 1.5',
    call: { method: 'getCurrentSeason' },
    run: (p) => p.getCurrentSeason(1.5),
  },
  {
    label: 'a search of an unknown kind',
    call: SEARCH_ANIME,
    run: (p) => p.search({ kind: UNKNOWN_KIND, page: 1 }),
  },
  {
    label: 'top of an unknown kind',
    call: TOP_ANIME,
    run: (p) => p.getTop({ kind: UNKNOWN_KIND, page: 1 }),
  },
  {
    label: 'a top format of the other kind',
    call: TOP_MANGA,
    run: (p) => p.getTop({ kind: 'manga', format: 'tv', page: 1 }),
  },
  {
    label: 'a top format without a provider type',
    call: TOP_MANGA,
    run: (p) => p.getTop({ kind: 'manga', format: OEL_FORMAT, page: 1 }),
  },
  { label: 'genres of an unknown kind', call: GENRES_ANIME, run: (p) => p.getGenres(UNKNOWN_KIND) },
  {
    label: 'a detail of an unknown kind',
    call: DETAIL_ANIME,
    run: (p, key) => p.getDetail({ ...key, kind: UNKNOWN_KIND }),
  },
  {
    label: 'a detail key in another namespace',
    call: DETAIL_ANIME,
    run: (p, key) => p.getDetail({ ...key, namespace: FOREIGN_NAMESPACE }),
  },
  {
    label: 'a detail with externalId 0',
    call: DETAIL_ANIME,
    run: (p, key) => p.getDetail({ ...key, externalId: 0 }),
  },
  {
    label: 'a detail with externalId EXTERNAL_ID_MAX + 1',
    call: DETAIL_ANIME,
    run: (p, key) => p.getDetail({ ...key, externalId: EXTERNAL_ID_MAX + 1 }),
  },
];

/** pairs of searches with one normalized form (normalizeSearchParams). */
export const EQUIVALENT_SEARCHES: readonly {
  readonly label: string;
  readonly first: SearchParams;
  readonly second: SearchParams;
}[] = [
  {
    label: 'genre ids in another order',
    first: { kind: 'anime', genresIncluded: [2, 1], page: 1 },
    second: { kind: 'anime', genresIncluded: [1, 2], page: 1 },
  },
  {
    label: 'a query with surrounding spaces',
    first: { kind: 'anime', query: ' x ', page: 1 },
    second: { kind: 'anime', query: 'x', page: 1 },
  },
];

// a check is a rule and whether it holds; the violations name the failing rules
type Check = readonly [rule: string, holds: boolean];

const violations = (subject: string, checks: readonly Check[]): readonly string[] =>
  checks.filter(([, holds]) => !holds).map(([rule]) => `${subject}: ${rule}`);

const SCORE_MAX = 10;
const FOUR_DIGITS = /^\d{4}$/;
const HTTPS_PREFIX = 'https://';

const isPositiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const isNotBlank = (value: string): boolean => value.trim() !== '';

const areUnique = (values: readonly number[]): boolean => new Set(values).size === values.length;

// typed values checked at run time: the adapter output is what is under test
const isTextOrNull = (value: string | null): boolean =>
  value === null || typeof (value as unknown) === 'string';

const isBoolean = (value: boolean): boolean => typeof (value as unknown) === 'boolean';

export const pageViolations = (
  page: Page<MediaSummary>,
  requestedPage: number,
): readonly string[] =>
  violations('page', [
    ['page is the requested page', page.page === requestedPage],
    ['lastPage is at least 1', isPositiveInteger(page.lastPage)],
    ['hasNextPage is a boolean', isBoolean(page.hasNextPage)],
  ]);

/** the invariants of an item of `kind` returned by a provider of `namespace`. */
export const summaryViolations = (
  item: MediaSummary,
  namespace: string,
  kind: MediaKind,
): readonly string[] => {
  const formats: readonly MediaFormat[] = MEDIA_FORMATS_BY_KIND[kind];
  const { key, score, totalUnits, year, imageUrl } = item;
  return violations(`${key.kind} ${String(key.externalId)}`, [
    ['key.namespace is the provider namespace', key.namespace === namespace],
    ['key.kind is the requested kind', key.kind === kind],
    [
      'key.externalId is an integer in 1..EXTERNAL_ID_MAX',
      isPositiveInteger(key.externalId) && key.externalId <= EXTERNAL_ID_MAX,
    ],
    ['title is not blank', isNotBlank(item.title)],
    ['format is a format of the kind', formats.includes(item.format)],
    ['status is a media status', MEDIA_STATUSES.includes(item.status)],
    ['imageUrl is null or https', imageUrl === null || imageUrl.startsWith(HTTPS_PREFIX)],
    ['score is null or in (0, 10]', score === null || (score > 0 && score <= SCORE_MAX)],
    [
      'totalUnits is null or a positive integer',
      totalUnits === null || isPositiveInteger(totalUnits),
    ],
    ['year is null or four digits', year === null || FOUR_DIGITS.test(String(year))],
    ['genre ids are unique', areUnique(item.genres.map((genre) => genre.id))],
    ['isAdult is a boolean', isBoolean(item.isAdult)],
  ]);
};

export const detailViolations = (detail: MediaDetail): readonly string[] =>
  violations('detail', [
    ['synopsis is a string or null', isTextOrNull(detail.synopsis)],
    ['titleNative is a string or null', isTextOrNull(detail.titleNative)],
  ]);

export const genreListViolations = (genres: readonly Genre[]): readonly string[] =>
  violations('genres', [
    ['ids are positive integers', genres.every((genre) => isPositiveInteger(genre.id))],
    ['ids are unique', areUnique(genres.map((genre) => genre.id))],
    ['names are not blank', genres.every((genre) => isNotBlank(genre.name))],
  ]);

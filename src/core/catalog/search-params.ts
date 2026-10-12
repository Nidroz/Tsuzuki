// canonical form of search params, so equivalent searches share one query key and one request
import type { MediaFormat } from '../domain/media';
import type { SearchParams } from './catalog-provider';

// separator used to flatten an array filter into a single key primitive
const KEY_LIST_SEPARATOR = ',';

const compareStrings = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
};

const sortedUniqueFormats = (values: readonly MediaFormat[]): readonly MediaFormat[] =>
  [...new Set(values)].sort(compareStrings);

const sortedUniqueIds = (values: readonly number[]): readonly number[] =>
  [...new Set(values)].sort((a, b) => a - b);

/**
 * returns the canonical form of `params`: the query trimmed and dropped when empty,
 * array filters sorted ascending, deduplicated and dropped when empty. absent keys stay absent.
 */
export const normalizeSearchParams = (params: SearchParams): SearchParams => {
  const { query, formats, genresIncluded, genresExcluded, ...rest } = params;
  const trimmedQuery = query?.trim();
  const normalizedFormats = formats === undefined ? [] : sortedUniqueFormats(formats);
  const normalizedIncluded = genresIncluded === undefined ? [] : sortedUniqueIds(genresIncluded);
  const normalizedExcluded = genresExcluded === undefined ? [] : sortedUniqueIds(genresExcluded);
  return {
    ...rest,
    ...(trimmedQuery === undefined || trimmedQuery === '' ? {} : { query: trimmedQuery }),
    ...(normalizedFormats.length === 0 ? {} : { formats: normalizedFormats }),
    ...(normalizedIncluded.length === 0 ? {} : { genresIncluded: normalizedIncluded }),
    ...(normalizedExcluded.length === 0 ? {} : { genresExcluded: normalizedExcluded }),
  };
};

/** the primitives of a search query key, in a fixed order with `page` last. */
export type SearchKeyParts = readonly [
  kind: SearchParams['kind'],
  query: string | null,
  formats: string | null,
  genresIncluded: string | null,
  genresExcluded: string | null,
  status: NonNullable<SearchParams['status']> | null,
  year: number | null,
  minScore: number | null,
  sortField: NonNullable<SearchParams['sort']>['field'] | null,
  sortDirection: NonNullable<SearchParams['sort']>['direction'] | null,
  page: number,
];

const joinOrNull = (values: readonly (string | number)[] | undefined): string | null =>
  values === undefined ? null : values.join(KEY_LIST_SEPARATOR);

/** flattens the normalized `params` into the primitives used by `queryKeys.search`. */
export const searchKeyParts = (params: SearchParams): SearchKeyParts => {
  const normalized = normalizeSearchParams(params);
  return [
    normalized.kind,
    normalized.query ?? null,
    joinOrNull(normalized.formats),
    joinOrNull(normalized.genresIncluded),
    joinOrNull(normalized.genresExcluded),
    normalized.status ?? null,
    normalized.year ?? null,
    normalized.minScore ?? null,
    normalized.sort?.field ?? null,
    normalized.sort?.direction ?? null,
    normalized.page,
  ];
};

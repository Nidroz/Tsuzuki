// the search filters state of the filters sheet (FR-03, docs/ARCHITECTURE.md §6) and its rules,
// pure: the screen holds a draft of it, and toSearchParams turns the applied one into SearchParams
import type { SearchParams, SearchSortField, SortDirection } from '../catalog/catalog-provider';
import type { MediaKind, SearchableMediaFormat, SearchableMediaStatus } from './media';

/** a sort field with its direction. */
export interface SearchSort {
  readonly field: SearchSortField;
  readonly direction: SortDirection;
}

/**
 * the filters of a search, the kind and the text aside (held by the screen). `null` and an empty
 * genre list do not filter; a `null` sort is the provider relevance order. the format and the
 * genres belong to the current kind: a kind change goes through filtersForKind.
 */
export interface SearchFilters {
  readonly format: SearchableMediaFormat | null;
  readonly genresIncluded: readonly number[];
  readonly genresExcluded: readonly number[];
  readonly status: SearchableMediaStatus | null;
  readonly yearFrom: number | null;
  readonly minScore: number | null;
  readonly sort: SearchSort | null;
}

/** no filter at all: the initial state, and the reset of the sheet. */
export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  format: null,
  genresIncluded: [],
  genresExcluded: [],
  status: null,
  yearFrom: null,
  minScore: null,
  sort: null,
};

/** the lowest and highest year of the year filter: four digits, as the providers read a year. */
export const YEAR_FROM_MIN = 1000;
export const YEAR_FROM_MAX = 9999;

// whole points of the 0-10 score scale, from 5 to 9
const MIN_SCORE_OPTION_LOWEST = 5;
const MIN_SCORE_OPTION_COUNT = 5;

/** the minimum scores the sheet offers, ascending: 5, 6, 7, 8, 9. */
export const MIN_SCORE_OPTIONS: readonly number[] = Array.from(
  { length: MIN_SCORE_OPTION_COUNT },
  (_, index) => MIN_SCORE_OPTION_LOWEST + index,
);

/** the direction a sort field starts with when it is chosen. */
export const DEFAULT_SORT_DIRECTION = {
  score: 'desc',
  popularity: 'desc',
  title: 'asc',
  start_date: 'desc',
} as const satisfies Readonly<Record<SearchSortField, SortDirection>>;

/** the states of a genre chip, in the order a tap cycles through them. */
export const GENRE_FILTER_STATES = ['neutral', 'included', 'excluded'] as const;

export type GenreFilterState = (typeof GENRE_FILTER_STATES)[number];

const isPositiveSafeInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/** `filters` with the format `format`, or without a format filter when `null`. */
export const setFormat = (
  filters: SearchFilters,
  format: SearchableMediaFormat | null,
): SearchFilters => ({
  ...filters,
  format,
});

/** the state of the genre `genreId` in `filters`: included, excluded or neutral. */
export const genreFilterState = (filters: SearchFilters, genreId: number): GenreFilterState => {
  if (filters.genresIncluded.includes(genreId)) {
    return 'included';
  }
  return filters.genresExcluded.includes(genreId) ? 'excluded' : 'neutral';
};

/**
 * `filters` with the genre `genreId` moved to its next state: neutral -> included -> excluded ->
 * neutral. a list already holding `max` ids is skipped: neutral goes to excluded when the included
 * list is full, and stays neutral when both are full; included goes to neutral when the excluded
 * list is full. `max` is the provider's searchGenresMax, so neither list ever exceeds it. throws a
 * RangeError when `max` or `genreId` is not a positive safe integer.
 */
export const cycleGenre = (filters: SearchFilters, genreId: number, max: number): SearchFilters => {
  if (!isPositiveSafeInteger(max)) {
    throw new RangeError('Genre filter limit must be a positive integer');
  }
  if (!isPositiveSafeInteger(genreId)) {
    throw new RangeError('Genre id must be a positive integer');
  }
  const included = filters.genresIncluded;
  const excluded = filters.genresExcluded;
  const withoutGenre = (ids: readonly number[]) => ids.filter((id) => id !== genreId);
  switch (genreFilterState(filters, genreId)) {
    case 'neutral':
      if (included.length < max) {
        return { ...filters, genresIncluded: [...included, genreId] };
      }
      return excluded.length < max
        ? { ...filters, genresExcluded: [...excluded, genreId] }
        : filters;
    case 'included':
      return {
        ...filters,
        genresIncluded: withoutGenre(included),
        genresExcluded: excluded.length < max ? [...excluded, genreId] : excluded,
      };
    case 'excluded':
      return { ...filters, genresExcluded: withoutGenre(excluded) };
  }
};

/** `filters` with the publication status `status`, or without a status filter when `null`. */
export const setStatus = (
  filters: SearchFilters,
  status: SearchableMediaStatus | null,
): SearchFilters => ({
  ...filters,
  status,
});

/**
 * `filters` with titles started on or after the year `yearFrom`, or without a year filter when
 * `null`. throws a RangeError when the year is not an integer in YEAR_FROM_MIN..YEAR_FROM_MAX.
 */
export const setYearFrom = (filters: SearchFilters, yearFrom: number | null): SearchFilters => {
  if (
    yearFrom !== null &&
    !(Number.isInteger(yearFrom) && yearFrom >= YEAR_FROM_MIN && yearFrom <= YEAR_FROM_MAX)
  ) {
    throw new RangeError('Year filter must be a four-digit year');
  }
  return { ...filters, yearFrom };
};

/**
 * `filters` with the minimum score `minScore`, or without a score filter when `null`. throws a
 * RangeError when the score is not one of MIN_SCORE_OPTIONS.
 */
export const setMinScore = (filters: SearchFilters, minScore: number | null): SearchFilters => {
  if (minScore !== null && !MIN_SCORE_OPTIONS.includes(minScore)) {
    throw new RangeError('Minimum score filter must be one of the offered scores');
  }
  return { ...filters, minScore };
};

/**
 * `filters` sorted by `field`, or in the provider relevance order when `null`. a newly chosen field
 * starts with its DEFAULT_SORT_DIRECTION; choosing the current field again keeps its direction.
 */
export const setSortField = (
  filters: SearchFilters,
  field: SearchSortField | null,
): SearchFilters => {
  if (field === null) {
    return { ...filters, sort: null };
  }
  if (filters.sort?.field === field) {
    return filters;
  }
  return { ...filters, sort: { field, direction: DEFAULT_SORT_DIRECTION[field] } };
};

/** `filters` with the sort direction `direction`; unchanged when no sort field is chosen. */
export const setSortDirection = (
  filters: SearchFilters,
  direction: SortDirection,
): SearchFilters =>
  filters.sort === null ? filters : { ...filters, sort: { ...filters.sort, direction } };

/**
 * `filters` for another kind: the format and the genres are cleared (formats and genre ids belong
 * to one kind), the status, year, minimum score and sort are kept.
 */
export const filtersForKind = (filters: SearchFilters): SearchFilters => ({
  ...filters,
  format: null,
  genresIncluded: [],
  genresExcluded: [],
});

/**
 * the number of active filters, one per field that differs from EMPTY_SEARCH_FILTERS: format,
 * included genres, excluded genres, status, year, minimum score and sort, so 0 to 7.
 */
export const activeFilterCount = (filters: SearchFilters): number =>
  [
    filters.format !== null,
    filters.genresIncluded.length > 0,
    filters.genresExcluded.length > 0,
    filters.status !== null,
    filters.yearFrom !== null,
    filters.minScore !== null,
    filters.sort !== null,
  ].filter(Boolean).length;

/** whether any filter is active, sort included: then a search runs even without text. */
export const hasActiveFilters = (filters: SearchFilters): boolean => activeFilterCount(filters) > 0;

/**
 * the search params of `kind`, the prepared `query` (`null` when there is no text) and `filters`
 * for the 1-based `page`. a field that does not filter is left out, never set to `undefined`: no
 * query for `null`, `formats` as a one-element list, no empty genre list.
 */
export const toSearchParams = (
  kind: MediaKind,
  query: string | null,
  filters: SearchFilters,
  page: number,
): SearchParams => {
  const { format, genresIncluded, genresExcluded, status, yearFrom, minScore, sort } = filters;
  return {
    kind,
    ...(query === null ? {} : { query }),
    ...(format === null ? {} : { formats: [format] }),
    ...(genresIncluded.length === 0 ? {} : { genresIncluded: [...genresIncluded] }),
    ...(genresExcluded.length === 0 ? {} : { genresExcluded: [...genresExcluded] }),
    ...(status === null ? {} : { status }),
    ...(yearFrom === null ? {} : { yearFrom }),
    ...(minScore === null ? {} : { minScore }),
    ...(sort === null ? {} : { sort: { field: sort.field, direction: sort.direction } }),
    page,
  };
};

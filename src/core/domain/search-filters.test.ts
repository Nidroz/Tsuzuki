import { describe, expect, it } from '@jest/globals';

import type { SearchSortField, SortDirection } from '../catalog/catalog-provider';
import {
  DEFAULT_SORT_DIRECTION,
  EMPTY_SEARCH_FILTERS,
  MIN_SCORE_OPTIONS,
  YEAR_FROM_MAX,
  YEAR_FROM_MIN,
  activeFilterCount,
  cycleGenre,
  filtersForKind,
  genreFilterState,
  hasActiveFilters,
  setFormat,
  setMinScore,
  setSortDirection,
  setSortField,
  setStatus,
  setYearFrom,
  toSearchParams,
  type SearchFilters,
} from './search-filters';

// the search filters state of the filters sheet, FR-03 (docs/ARCHITECTURE.md §6)

const MAX = 3;

const withGenres = (included: number[], excluded: number[]): SearchFilters => ({
  ...EMPTY_SEARCH_FILTERS,
  genresIncluded: included,
  genresExcluded: excluded,
});

const EVERY_FILTER: SearchFilters = {
  format: 'tv',
  genresIncluded: [1, 4],
  genresExcluded: [9],
  status: 'ongoing',
  yearFrom: 1999,
  minScore: 7,
  sort: { field: 'score', direction: 'asc' },
};

describe('the constants', () => {
  it('offer whole minimum scores from 5 to 9 and four-digit years', () => {
    expect(MIN_SCORE_OPTIONS).toStrictEqual([5, 6, 7, 8, 9]);
    expect([YEAR_FROM_MIN, YEAR_FROM_MAX]).toStrictEqual([1000, 9999]);
  });

  it('start with no filter at all', () => {
    expect(activeFilterCount(EMPTY_SEARCH_FILTERS)).toBe(0);
  });
});

describe('the genre cycle', () => {
  it('moves a genre neutral -> included -> excluded -> neutral', () => {
    const included = cycleGenre(EMPTY_SEARCH_FILTERS, 7, MAX);
    const excluded = cycleGenre(included, 7, MAX);
    const neutral = cycleGenre(excluded, 7, MAX);

    expect([included, excluded, neutral].map((f) => genreFilterState(f, 7))).toStrictEqual([
      'included',
      'excluded',
      'neutral',
    ]);
    expect(excluded).toMatchObject({ genresIncluded: [], genresExcluded: [7] });
    expect(neutral).toStrictEqual(EMPTY_SEARCH_FILTERS);
  });

  it('keeps the other genres and their order', () => {
    expect(cycleGenre(withGenres([3, 1], [8]), 5, MAX)).toMatchObject({
      genresIncluded: [3, 1, 5],
      genresExcluded: [8],
    });
    expect(cycleGenre(withGenres([3, 1], [8]), 3, MAX)).toMatchObject({
      genresIncluded: [1],
      genresExcluded: [8, 3],
    });
  });

  it('sends a neutral genre to excluded when the included list is full', () => {
    const next = cycleGenre(withGenres([1, 2, 3], []), 7, MAX);

    expect(next).toMatchObject({ genresIncluded: [1, 2, 3], genresExcluded: [7] });
  });

  it('sends an included genre back to neutral when the excluded list is full', () => {
    const next = cycleGenre(withGenres([7], [4, 5, 6]), 7, MAX);

    expect(next).toMatchObject({ genresIncluded: [], genresExcluded: [4, 5, 6] });
    expect(genreFilterState(next, 7)).toBe('neutral');
  });

  it('leaves a neutral genre neutral when both lists are full', () => {
    const full = withGenres([1, 2, 3], [4, 5, 6]);

    expect(cycleGenre(full, 7, MAX)).toStrictEqual(full);
    // an excluded genre still leaves its full list
    expect(cycleGenre(full, 4, MAX)).toMatchObject({ genresExcluded: [5, 6] });
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 53])('rejects the limit %p', (max) => {
    expect(() => cycleGenre(EMPTY_SEARCH_FILTERS, 7, max)).toThrow(RangeError);
  });

  it.each([0, -3, 2.5, Number.POSITIVE_INFINITY])('rejects the genre id %p', (id) => {
    expect(() => cycleGenre(EMPTY_SEARCH_FILTERS, id, MAX)).toThrow(RangeError);
  });
});

describe('the setters', () => {
  it('set and clear the format and the status', () => {
    const set = setStatus(setFormat(EMPTY_SEARCH_FILTERS, 'manhwa'), 'finished');

    expect(set).toMatchObject({ format: 'manhwa', status: 'finished' });
    expect(setStatus(setFormat(set, null), null)).toStrictEqual(EMPTY_SEARCH_FILTERS);
  });

  it.each([YEAR_FROM_MIN, 1999, YEAR_FROM_MAX])('set the year %p', (year) => {
    expect(setYearFrom(EMPTY_SEARCH_FILTERS, year).yearFrom).toBe(year);
    expect(setYearFrom(setYearFrom(EMPTY_SEARCH_FILTERS, year), null).yearFrom).toBeNull();
  });

  it.each([999, 10_000, 2024.5, Number.NaN])('reject the year %p', (year) => {
    expect(() => setYearFrom(EMPTY_SEARCH_FILTERS, year)).toThrow(RangeError);
  });

  it.each([5, 7, 9])('set the minimum score %p', (score) => {
    expect(setMinScore(EMPTY_SEARCH_FILTERS, score).minScore).toBe(score);
    expect(setMinScore(setMinScore(EMPTY_SEARCH_FILTERS, score), null).minScore).toBeNull();
  });

  it.each([4, 10, 7.5, 0])('reject the minimum score %p', (score) => {
    expect(() => setMinScore(EMPTY_SEARCH_FILTERS, score)).toThrow(RangeError);
  });
});

describe('the sort', () => {
  it.each<[SearchSortField, SortDirection]>([
    ['score', 'desc'],
    ['popularity', 'desc'],
    ['start_date', 'desc'],
    ['title', 'asc'],
  ])('starts a newly chosen %s with %s', (field, direction) => {
    expect(DEFAULT_SORT_DIRECTION[field]).toBe(direction);
    expect(setSortField(EMPTY_SEARCH_FILTERS, field).sort).toStrictEqual({ field, direction });
  });

  it('keeps the direction when the current field is chosen again', () => {
    const ascending = setSortDirection(setSortField(EMPTY_SEARCH_FILTERS, 'score'), 'asc');

    expect(setSortField(ascending, 'score').sort).toStrictEqual({
      field: 'score',
      direction: 'asc',
    });
  });

  it('resets the direction when another field is chosen', () => {
    const ascending = setSortDirection(setSortField(EMPTY_SEARCH_FILTERS, 'score'), 'asc');

    expect(setSortField(ascending, 'popularity').sort).toStrictEqual({
      field: 'popularity',
      direction: 'desc',
    });
  });

  it('goes back to relevance with null', () => {
    expect(setSortField(EVERY_FILTER, null).sort).toBeNull();
  });

  it('leaves filters without a sort unchanged on a direction change', () => {
    expect(setSortDirection(EMPTY_SEARCH_FILTERS, 'asc')).toStrictEqual(EMPTY_SEARCH_FILTERS);
  });
});

describe('filtersForKind', () => {
  it('clears the format and the genres, and keeps the rest', () => {
    expect(filtersForKind(EVERY_FILTER)).toStrictEqual({
      ...EVERY_FILTER,
      format: null,
      genresIncluded: [],
      genresExcluded: [],
    });
  });

  it('leaves empty filters empty', () => {
    expect(filtersForKind(EMPTY_SEARCH_FILTERS)).toStrictEqual(EMPTY_SEARCH_FILTERS);
  });
});

describe('activeFilterCount and hasActiveFilters', () => {
  it.each<[string, SearchFilters, number]>([
    ['no filter', EMPTY_SEARCH_FILTERS, 0],
    ['a sort alone', setSortField(EMPTY_SEARCH_FILTERS, 'title'), 1],
    ['an excluded genre alone', withGenres([], [2]), 1],
    ['three genres in one list', withGenres([1, 2, 3], []), 1],
    ['both genre lists and a year', { ...withGenres([1], [2]), yearFrom: 2001 }, 3],
    ['every filter', EVERY_FILTER, 7],
  ])('counts %s as %d', (_, filters, count) => {
    expect(activeFilterCount(filters)).toBe(count);
    expect(hasActiveFilters(filters)).toBe(count > 0);
  });
});

describe('toSearchParams', () => {
  it('leaves out every field that does not filter', () => {
    const params = toSearchParams('anime', null, EMPTY_SEARCH_FILTERS, 1);

    expect(params).toStrictEqual({ kind: 'anime', page: 1 });
    expect(Object.keys(params)).toStrictEqual(['kind', 'page']);
  });

  it('sends the query, and every filter with the format as a one-element list', () => {
    expect(toSearchParams('anime', 'frieren', EVERY_FILTER, 2)).toStrictEqual({
      kind: 'anime',
      query: 'frieren',
      formats: ['tv'],
      genresIncluded: [1, 4],
      genresExcluded: [9],
      status: 'ongoing',
      yearFrom: 1999,
      minScore: 7,
      sort: { field: 'score', direction: 'asc' },
      page: 2,
    });
  });

  it('leaves out an empty genre list and keeps the other', () => {
    const params = toSearchParams('manga', null, withGenres([], [12]), 1);

    expect(params).toStrictEqual({ kind: 'manga', genresExcluded: [12], page: 1 });
    expect(params).not.toHaveProperty('genresIncluded');
  });

  it('sends the year and the sort alone', () => {
    const filters = setSortField(setYearFrom(EMPTY_SEARCH_FILTERS, 2010), 'start_date');

    expect(toSearchParams('anime', null, filters, 1)).toStrictEqual({
      kind: 'anime',
      yearFrom: 2010,
      sort: { field: 'start_date', direction: 'desc' },
      page: 1,
    });
  });
});

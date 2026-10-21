import { describe, expect, it } from '@jest/globals';

import type { Genre } from '../catalog/catalog-provider';
import { EMPTY_SEARCH_FILTERS, withoutAdultGenres, type SearchFilters } from './search-filters';

// adult genres in the applied search filters, BR-06 (ADR-0004)

const ACTION = 1;
const HENTAI = 12;
const EROTICA = 49;
const UNKNOWN = 99;

const GENRES: readonly Genre[] = [
  { id: ACTION, name: 'Action' },
  { id: HENTAI, name: 'Hentai' },
  { id: EROTICA, name: ' EROTICA ' },
];

const withGenres = (included: number[], excluded: number[]): SearchFilters => ({
  ...EMPTY_SEARCH_FILTERS,
  minScore: 7,
  genresIncluded: included,
  genresExcluded: excluded,
});

describe('withoutAdultGenres', () => {
  it('removes an included adult genre and keeps the other filters', () => {
    expect(withoutAdultGenres(withGenres([ACTION, HENTAI], []), GENRES)).toEqual(
      withGenres([ACTION], []),
    );
  });

  it('removes an excluded adult genre', () => {
    expect(withoutAdultGenres(withGenres([ACTION], [HENTAI]), GENRES)).toEqual(
      withGenres([ACTION], []),
    );
  });

  it('matches the adult genre name case-insensitively and trimmed', () => {
    expect(withoutAdultGenres(withGenres([EROTICA], [EROTICA, ACTION]), GENRES)).toEqual(
      withGenres([], [ACTION]),
    );
  });

  it('keeps non-adult ids and ids absent from the genre list', () => {
    expect(withoutAdultGenres(withGenres([ACTION, UNKNOWN], [HENTAI]), GENRES)).toEqual(
      withGenres([ACTION, UNKNOWN], []),
    );
  });

  it('returns the same filters when no adult genre is applied', () => {
    const filters = withGenres([ACTION, UNKNOWN], [UNKNOWN]);
    const unknownGenres = withGenres([HENTAI], []);

    expect(withoutAdultGenres(filters, GENRES)).toBe(filters);
    expect(withoutAdultGenres(EMPTY_SEARCH_FILTERS, GENRES)).toBe(EMPTY_SEARCH_FILTERS);
    expect(withoutAdultGenres(unknownGenres, [])).toBe(unknownGenres);
  });
});

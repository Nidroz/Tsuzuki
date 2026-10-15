import { describe, expect, it } from '@jest/globals';

import type { SearchParams } from './catalog-provider';
import { normalizeSearchParams, searchKeyParts } from './search-params';

describe('normalizeSearchParams', () => {
  it('trims the query', () => {
    expect(normalizeSearchParams({ kind: 'anime', query: '  naruto \n', page: 1 })).toStrictEqual({
      kind: 'anime',
      query: 'naruto',
      page: 1,
    });
  });

  it.each(['', '   ', '\t\n'])('drops a blank query %j', (query) => {
    const normalized = normalizeSearchParams({ kind: 'anime', query, page: 1 });
    expect(normalized).not.toHaveProperty('query');
  });

  it('sorts and deduplicates array filters, genre ids numerically', () => {
    const normalized = normalizeSearchParams({
      kind: 'manga',
      formats: ['novel', 'manga', 'novel', 'light_novel'],
      genresIncluded: [10, 9, 10],
      genresExcluded: [100, 2, 20, 2],
      page: 1,
    });
    expect(normalized.formats).toStrictEqual(['light_novel', 'manga', 'novel']);
    expect(normalized.genresIncluded).toStrictEqual([9, 10]);
    expect(normalized.genresExcluded).toStrictEqual([2, 20, 100]);
  });

  it('drops empty arrays without leaving undefined keys and keeps other fields', () => {
    const normalized = normalizeSearchParams({
      kind: 'anime',
      formats: [],
      genresIncluded: [],
      genresExcluded: [],
      status: 'ongoing',
      yearFrom: 2024,
      page: 3,
    });
    expect(normalized).not.toHaveProperty('formats');
    expect(normalized).not.toHaveProperty('genresIncluded');
    expect(normalized).not.toHaveProperty('genresExcluded');
    expect(normalized).toStrictEqual({ kind: 'anime', status: 'ongoing', yearFrom: 2024, page: 3 });
  });

  it('does not mutate the input arrays', () => {
    const genresIncluded = [10, 9, 10];
    normalizeSearchParams({ kind: 'anime', genresIncluded, page: 1 });
    expect(genresIncluded).toStrictEqual([10, 9, 10]);
  });
});

describe('searchKeyParts', () => {
  it('uses null for every absent field and puts the page last', () => {
    expect(searchKeyParts({ kind: 'anime', page: 2 })).toStrictEqual([
      'anime',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      2,
    ]);
  });

  it('flattens every field of the normalized params in a fixed order', () => {
    const params: SearchParams = {
      kind: 'manga',
      query: ' one piece ',
      formats: ['manhwa', 'manga'],
      genresIncluded: [10, 9, 10],
      genresExcluded: [3],
      status: 'finished',
      yearFrom: 1999,
      minScore: 7.5,
      sort: { field: 'score', direction: 'desc' },
      page: 4,
    };
    expect(searchKeyParts(params)).toStrictEqual([
      'manga',
      'one piece',
      'manga,manhwa',
      '9,10',
      '3',
      'finished',
      1999,
      7.5,
      'score',
      'desc',
      4,
    ]);
  });
});

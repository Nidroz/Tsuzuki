import { describe, expect, it } from '@jest/globals';

import type { SearchParams } from '../catalog/catalog-provider';
import { queryKeys } from './keys';

describe('queryKeys', () => {
  it('builds media, top, season and genres keys from primitives', () => {
    expect(queryKeys.media('anime', 1)).toStrictEqual(['media', 'anime', 1]);
    expect(queryKeys.top('jikan', 'manga', 2)).toStrictEqual(['top', 'jikan', 'manga', 2]);
    expect(queryKeys.season('jikan', 3)).toStrictEqual(['season', 'jikan', 3]);
    expect(queryKeys.genres('jikan', 'anime')).toStrictEqual(['genres', 'jikan', 'anime']);
  });

  it('builds library keys', () => {
    expect(queryKeys.library.all()).toStrictEqual(['library']);
    expect(queryKeys.library.entry({ kind: 'manga', malId: 42 })).toStrictEqual([
      'library',
      'manga',
      42,
    ]);
  });

  it('starts every library entry key with the library key', () => {
    const all = queryKeys.library.all();
    const entry = queryKeys.library.entry({ kind: 'anime', malId: 5 });
    expect(entry.slice(0, all.length)).toStrictEqual(all);
  });

  it('returns equal keys for equal inputs', () => {
    expect(queryKeys.media('anime', 7)).toStrictEqual(queryKeys.media('anime', 7));
    expect(queryKeys.media('anime', 7)).not.toStrictEqual(queryKeys.media('manga', 7));
  });
});

describe('queryKeys.search', () => {
  const base: SearchParams = {
    kind: 'anime',
    query: 'frieren',
    formats: ['tv', 'movie'],
    genresIncluded: [9, 10],
    page: 1,
  };

  it('gives equal keys for equivalent params', () => {
    const equivalent: SearchParams = {
      kind: 'anime',
      query: '  frieren ',
      formats: ['movie', 'tv', 'movie'],
      genresIncluded: [10, 9, 10],
      genresExcluded: [],
      page: 1,
    };
    expect(queryKeys.search('jikan', equivalent)).toStrictEqual(queryKeys.search('jikan', base));
  });

  it('gives different keys for a different page or filter', () => {
    const key = queryKeys.search('jikan', base);
    expect(queryKeys.search('jikan', { ...base, page: 2 })).not.toStrictEqual(key);
    expect(queryKeys.search('jikan', { ...base, genresIncluded: [9] })).not.toStrictEqual(key);
    expect(queryKeys.search('jikan', { ...base, status: 'finished' })).not.toStrictEqual(key);
  });

  it('starts with the search scope and the provider, and ends with the page', () => {
    const key = queryKeys.search('jikan', { ...base, page: 3 });
    expect(key.slice(0, 2)).toStrictEqual(['search', 'jikan']);
    expect(key.at(-1)).toBe(3);
  });

  it('contains only primitives', () => {
    const key = queryKeys.search('jikan', {
      ...base,
      genresExcluded: [1],
      status: 'ongoing',
      year: 2023,
      minScore: 8,
      sort: { field: 'popularity', direction: 'asc' },
    });
    for (const part of key) {
      expect(part === null || ['string', 'number'].includes(typeof part)).toBe(true);
    }
  });
});

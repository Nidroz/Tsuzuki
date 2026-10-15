import { describe, expect, it } from '@jest/globals';

import type { SearchParams } from '../catalog/catalog-provider';
import type { MediaKey } from '../domain/media';
import { SEARCH_KEY_ROOT, queryKeys } from './keys';

const animeKey = (externalId: number): MediaKey => ({
  namespace: 'mal',
  kind: 'anime',
  externalId,
});

describe('queryKeys', () => {
  it('builds media, top, season and genres keys from primitives', () => {
    expect(queryKeys.media(animeKey(1))).toStrictEqual(['media', 'mal', 'anime', 1]);
    expect(queryKeys.top('mal', 'manga', 2)).toStrictEqual(['top', 'mal', 'manga', 2]);
    expect(queryKeys.season('mal', 3)).toStrictEqual(['season', 'mal', 3]);
    expect(queryKeys.genres('mal', 'anime')).toStrictEqual(['genres', 'mal', 'anime']);
  });

  it('builds library keys', () => {
    expect(queryKeys.library.all()).toStrictEqual(['library']);
    expect(
      queryKeys.library.entry({ namespace: 'mal', kind: 'manga', externalId: 42 }),
    ).toStrictEqual(['library', 'mal', 'manga', 42]);
  });

  it('starts every library entry key with the library key', () => {
    const all = queryKeys.library.all();
    const entry = queryKeys.library.entry(animeKey(5));
    expect(entry.slice(0, all.length)).toStrictEqual(all);
  });

  it('returns equal keys for equal inputs', () => {
    expect(queryKeys.media(animeKey(7))).toStrictEqual(queryKeys.media(animeKey(7)));
    expect(queryKeys.media(animeKey(7))).not.toStrictEqual(
      queryKeys.media({ namespace: 'mal', kind: 'manga', externalId: 7 }),
    );
  });

  it('holds only the fields of the media key, never a server or instance id', () => {
    // an untyped caller passing extra fields on the key changes nothing
    const key = {
      ...animeKey(9),
      instanceId: 'tenrai',
      baseUrl: 'https://catalog.example.test/v1',
    };
    expect(queryKeys.media(key)).toStrictEqual(queryKeys.media(animeKey(9)));
    expect(queryKeys.library.entry(key)).toStrictEqual(['library', 'mal', 'anime', 9]);
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
    expect(queryKeys.search('mal', equivalent)).toStrictEqual(queryKeys.search('mal', base));
  });

  it('gives different keys for a different page or filter', () => {
    const key = queryKeys.search('mal', base);
    expect(queryKeys.search('mal', { ...base, page: 2 })).not.toStrictEqual(key);
    expect(queryKeys.search('mal', { ...base, genresIncluded: [9] })).not.toStrictEqual(key);
    expect(queryKeys.search('mal', { ...base, status: 'finished' })).not.toStrictEqual(key);
  });

  it('starts with the search scope and the namespace, and ends with the page', () => {
    const key = queryKeys.search('mal', { ...base, page: 3 });
    expect(key.slice(0, 2)).toStrictEqual(['search', 'mal']);
    expect(key.at(-1)).toBe(3);
  });

  it('starts with SEARCH_KEY_ROOT, which no other key family starts with', () => {
    expect(SEARCH_KEY_ROOT).toBe('search');
    expect(queryKeys.search('mal', base)[0]).toBe(SEARCH_KEY_ROOT);
    const others = [
      queryKeys.media(animeKey(1)),
      queryKeys.top('mal', 'anime', 1),
      queryKeys.season('mal', 1),
      queryKeys.genres('mal', 'anime'),
      queryKeys.library.all(),
      queryKeys.library.entry(animeKey(1)),
    ];
    expect(others.map((key) => key[0])).not.toContain(SEARCH_KEY_ROOT);
  });

  it('gives the idle search key the search root, apart from every search key', () => {
    const idle = queryKeys.searchIdle('mal');
    expect(idle).toStrictEqual([SEARCH_KEY_ROOT, 'mal', 'idle']);
    expect(queryKeys.search('mal', { ...base, query: 'idle' })).not.toStrictEqual(idle);
  });

  it('contains only primitives', () => {
    const key = queryKeys.search('mal', {
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

import { describe, expect, it } from '@jest/globals';

import type { SearchParams } from '../catalog/catalog-provider';
import type { MediaKey } from '../domain/media';
import { LIBRARY_KEY_ROOT, SEARCH_KEY_ROOT, queryKeys, toLibraryScope } from './keys';

const animeKey = (externalId: number): MediaKey => ({
  namespace: 'mal',
  kind: 'anime',
  externalId,
});

const SCOPE = toLibraryScope(1);
const OTHER_SCOPE = toLibraryScope(2);

describe('queryKeys', () => {
  it('builds media, top, season and genres keys from primitives', () => {
    expect(queryKeys.media(animeKey(1))).toStrictEqual(['media', 'mal', 'anime', 1]);
    expect(queryKeys.top('mal', { kind: 'manga', page: 2 })).toStrictEqual([
      'top',
      'mal',
      'manga',
      null,
      2,
    ]);
    expect(queryKeys.season('mal', 3)).toStrictEqual(['season', 'mal', 3]);
    expect(queryKeys.genres('mal', 'anime')).toStrictEqual(['genres', 'mal', 'anime']);
  });

  it('builds library keys holding the scope', () => {
    expect(queryKeys.library.all(SCOPE)).toStrictEqual(['library', 1]);
    expect(
      queryKeys.library.entry(SCOPE, { namespace: 'mal', kind: 'manga', externalId: 42 }),
    ).toStrictEqual(['library', 1, 'mal', 'manga', 42]);
  });

  it('starts every library entry key with the list key of its scope', () => {
    const all = queryKeys.library.all(SCOPE);
    const entry = queryKeys.library.entry(SCOPE, animeKey(5));
    expect(entry.slice(0, all.length)).toStrictEqual(all);
  });

  it('gives each scope its own library keys', () => {
    expect(queryKeys.library.all(OTHER_SCOPE)).not.toStrictEqual(queryKeys.library.all(SCOPE));
    const otherEntry = queryKeys.library.entry(OTHER_SCOPE, animeKey(5));
    const all = queryKeys.library.all(SCOPE);
    expect(otherEntry.slice(0, all.length)).not.toStrictEqual(all);
  });

  it('starts library keys with LIBRARY_KEY_ROOT, which no other key family starts with', () => {
    expect(LIBRARY_KEY_ROOT).toBe('library');
    expect(queryKeys.library.all(SCOPE)[0]).toBe(LIBRARY_KEY_ROOT);
    expect(queryKeys.library.entry(SCOPE, animeKey(1))[0]).toBe(LIBRARY_KEY_ROOT);
    const others = [
      queryKeys.media(animeKey(1)),
      queryKeys.top('mal', { kind: 'anime', page: 1 }),
      queryKeys.season('mal', 1),
      queryKeys.genres('mal', 'anime'),
      queryKeys.search('mal', { kind: 'anime', query: 'library', page: 1 }),
      queryKeys.searchIdle('mal'),
    ];
    expect(others.map((key) => key[0])).not.toContain(LIBRARY_KEY_ROOT);
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
    expect(queryKeys.library.entry(SCOPE, key)).toStrictEqual(['library', 1, 'mal', 'anime', 9]);
  });
});

describe('toLibraryScope', () => {
  it('keeps a non-negative safe integer as is', () => {
    expect(toLibraryScope(0)).toBe(0);
    expect(toLibraryScope(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects %p with a RangeError',
    (value) => {
      expect(() => toLibraryScope(value)).toThrow(RangeError);
    },
  );

  it('is opaque: a raw number is not a scope', () => {
    // @ts-expect-error(type-test): raw numbers are not library scopes
    expect(queryKeys.library.all(1)).toStrictEqual(['library', 1]);
  });
});

describe('queryKeys.top', () => {
  it('holds the format, or null for every format, before the page', () => {
    expect(queryKeys.top('mal', { kind: 'manga', format: 'manhwa', page: 3 })).toStrictEqual([
      'top',
      'mal',
      'manga',
      'manhwa',
      3,
    ]);
    expect(queryKeys.top('mal', { kind: 'manga', page: 3 }).at(-2)).toBeNull();
  });

  it('gives different keys for a different format or page, equal keys for equal params', () => {
    const key = queryKeys.top('mal', { kind: 'manga', format: 'manhwa', page: 1 });
    expect(queryKeys.top('mal', { kind: 'manga', format: 'manhwa', page: 1 })).toStrictEqual(key);
    expect(queryKeys.top('mal', { kind: 'manga', format: 'manhua', page: 1 })).not.toStrictEqual(
      key,
    );
    expect(queryKeys.top('mal', { kind: 'manga', page: 1 })).not.toStrictEqual(key);
    expect(queryKeys.top('mal', { kind: 'manga', format: 'manhwa', page: 2 })).not.toStrictEqual(
      key,
    );
  });

  it('holds only the fields of the params', () => {
    // an untyped caller passing extra fields changes nothing
    const params = { kind: 'anime', format: 'tv', page: 1, priority: 'background' } as const;
    expect(queryKeys.top('mal', params)).toStrictEqual(['top', 'mal', 'anime', 'tv', 1]);
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
      queryKeys.top('mal', { kind: 'anime', page: 1 }),
      queryKeys.season('mal', 1),
      queryKeys.genres('mal', 'anime'),
      queryKeys.library.all(SCOPE),
      queryKeys.library.entry(SCOPE, animeKey(1)),
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
      yearFrom: 2023,
      minScore: 8,
      sort: { field: 'popularity', direction: 'asc' },
    });
    for (const part of key) {
      expect(part === null || ['string', 'number'].includes(typeof part)).toBe(true);
    }
  });
});

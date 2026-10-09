import { describe, expect, it } from '@jest/globals';

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

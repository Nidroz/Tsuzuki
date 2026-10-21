import { describe, expect, it } from '@jest/globals';

import {
  ANIME_FORMATS,
  EXTERNAL_ID_MAX,
  MANGA_FORMATS,
  MEDIA_FORMATS,
  MEDIA_FORMATS_BY_KIND,
  MEDIA_ID_NAMESPACES,
  MEDIA_KINDS,
  MEDIA_STATUSES,
  SEARCHABLE_MEDIA_STATUSES,
  compareMediaKeys,
  isMediaKind,
  type MediaKey,
} from './media';

describe('MEDIA_KINDS', () => {
  it('lists anime and manga, in that order', () => {
    expect(MEDIA_KINDS).toStrictEqual(['anime', 'manga']);
  });
});

describe('MEDIA_ID_NAMESPACES', () => {
  it('lists mal as the only id namespace', () => {
    expect(MEDIA_ID_NAMESPACES).toStrictEqual(['mal']);
  });
});

describe('EXTERNAL_ID_MAX', () => {
  it('is the largest signed 32-bit integer', () => {
    expect(EXTERNAL_ID_MAX).toBe(2_147_483_647);
    expect(EXTERNAL_ID_MAX).toBe(2 ** 31 - 1);
  });

  it('is a safe integer', () => {
    expect(Number.isSafeInteger(EXTERNAL_ID_MAX)).toBe(true);
  });
});

describe('isMediaKind', () => {
  it.each(MEDIA_KINDS)('accepts %s', (kind) => {
    expect(isMediaKind(kind)).toBe(true);
  });

  it.each<[string, string]>([
    ['an unknown kind', 'movie'],
    ['a capitalized kind', 'Anime'],
    ['an upper-case kind', 'ANIME'],
    ['a mixed-case kind', 'mAnGa'],
    ['the empty string', ''],
    ['a kind with a trailing space', 'anime '],
    ['a kind with a leading space', ' manga'],
    ['a kind with a trailing newline', 'anime\n'],
    ['two kinds joined', 'animemanga'],
    ['a plural kind', 'animes'],
    ['a prefix of a kind', 'anim'],
    ['a comma-separated list of kinds', 'anime,manga'],
    // array and object prototype keys must not pass an "in" or index lookup
    ['an array method name', 'includes'],
    ['an object prototype key', 'toString'],
    ['the constructor key', 'constructor'],
    ['the prototype accessor', '__proto__'],
    ['an array index', '0'],
    ['the length key', 'length'],
  ])('rejects %s', (_label, value) => {
    expect(isMediaKind(value)).toBe(false);
  });
});

describe('MEDIA_FORMATS', () => {
  // the satisfies clause only rejects extra formats, this checks none is missing
  it('is exactly the deduplicated union of the anime and manga formats', () => {
    const union = [...new Set<string>([...ANIME_FORMATS, ...MANGA_FORMATS])];
    expect([...MEDIA_FORMATS].sort()).toStrictEqual(union.sort());
  });

  it('lists every format once, with unknown last', () => {
    expect(new Set(MEDIA_FORMATS).size).toBe(MEDIA_FORMATS.length);
    expect(MEDIA_FORMATS.at(-1)).toBe('unknown');
  });
});

describe('MEDIA_FORMATS_BY_KIND', () => {
  it('maps each kind to its format list', () => {
    expect(MEDIA_FORMATS_BY_KIND.anime).toBe(ANIME_FORMATS);
    expect(MEDIA_FORMATS_BY_KIND.manga).toBe(MANGA_FORMATS);
    expect(Object.keys(MEDIA_FORMATS_BY_KIND).sort()).toStrictEqual([...MEDIA_KINDS].sort());
  });
});

describe('MEDIA_STATUSES', () => {
  it('contains every searchable status', () => {
    const statuses: readonly string[] = MEDIA_STATUSES;
    expect(SEARCHABLE_MEDIA_STATUSES.every((status) => statuses.includes(status))).toBe(true);
  });

  it.each(['current', 'planned', 'completed', 'paused', 'dropped'])(
    'does not contain the library status name %s',
    (name) => {
      expect(MEDIA_STATUSES).not.toContain(name);
    },
  );
});

describe('compareMediaKeys', () => {
  const key = (kind: MediaKey['kind'], externalId: number): MediaKey => ({
    namespace: 'mal',
    kind,
    externalId,
  });

  it('orders the kinds as MEDIA_KINDS, before the external id', () => {
    expect(compareMediaKeys(key('anime', 9), key('manga', 1))).toBeLessThan(0);
    expect(compareMediaKeys(key('manga', 1), key('anime', 9))).toBeGreaterThan(0);
  });

  it('orders the external ids of one kind ascending', () => {
    expect(compareMediaKeys(key('manga', 2), key('manga', 10))).toBeLessThan(0);
    expect(compareMediaKeys(key('manga', 10), key('manga', 2))).toBeGreaterThan(0);
  });

  it('is 0 for the same media only', () => {
    expect(compareMediaKeys(key('anime', 5), key('anime', 5))).toBe(0);
  });
});

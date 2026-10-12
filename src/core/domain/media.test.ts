import { describe, expect, it } from '@jest/globals';

import {
  ANIME_FORMATS,
  MAL_ID_MAX,
  MANGA_FORMATS,
  MEDIA_FORMATS,
  MEDIA_FORMATS_BY_KIND,
  MEDIA_KINDS,
  MEDIA_STATUSES,
  SEARCHABLE_MEDIA_STATUSES,
  isMediaKind,
} from './media';

describe('MEDIA_KINDS', () => {
  it('lists anime and manga, in that order', () => {
    expect(MEDIA_KINDS).toStrictEqual(['anime', 'manga']);
  });
});

describe('MAL_ID_MAX', () => {
  it('is the largest signed 32-bit integer', () => {
    expect(MAL_ID_MAX).toBe(2_147_483_647);
    expect(MAL_ID_MAX).toBe(2 ** 31 - 1);
  });

  it('is a safe integer', () => {
    expect(Number.isSafeInteger(MAL_ID_MAX)).toBe(true);
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

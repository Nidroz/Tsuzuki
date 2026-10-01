import { describe, expect, it } from '@jest/globals';

import { MAL_ID_MAX, MEDIA_KINDS, isMediaKind } from './media';

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

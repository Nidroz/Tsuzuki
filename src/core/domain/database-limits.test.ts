import { describe, expect, it } from '@jest/globals';

import {
  MEDIA_IMAGE_URL_MAX_LENGTH,
  MEDIA_TITLE_MAX_LENGTH,
  POSTGRES_INTEGER_MAX,
  codePointLength,
  isStorableText,
  toStorableText,
  truncateToCodePoints,
} from './database-limits';

const NUL = '\u0000';
const LONE_HIGH = '\uD83D';
const LONE_LOW = '\uDE00';
// the emoji U+1F600, the surrogate pair LONE_HIGH + LONE_LOW
const PAIR = '\u{1F600}';
const REPLACEMENT = '\uFFFD';

describe('POSTGRES_INTEGER_MAX', () => {
  it('is the largest signed 32-bit integer', () => {
    expect(POSTGRES_INTEGER_MAX).toBe(2 ** 31 - 1);
  });

  it('is a safe integer', () => {
    expect(Number.isSafeInteger(POSTGRES_INTEGER_MAX)).toBe(true);
  });
});

describe('media text limits', () => {
  it('mirror the library_entries checks', () => {
    expect(MEDIA_TITLE_MAX_LENGTH).toBe(500);
    expect(MEDIA_IMAGE_URL_MAX_LENGTH).toBe(2048);
  });
});

describe('codePointLength', () => {
  it.each<[string, string, number]>([
    ['the empty string', '', 0],
    ['ascii text', 'Frieren', 7],
    ['bmp text', 'フリーレン', 5],
    ['a surrogate pair as one', `a${PAIR}b`, 3],
    ['a lone high surrogate as one', `a${LONE_HIGH}b`, 3],
    ['a lone low surrogate as one', `${LONE_LOW}b`, 2],
    ['a low then a high surrogate as two', `${LONE_LOW}${LONE_HIGH}`, 2],
    ['a high surrogate at the end as one', `ab${LONE_HIGH}`, 3],
  ])('counts %s', (_label, text, length) => {
    expect(codePointLength(text)).toBe(length);
  });

  it('counts astral characters as postgres char_length does, not utf-16 units', () => {
    const text = PAIR.repeat(10);
    expect(text).toHaveLength(20);
    expect(codePointLength(text)).toBe(10);
  });
});

describe('truncateToCodePoints', () => {
  it('returns the text itself when it is not longer', () => {
    const text = `ab${PAIR}`;
    expect(truncateToCodePoints(text, 3)).toBe(text);
    expect(truncateToCodePoints(text, 10)).toBe(text);
  });

  it('keeps the first code points', () => {
    expect(truncateToCodePoints('abcdef', 4)).toBe('abcd');
  });

  it('never splits a surrogate pair', () => {
    expect(truncateToCodePoints(PAIR.repeat(5), 2)).toBe(PAIR.repeat(2));
    expect(truncateToCodePoints(`a${PAIR}b`, 2)).toBe(`a${PAIR}`);
    expect(truncateToCodePoints(`a${PAIR}b`, 1)).toBe('a');
  });

  it('counts a lone surrogate as one code point', () => {
    expect(truncateToCodePoints(`${LONE_HIGH}ab`, 2)).toBe(`${LONE_HIGH}a`);
  });

  it('returns the empty string for a zero length', () => {
    expect(truncateToCodePoints('abc', 0)).toBe('');
  });
});

describe('isStorableText', () => {
  it.each<[string, string]>([
    ['the empty string', ''],
    ['ascii text', 'Sousou no Frieren'],
    ['a valid surrogate pair', `a${PAIR}b`],
    ['the replacement character', REPLACEMENT],
  ])('accepts %s', (_label, text) => {
    expect(isStorableText(text)).toBe(true);
  });

  it.each<[string, string]>([
    ['a NUL', `a${NUL}b`],
    ['a lone high surrogate', `a${LONE_HIGH}b`],
    ['a lone high surrogate at the end', `ab${LONE_HIGH}`],
    ['a lone low surrogate', `${LONE_LOW}b`],
    ['a low then a high surrogate', `${LONE_LOW}${LONE_HIGH}`],
    ['a NUL between the two halves of a pair', `${LONE_HIGH}${NUL}${LONE_LOW}`],
  ])('rejects %s', (_label, text) => {
    expect(isStorableText(text)).toBe(false);
  });
});

describe('toStorableText', () => {
  it('returns the same string when it is already storable', () => {
    const text = `Frieren ${PAIR}`;
    expect(toStorableText(text)).toBe(text);
  });

  it('removes NUL characters', () => {
    expect(toStorableText(`${NUL}a${NUL}b${NUL}`)).toBe('ab');
  });

  it('replaces a lone high and a lone low surrogate with U+FFFD', () => {
    expect(toStorableText(`a${LONE_HIGH}b`)).toBe(`a${REPLACEMENT}b`);
    expect(toStorableText(`a${LONE_LOW}b`)).toBe(`a${REPLACEMENT}b`);
    expect(toStorableText(`ab${LONE_HIGH}`)).toBe(`ab${REPLACEMENT}`);
  });

  it('keeps a valid pair next to a removed NUL', () => {
    expect(toStorableText(`${PAIR}${NUL}${PAIR}`)).toBe(`${PAIR}${PAIR}`);
  });

  it('never joins two lone halves separated by a NUL into a pair', () => {
    const result = toStorableText(`${LONE_HIGH}${NUL}${LONE_LOW}`);
    expect(result).toBe(`${REPLACEMENT}${REPLACEMENT}`);
    expect(isStorableText(result)).toBe(true);
  });

  it.each([`${LONE_LOW}${LONE_HIGH}`, `x${NUL}${LONE_HIGH}${PAIR}`, `${LONE_HIGH}${LONE_HIGH}`])(
    'always returns storable text for %p',
    (text) => {
      expect(isStorableText(toStorableText(text))).toBe(true);
    },
  );
});

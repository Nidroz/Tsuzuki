import { describe, expect, it } from '@jest/globals';

import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PROBLEMS,
  isAcceptablePassword,
  passwordProblems,
  utf8ByteLength,
} from './auth-credentials';

// code point U+1F600: one code point, two utf-16 units, four utf-8 bytes
const EMOJI = '\u{1F600}';
// code point U+00E9: one code point, two utf-8 bytes
const E_ACUTE = 'é';
// code point U+3042: one code point, three utf-8 bytes
const HIRAGANA_A = 'あ';
const LONE_HIGH_SURROGATE = '\ud83d';

describe('password policy constants', () => {
  it('mirrors the supabase project settings', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(PASSWORD_MAX_BYTES).toBe(72);
    expect(EMAIL_MAX_LENGTH).toBe(254);
    expect(PASSWORD_PROBLEMS).toStrictEqual([
      'too-short',
      'too-long',
      'missing-letter',
      'missing-digit',
    ]);
  });
});

describe('utf8ByteLength', () => {
  it.each([
    ['ascii', 'abc1', 4],
    ['a two-byte code point', E_ACUTE, 2],
    ['a three-byte code point', HIRAGANA_A, 3],
    ['a surrogate pair', EMOJI, 4],
    ['a lone surrogate, encoded as U+FFFD', LONE_HIGH_SURROGATE, 3],
    ['a lone surrogate before ascii', `${LONE_HIGH_SURROGATE}a`, 4],
    ['the empty string', '', 0],
  ])('counts %s', (_label, text, bytes) => {
    expect(utf8ByteLength(text)).toBe(bytes);
  });
});

describe('passwordProblems', () => {
  it.each([
    ['letters and digits at the minimum length', 'abcdefghi1'],
    ['symbols and upper case', 'Correct-Horse-9'],
    ['exactly the maximum bytes', `a1${'x'.repeat(PASSWORD_MAX_BYTES - 2)}`],
    ['non-ascii characters around the required ones', `${E_ACUTE.repeat(8)}a1`],
  ])('accepts %s', (_label, password) => {
    expect(passwordProblems(password)).toStrictEqual([]);
    expect(isAcceptablePassword(password)).toBe(true);
  });

  it('counts the minimum in code points, so a surrogate pair counts once', () => {
    // nine code points (eighteen utf-16 units) are still too short
    expect(passwordProblems(`a1${EMOJI.repeat(7)}`)).toStrictEqual(['too-short']);
    expect(passwordProblems(`a1${EMOJI.repeat(8)}`)).toStrictEqual([]);
  });

  it('counts the maximum in utf-8 bytes, so a short password of wide characters is too long', () => {
    // 2 + 18 * 4 = 74 bytes in 20 code points
    expect(passwordProblems(`a1${EMOJI.repeat(18)}`)).toStrictEqual(['too-long']);
    expect(passwordProblems(`a1${'x'.repeat(PASSWORD_MAX_BYTES - 1)}`)).toStrictEqual(['too-long']);
  });

  it.each([
    ['digits only', '1234567890', ['missing-letter']],
    ['letters only', 'abcdefghij', ['missing-digit']],
    ['non-ascii letters and a digit', `${E_ACUTE.repeat(9)}1`, ['missing-letter']],
    ['an empty password', '', ['too-short', 'missing-letter', 'missing-digit']],
  ])('rejects %s', (_label, password, problems) => {
    expect(passwordProblems(password)).toStrictEqual(problems);
    expect(isAcceptablePassword(password)).toBe(false);
  });
});

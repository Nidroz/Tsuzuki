import { describe, expect, it } from '@jest/globals';

import { isSearchQueryMaxLength, prepareSearchQuery } from './search-query';

const MAX = 10;
// one character outside the basic multilingual plane: a surrogate pair, two code units
const PAIR = '\u{1F600}';
const LONE_HIGH = '\uD83D';
const LONE_LOW = '\uDE00';

describe('prepareSearchQuery', () => {
  it.each<[string, string, string]>([
    ['a plain query', 'frieren', 'frieren'],
    ['surrounding spaces, tabs and newlines', ' \t frieren \n', 'frieren'],
    ['inner spaces', '  one  piece ', 'one  piece'],
    ['a non-latin query', ' 葬送のフリーレン ', '葬送のフリーレン'],
    ['a surrogate pair', ` ${PAIR}a `, `${PAIR}a`],
  ])('trims %s', (_label, raw, expected) => {
    expect(prepareSearchQuery(raw, MAX)).toBe(expected);
  });

  it.each<[string, string]>([
    ['the empty string', ''],
    ['spaces only', '   '],
    ['whitespace of every kind', ' \t\n\r 　﻿'],
    ['a lone surrogate', LONE_HIGH],
    ['lone surrogates and spaces', ` ${LONE_LOW} ${LONE_HIGH} `],
  ])('returns null for %s', (_label, raw) => {
    expect(prepareSearchQuery(raw, MAX)).toBeNull();
  });

  it.each<[string, string, string]>([
    ['a lone high surrogate', `a${LONE_HIGH}b`, 'ab'],
    ['a lone low surrogate', `a${LONE_LOW}b`, 'ab'],
    ['a high surrogate at the end', `ab${LONE_HIGH}`, 'ab'],
    ['a high surrogate before a pair', `${LONE_HIGH}${PAIR}`, PAIR],
    ['a low surrogate after a pair', `${PAIR}${LONE_LOW}`, PAIR],
    ['reversed halves', `${LONE_LOW}${LONE_HIGH}x`, 'x'],
  ])('removes %s and keeps the pairs', (_label, raw, expected) => {
    expect(prepareSearchQuery(raw, MAX)).toBe(expected);
  });

  it('removes lone surrogates before trimming', () => {
    expect(prepareSearchQuery(`${LONE_HIGH} abc ${LONE_LOW}`, MAX)).toBe('abc');
  });

  it('keeps a query of exactly maxLength code units', () => {
    expect(prepareSearchQuery('a'.repeat(MAX), MAX)).toBe('a'.repeat(MAX));
  });

  it('cuts a longer query at maxLength code units, after trimming', () => {
    expect(prepareSearchQuery(`   ${'a'.repeat(MAX + 5)}`, MAX)).toBe('a'.repeat(MAX));
  });

  it('cuts one unit earlier instead of splitting a surrogate pair', () => {
    const raw = `${'a'.repeat(MAX - 1)}${PAIR}`;
    expect(prepareSearchQuery(raw, MAX)).toBe('a'.repeat(MAX - 1));
    expect(prepareSearchQuery(`${'a'.repeat(MAX - 2)}${PAIR}b`, MAX)).toBe(
      `${'a'.repeat(MAX - 2)}${PAIR}`,
    );
    expect(prepareSearchQuery(PAIR, 1)).toBeNull();
  });

  it('trims the whitespace left at the end by the cut', () => {
    expect(prepareSearchQuery('abc   defghijk', 5)).toBe('abc');
    expect(prepareSearchQuery(`ab ${PAIR}`, 4)).toBe('ab');
  });

  it.each<[string, string, number]>([
    ['a plain query', '  frieren  ', MAX],
    ['a cut query', 'abc   defghijk', 5],
    ['a query cut before a pair', `${'a'.repeat(MAX - 1)}${PAIR}`, MAX],
    ['a query with lone surrogates', `${LONE_LOW} x${LONE_HIGH}y `, MAX],
  ])('is idempotent on %s', (_label, raw, maxLength) => {
    const prepared = prepareSearchQuery(raw, maxLength);
    expect(prepared).not.toBeNull();
    expect(prepareSearchQuery(prepared ?? '', maxLength)).toBe(prepared);
  });

  it.each<[string, number]>([
    ['zero', 0],
    ['a negative length', -1],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ])('throws a RangeError without the text for %s as maxLength', (_label, maxLength) => {
    const call = (): string | null => prepareSearchQuery('secret text', maxLength);
    expect(call).toThrow(RangeError);
    expect(call).not.toThrow(/secret/);
  });
});

describe('isSearchQueryMaxLength', () => {
  it.each<[number, boolean]>([
    [1, true],
    [Number.MAX_SAFE_INTEGER, true],
    [0, false],
    [2.5, false],
    [Number.NaN, false],
  ])('returns for %p: %p', (value, expected) => {
    expect(isSearchQueryMaxLength(value)).toBe(expected);
  });
});

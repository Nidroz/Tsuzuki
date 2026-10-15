import { describe, expect, it } from '@jest/globals';

import { YEAR_FROM_MAX, YEAR_FROM_MIN } from '../domain/search-filters';
import { isBlankYearInput, parseYearInput, yearInputSchema } from './year-input';

// every invalid text is rejected by the schema and turned into null by the parser
const isRejected = (text: string): boolean =>
  !yearInputSchema.safeParse(text).success && parseYearInput(text) === null;

describe('parseYearInput', () => {
  it.each([
    ['1000', 1000],
    ['1999', 1999],
    ['2024', 2024],
    ['9999', 9999],
  ])('reads %p as %p', (text, year) => {
    expect(parseYearInput(text)).toBe(year);
    expect(yearInputSchema.parse(text)).toBe(year);
  });

  it('accepts the bounds of the year filter', () => {
    expect(parseYearInput(String(YEAR_FROM_MIN))).toBe(YEAR_FROM_MIN);
    expect(parseYearInput(String(YEAR_FROM_MAX))).toBe(YEAR_FROM_MAX);
  });

  it.each(['0999', '0000', '999', '10000', '20245'])(
    'rejects %p: not four digits in range',
    (text) => {
      expect(isRejected(text)).toBe(true);
    },
  );

  it.each([' 2024', '2024 ', '+2024', '-999', '2024.', '2e03', '20 24', '٢٠٢٤', '２０２４'])(
    'rejects %p: a sign, a space or a character other than an ascii digit',
    (text) => {
      expect(isRejected(text)).toBe(true);
    },
  );

  it.each(['', '   ', '\n'])('gives null for the blank text %p', (text) => {
    expect(isRejected(text)).toBe(true);
  });
});

describe('isBlankYearInput', () => {
  it.each(['', '  ', '\t\n'])('is true for %p', (text) => {
    expect(isBlankYearInput(text)).toBe(true);
  });

  it.each(['2024', ' 2024', 'x'])('is false for %p', (text) => {
    expect(isBlankYearInput(text)).toBe(false);
  });
});

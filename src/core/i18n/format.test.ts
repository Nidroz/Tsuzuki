import { describe, expect, it } from '@jest/globals';

import { formatDate, formatNumber } from './format';

// french groups digits with a narrow no-break space and puts a no-break space before %: written as
// escapes, since both look like a plain space
const NARROW_NO_BREAK_SPACE = '\u202F';
const NO_BREAK_SPACE = '\u00A0';

// a fixed instant: formatDate never reads the clock
const PI_DAY = new Date(Date.UTC(2026, 2, 14, 15, 30));
const LONG_DATE_IN_UTC: Intl.DateTimeFormatOptions = { dateStyle: 'long', timeZone: 'UTC' };

// each language is asserted with its exact output, which differs from the other language's:
// whatever the locale of the machine running the tests, both results stay as they are
describe('formatNumber', () => {
  it('formats in english', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
  });

  it('formats in french', () => {
    expect(formatNumber(1234.5, 'fr')).toBe(`1${NARROW_NO_BREAK_SPACE}234,5`);
  });

  it('passes the options to the formatter', () => {
    expect(formatNumber(0.25, 'en', { style: 'percent' })).toBe('25%');
    expect(formatNumber(0.25, 'fr', { style: 'percent' })).toBe(`25${NO_BREAK_SPACE}%`);
    expect(formatNumber(1234.5, 'en', { maximumFractionDigits: 0 })).toBe('1,235');
    expect(formatNumber(1234.5, 'fr', { minimumFractionDigits: 2 })).toBe(
      `1${NARROW_NO_BREAK_SPACE}234,50`,
    );
  });

  it('formats zero and negative numbers', () => {
    expect(formatNumber(0, 'en')).toBe('0');
    expect(formatNumber(-1234, 'en')).toBe('-1,234');
    expect(formatNumber(-1234, 'fr')).toBe(`-1${NARROW_NO_BREAK_SPACE}234`);
  });
});

describe('formatDate', () => {
  it('formats in english', () => {
    expect(formatDate(PI_DAY, 'en', LONG_DATE_IN_UTC)).toBe('March 14, 2026');
  });

  it('formats in french', () => {
    expect(formatDate(PI_DAY, 'fr', LONG_DATE_IN_UTC)).toBe('14 mars 2026');
  });

  it('uses the numeric date order of each language without options', () => {
    expect(formatDate(PI_DAY, 'en')).toBe('3/14/2026');
    expect(formatDate(PI_DAY, 'fr')).toBe('14/03/2026');
  });

  it('passes the options to the formatter', () => {
    const options: Intl.DateTimeFormatOptions = { month: 'long', timeZone: 'UTC' };

    expect(formatDate(PI_DAY, 'en', options)).toBe('March');
    expect(formatDate(PI_DAY, 'fr', options)).toBe('mars');
  });

  it('formats the given date, not the current one', () => {
    expect(formatDate(new Date(0), 'en', LONG_DATE_IN_UTC)).toBe('January 1, 1970');
  });
});

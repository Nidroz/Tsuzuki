import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type * as FormatModule from './format';
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

// the formatters are cached at module level: each caching case loads a fresh module, so no case
// depends on what another one formatted first
const loadFormat = (): typeof FormatModule => {
  let loaded: typeof FormatModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<typeof FormatModule>('./format');
  });
  if (loaded === undefined) throw new Error('format did not load');
  return loaded;
};

// the cap of the module, mirrored: one more distinct option set than it keeps
const MAX_CACHED_FORMATTERS = 64;
const MAX_INTEGER_DIGITS = 21;

describe('formatter cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds one number formatter for equal options in any key order', () => {
    const format = loadFormat();
    const constructor = jest.spyOn(Intl, 'NumberFormat');

    expect(format.formatNumber(1234.5, 'en', { style: 'percent', maximumFractionDigits: 0 })).toBe(
      '123,450%',
    );
    expect(format.formatNumber(1234.5, 'en', { maximumFractionDigits: 0, style: 'percent' })).toBe(
      '123,450%',
    );
    expect(format.formatNumber(0.5, 'en', { style: 'percent', maximumFractionDigits: 0 })).toBe(
      '50%',
    );
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  it('builds one formatter without options, and treats an undefined option as missing', () => {
    const format = loadFormat();
    const constructor = jest.spyOn(Intl, 'NumberFormat');

    expect(format.formatNumber(1234.5, 'fr')).toBe(`1${NARROW_NO_BREAK_SPACE}234,5`);
    expect(format.formatNumber(2, 'fr', {})).toBe('2');
    expect(format.formatNumber(3, 'fr', { style: undefined })).toBe('3');
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  it('builds a new number formatter for another language or other options', () => {
    const format = loadFormat();
    const constructor = jest.spyOn(Intl, 'NumberFormat');

    expect(format.formatNumber(2023, 'en', { useGrouping: false })).toBe('2023');
    expect(format.formatNumber(2023, 'fr', { useGrouping: false })).toBe('2023');
    expect(format.formatNumber(2023, 'en')).toBe('2,023');
    expect(format.formatNumber(2023, 'en', { useGrouping: true })).toBe('2,023');
    expect(constructor).toHaveBeenCalledTimes(4);
  });

  it('builds one date formatter for equal options in any key order, a new one otherwise', () => {
    const format = loadFormat();
    const constructor = jest.spyOn(Intl, 'DateTimeFormat');

    expect(format.formatDate(PI_DAY, 'en', { dateStyle: 'long', timeZone: 'UTC' })).toBe(
      'March 14, 2026',
    );
    expect(format.formatDate(new Date(0), 'en', { timeZone: 'UTC', dateStyle: 'long' })).toBe(
      'January 1, 1970',
    );
    expect(constructor).toHaveBeenCalledTimes(1);

    expect(format.formatDate(PI_DAY, 'fr', { dateStyle: 'long', timeZone: 'UTC' })).toBe(
      '14 mars 2026',
    );
    expect(format.formatDate(PI_DAY, 'en', { month: 'long', timeZone: 'UTC' })).toBe('March');
    expect(constructor).toHaveBeenCalledTimes(3);
  });

  it('keeps number and date formatters apart', () => {
    const format = loadFormat();
    const numberConstructor = jest.spyOn(Intl, 'NumberFormat');
    const dateConstructor = jest.spyOn(Intl, 'DateTimeFormat');

    expect(format.formatNumber(14, 'en')).toBe('14');
    expect(format.formatDate(PI_DAY, 'en')).toBe('3/14/2026');
    expect(numberConstructor).toHaveBeenCalledTimes(1);
    expect(dateConstructor).toHaveBeenCalledTimes(1);
  });

  it('starts over when it holds as many formatters as its cap', () => {
    const format = loadFormat();
    const constructor = jest.spyOn(Intl, 'NumberFormat');
    // minimumIntegerDigits takes 1 to 21: with two languages and two fraction settings, each
    // index gets its own option set
    const optionSets = Array.from({ length: MAX_CACHED_FORMATTERS + 1 }, (_, index) => ({
      language: index % 2 === 0 ? ('en' as const) : ('fr' as const),
      options: {
        minimumIntegerDigits: (Math.floor(index / 2) % MAX_INTEGER_DIGITS) + 1,
        maximumFractionDigits: Math.floor(index / (2 * MAX_INTEGER_DIGITS)),
      },
    }));
    for (const { language, options } of optionSets) format.formatNumber(1, language, options);
    expect(constructor).toHaveBeenCalledTimes(MAX_CACHED_FORMATTERS + 1);

    // the first set was dropped when the cap was reached, the last one is kept
    const last = optionSets[MAX_CACHED_FORMATTERS];
    const first = optionSets[0];
    if (last === undefined || first === undefined) throw new Error('missing option set');
    format.formatNumber(1, last.language, last.options);
    expect(constructor).toHaveBeenCalledTimes(MAX_CACHED_FORMATTERS + 1);
    format.formatNumber(1, first.language, first.options);
    expect(constructor).toHaveBeenCalledTimes(MAX_CACHED_FORMATTERS + 2);
  });
});

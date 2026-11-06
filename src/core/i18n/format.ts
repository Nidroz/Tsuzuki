import type { Language } from './languages';

// the locale is always explicit: formatting never depends on the machine locale, so tests
// give the same output everywhere

// list rows format values on every render, and building an Intl formatter costs far more than
// using one: each formatter is built once per language and options, then reused (a date formatter
// only with an explicit time zone, see formatDate). the options the code passes are a few module
// constants (e.g. YEAR_FORMAT) or none, so the caches stay small; the cap only guards against a
// caller building options from data, by starting over when it is reached
const MAX_CACHED_FORMATTERS = 64;

type FormatOptions = Intl.NumberFormatOptions | Intl.DateTimeFormatOptions;

/**
 * the same key for equal options in any key order: the options are plain objects of primitives
 * (strings, numbers, booleans), keyed by value and never by identity. an undefined option is left
 * out, as Intl treats it like a missing one
 */
const cacheKey = (language: Language, options: FormatOptions | undefined): string => {
  const entries = Object.entries(options ?? {})
    .filter(([, value]) => value !== undefined)
    // object keys are unique: two keys are never equal
    .sort(([left], [right]) => (left < right ? -1 : 1));
  return JSON.stringify([language, entries]);
};

const cached = <Formatter>(
  cache: Map<string, Formatter>,
  key: string,
  create: () => Formatter,
): Formatter => {
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  if (cache.size >= MAX_CACHED_FORMATTERS) cache.clear();
  const formatter = create();
  cache.set(key, formatter);
  return formatter;
};

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

export const formatNumber = (
  value: number,
  language: Language,
  options?: Intl.NumberFormatOptions,
): string =>
  cached(
    numberFormats,
    cacheKey(language, options),
    () => new Intl.NumberFormat(language, options),
  ).format(value);

export const formatDate = (
  value: Date,
  language: Language,
  options?: Intl.DateTimeFormatOptions,
): string => {
  const create = () => new Intl.DateTimeFormat(language, options);
  // without a time zone, a formatter keeps the device zone it was built in: build a fresh one,
  // so a zone change (travel) applies to the next call
  if (options?.timeZone === undefined) {
    return create().format(value);
  }
  return cached(dateFormats, cacheKey(language, options), create).format(value);
};

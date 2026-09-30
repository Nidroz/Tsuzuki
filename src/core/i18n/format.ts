import type { Language } from './languages';

// the locale is always explicit: formatting never depends on the machine locale, so tests
// give the same output everywhere

export const formatNumber = (
  value: number,
  language: Language,
  options?: Intl.NumberFormatOptions,
): string => new Intl.NumberFormat(language, options).format(value);

export const formatDate = (
  value: Date,
  language: Language,
  options?: Intl.DateTimeFormatOptions,
): string => new Intl.DateTimeFormat(language, options).format(value);

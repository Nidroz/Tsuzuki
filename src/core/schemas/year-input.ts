// the year field of the search filters sheet (FR-03, docs/ARCHITECTURE.md §6): its text is user
// input, parsed here into the yearFrom of the filters. blank text is no year rather than a wrong
// one: the sheet clears the year filter for it and shows an error only for other invalid text
import { z } from 'zod';

import { YEAR_FROM_MAX, YEAR_FROM_MIN } from '../domain/search-filters';

// exactly four ascii digits: no sign, space, decimal point, exponent or other digit script
const YEAR_INPUT_PATTERN = /^[0-9]{4}$/;

/**
 * the text of the year field: exactly four ascii digits in YEAR_FROM_MIN..YEAR_FROM_MAX, to a
 * number. any other text fails, blank text included.
 */
export const yearInputSchema = z
  .string()
  .regex(YEAR_INPUT_PATTERN)
  .transform(Number)
  .pipe(z.number().int().min(YEAR_FROM_MIN).max(YEAR_FROM_MAX));

/** the year of the year field text, or null when it is not a valid year (blank text included). */
export const parseYearInput = (text: string): number | null => {
  const result = yearInputSchema.safeParse(text);
  return result.success ? result.data : null;
};

/** whether the year field text is blank (empty or white space only): no year filter, no error. */
export const isBlankYearInput = (text: string): boolean => text.trim() === '';

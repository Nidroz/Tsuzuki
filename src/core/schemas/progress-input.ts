// the progress field of the library entry editor (FR-12 manual edit): its text is user input,
// parsed here into a progress. blank text is told apart from invalid text (isBlankProgressInput).
// the BR-01 bound by the total is not checked here: the screen checks
// isValidProgress(value, totalUnits) to show its "at most N" error
import { z } from 'zod';

import { PROGRESS_MAX } from '../domain/library-progress';

// the digit count of PROGRESS_MAX: a longer text is rejected before Number can lose precision
const PROGRESS_INPUT_MAX_DIGITS = String(PROGRESS_MAX).length;

// one to PROGRESS_INPUT_MAX_DIGITS ascii digits: no sign, space, decimal point, exponent or other
// digit script
const PROGRESS_INPUT_PATTERN = new RegExp(`^[0-9]{1,${String(PROGRESS_INPUT_MAX_DIGITS)}}$`);

/**
 * the text of the progress field: surrounding white space trimmed (pasted text may hold some),
 * then one to ten ascii digits (the digit count of PROGRESS_MAX, leading zeros counted: "007" is
 * 7), at most PROGRESS_MAX, to a number. any other text fails, blank text included.
 */
export const progressInputSchema = z
  .string()
  .trim()
  .regex(PROGRESS_INPUT_PATTERN)
  .transform(Number)
  .pipe(z.number().int().max(PROGRESS_MAX));

/** the progress of the progress field text, or null when it is invalid (blank text included). */
export const parseProgressInput = (text: string): number | null => {
  const result = progressInputSchema.safeParse(text);
  return result.success ? result.data : null;
};

/** whether the progress field text is blank (empty or white space only). */
export const isBlankProgressInput = (text: string): boolean => text.trim() === '';

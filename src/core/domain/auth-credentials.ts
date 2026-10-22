// the password policy of the supabase projects (docs/ARCHITECTURE.md §8): it mirrors
// supabase/config.toml `minimum_password_length = 10` and `password_requirements = "letters_digits"`,
// set the same way on every hosted project. the server stays the authority: this check only spares
// a round trip and accepts nothing the server rejects

import { codePointLength } from './database-limits';

/**
 * the shortest password, in code points. supabase counts utf-8 bytes, and a password never has
 * fewer bytes than code points, so a password long enough here is long enough there.
 */
export const PASSWORD_MIN_LENGTH = 10;

/** the longest password, in utf-8 bytes: the bcrypt bound, beyond which supabase rejects it. */
export const PASSWORD_MAX_BYTES = 72;

/** the longest email address (the RFC 5321 path limit). */
export const EMAIL_MAX_LENGTH = 254;

/** why a password does not meet the policy, in the order a form shows them. */
export const PASSWORD_PROBLEMS = [
  'too-short',
  'too-long',
  'missing-letter',
  'missing-digit',
] as const;

export type PasswordProblem = (typeof PASSWORD_PROBLEMS)[number];

// the character sets of supabase's letters_digits requirement: ascii only
const ASCII_LETTER = /[A-Za-z]/;
const ASCII_DIGIT = /[0-9]/;

// utf-8 widths by utf-16 code unit: a surrogate pair is one 4-byte code point, a lone surrogate is
// encoded as U+FFFD (3 bytes, like any other unit above TWO_BYTES_MAX)
const ONE_BYTE_MAX = 0x7f;
const TWO_BYTES_MAX = 0x7ff;
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;
const TWO_BYTES = 2;
const THREE_BYTES = 3;
const PAIR_BYTES = 4;
const PAIR_UNITS = 2;

const isSurrogatePairAt = (text: string, index: number): boolean => {
  const unit = text.charCodeAt(index);
  const next = text.charCodeAt(index + 1);
  return (
    unit >= HIGH_SURROGATE_MIN &&
    unit <= HIGH_SURROGATE_MAX &&
    next >= LOW_SURROGATE_MIN &&
    next <= LOW_SURROGATE_MAX
  );
};

const unitWidth = (unit: number): number => {
  if (unit <= ONE_BYTE_MAX) {
    return 1;
  }
  return unit <= TWO_BYTES_MAX ? TWO_BYTES : THREE_BYTES;
};

/**
 * the length of `text` encoded as utf-8, as the server receives it. a manual scan, like
 * codePointLength, so it does not depend on the string iterator or TextEncoder.
 */
export const utf8ByteLength = (text: string): number => {
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    if (isSurrogatePairAt(text, index)) {
      bytes += PAIR_BYTES;
      index += PAIR_UNITS;
    } else {
      bytes += unitWidth(text.charCodeAt(index));
      index += 1;
    }
  }
  return bytes;
};

/** what `password` lacks to meet the policy, in PASSWORD_PROBLEMS order; empty when it meets it. */
export const passwordProblems = (password: string): readonly PasswordProblem[] => {
  const problems: PasswordProblem[] = [];
  if (codePointLength(password) < PASSWORD_MIN_LENGTH) {
    problems.push('too-short');
  }
  if (utf8ByteLength(password) > PASSWORD_MAX_BYTES) {
    problems.push('too-long');
  }
  if (!ASCII_LETTER.test(password)) {
    problems.push('missing-letter');
  }
  if (!ASCII_DIGIT.test(password)) {
    problems.push('missing-digit');
  }
  return problems;
};

/** whether `password` meets the policy of the supabase projects. */
export const isAcceptablePassword = (password: string): boolean =>
  passwordProblems(password).length === 0;

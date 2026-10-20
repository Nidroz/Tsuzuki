import { describe, expect, it } from '@jest/globals';

import { PROGRESS_MAX } from '../domain/library-progress';
import { isBlankProgressInput, parseProgressInput, progressInputSchema } from './progress-input';

// every invalid text is rejected by the schema and turned into null by the parser
const isRejected = (text: string): boolean =>
  !progressInputSchema.safeParse(text).success && parseProgressInput(text) === null;

describe('parseProgressInput', () => {
  it.each([
    ['0', 0],
    ['1', 1],
    ['28', 28],
    ['1000', 1000],
  ])('reads %p as %p', (text, progress) => {
    expect(parseProgressInput(text)).toBe(progress);
    expect(progressInputSchema.parse(text)).toBe(progress);
  });

  it('accepts PROGRESS_MAX and rejects one more', () => {
    expect(parseProgressInput(String(PROGRESS_MAX))).toBe(PROGRESS_MAX);
    expect(isRejected(String(PROGRESS_MAX + 1))).toBe(true);
  });

  it.each([
    [' 12', 12],
    ['12\n', 12],
    ['\t7 ', 7],
  ])('trims the surrounding white space of %p', (text, progress) => {
    expect(parseProgressInput(text)).toBe(progress);
  });

  it.each([
    ['007', 7],
    ['0000000012', 12],
  ])('reads the leading zeros of %p within ten digits', (text, progress) => {
    expect(parseProgressInput(text)).toBe(progress);
  });

  it.each(['00000000012', '99999999999', '9'.repeat(400)])(
    'rejects %p: more than ten digits, before any precision loss',
    (text) => {
      expect(isRejected(text)).toBe(true);
    },
  );

  it.each(['+5', '-1', '1.5', '1.', '1e3', '1 2', '0x1F', '٣', '３'])(
    'rejects %p: a sign, an inner space or a character other than an ascii digit',
    (text) => {
      expect(isRejected(text)).toBe(true);
    },
  );

  it.each(['', '   ', '\n'])('gives null for the blank text %p', (text) => {
    expect(isRejected(text)).toBe(true);
  });

  it('does not bound the value by the total (BR-01 is checked by the screen)', () => {
    expect(parseProgressInput('500')).toBe(500);
  });
});

describe('isBlankProgressInput', () => {
  it.each(['', '  ', '\t\n'])('is true for %p', (text) => {
    expect(isBlankProgressInput(text)).toBe(true);
  });

  it.each(['0', ' 12', 'x'])('is false for %p', (text) => {
    expect(isBlankProgressInput(text)).toBe(false);
  });
});

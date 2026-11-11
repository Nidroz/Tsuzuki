import { describe, expect, it } from '@jest/globals';

import {
  LIBRARY_ACTION_PROBLEMS,
  LIBRARY_CLEANUP_STEPS,
  LibraryActionError,
  LibraryCleanupError,
} from './library-report-errors';

describe('LibraryCleanupError', () => {
  it.each(LIBRARY_CLEANUP_STEPS)('keeps the %s step, and only it', (step) => {
    const error = new LibraryCleanupError(step);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LibraryCleanupError');
    expect(error.step).toBe(step);
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error).sort()).toStrictEqual(['name', 'step']);
  });

  it('gives each step its own fixed message', () => {
    const messages = LIBRARY_CLEANUP_STEPS.map((step) => new LibraryCleanupError(step).message);

    expect(new Set(messages).size).toBe(LIBRARY_CLEANUP_STEPS.length);
  });
});

describe('LibraryActionError', () => {
  it.each(LIBRARY_ACTION_PROBLEMS)('keeps the %s problem, and only it', (problem) => {
    const error = new LibraryActionError(problem);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LibraryActionError');
    expect(error.problem).toBe(problem);
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error).sort()).toStrictEqual(['name', 'problem']);
  });

  it('gives each problem its own fixed message', () => {
    const messages = LIBRARY_ACTION_PROBLEMS.map(
      (problem) => new LibraryActionError(problem).message,
    );

    expect(new Set(messages).size).toBe(LIBRARY_ACTION_PROBLEMS.length);
  });
});

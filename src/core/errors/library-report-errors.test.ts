import { describe, expect, it } from '@jest/globals';

import {
  LIBRARY_ACTION_PROBLEMS,
  LIBRARY_CLEANUP_STEPS,
  LIBRARY_FAILURE_OPERATIONS,
  LibraryActionError,
  LibraryCleanupError,
  LibraryFailureError,
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

describe('LibraryFailureError', () => {
  it('lists the guest merge, the stuck writes retry and the guest merge room', () => {
    expect(LIBRARY_FAILURE_OPERATIONS).toStrictEqual([
      'guest-merge',
      'stuck-writes-retry',
      'guest-merge-room',
    ]);
  });

  it.each(LIBRARY_FAILURE_OPERATIONS)('keeps the %s operation, and only it', (operation) => {
    const error = new LibraryFailureError(operation);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LibraryFailureError');
    expect(error.operation).toBe(operation);
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error).sort()).toStrictEqual(['name', 'operation']);
  });

  it('gives each operation its own fixed message', () => {
    expect(new LibraryFailureError('guest-merge').message).toBe(
      'Library operation failed: guest merge',
    );
    expect(new LibraryFailureError('stuck-writes-retry').message).toBe(
      'Library operation failed: stuck writes retry',
    );
    expect(new LibraryFailureError('guest-merge-room').message).toBe(
      'Library operation failed: guest merge room',
    );
  });
});

describe('LibraryActionError', () => {
  it('lists the programming errors of an action, the add without its media included', () => {
    expect(LIBRARY_ACTION_PROBLEMS).toStrictEqual([
      'entry-not-loaded',
      'invalid-change',
      'media-missing',
    ]);
  });

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
    expect(new LibraryActionError('media-missing').message).toBe(
      'Library add applied without its media',
    );
  });
});

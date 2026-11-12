import { describe, expect, it } from '@jest/globals';

import { APP_STORAGE_PROBLEMS, AppStorageError } from './app-storage-errors';

describe('AppStorageError', () => {
  it.each(APP_STORAGE_PROBLEMS)('keeps the %s problem, and only it', (problem) => {
    const error = new AppStorageError(problem);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppStorageError');
    expect(error.problem).toBe(problem);
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error).sort()).toStrictEqual(['name', 'problem']);
  });

  it('gives each problem its own fixed message', () => {
    const messages = APP_STORAGE_PROBLEMS.map((problem) => new AppStorageError(problem).message);

    expect(new Set(messages).size).toBe(APP_STORAGE_PROBLEMS.length);
    expect(new AppStorageError('key-lost').message).toBe('App storage key lost: storage reset');
  });
});

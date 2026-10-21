import { describe, expect, it } from '@jest/globals';

import { LibrarySnapshotError, LibraryStorageError } from './library-errors';

describe('library errors', () => {
  it('names a snapshot error and keeps it a RangeError', () => {
    const error = new LibrarySnapshotError();

    expect(error.name).toBe('LibrarySnapshotError');
    expect(error).toBeInstanceOf(RangeError);
    expect(error).toBeInstanceOf(Error);
  });

  it('gives a snapshot error a fixed message, no cause and no field', () => {
    const error = new LibrarySnapshotError();

    expect(error.message).toBe('Media snapshot is outside the database limits');
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error)).toStrictEqual(['name']);
  });

  it('keeps the reason of a storage error, and only the reason', () => {
    const error = new LibraryStorageError('invalid-json');

    expect(error.name).toBe('LibraryStorageError');
    expect(error.reason).toBe('invalid-json');
    expect(error.message).toBe('Guest library storage is damaged: invalid-json');
    expect(Object.keys(error).sort()).toStrictEqual(['name', 'reason']);
  });
});

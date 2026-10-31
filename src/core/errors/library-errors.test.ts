import { describe, expect, it } from '@jest/globals';

import {
  LIBRARY_REMOTE_REASONS,
  LibraryRemoteError,
  LibrarySnapshotError,
  LibraryStorageError,
} from './library-errors';

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

  it('lists the remote reasons', () => {
    expect(LIBRARY_REMOTE_REASONS).toStrictEqual([
      'network',
      'signed-out',
      'rejected',
      'invalid-row',
      'unknown',
    ]);
  });

  it.each(LIBRARY_REMOTE_REASONS)(
    'keeps the %s reason of a remote error, and only it',
    (reason) => {
      const error = new LibraryRemoteError(reason);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('LibraryRemoteError');
      expect(error.reason).toBe(reason);
      expect(error.cause).toBeUndefined();
      expect(Object.keys(error).sort()).toStrictEqual(['name', 'reason']);
    },
  );

  it('gives each remote reason its own fixed message', () => {
    const messages = LIBRARY_REMOTE_REASONS.map((reason) => new LibraryRemoteError(reason).message);

    expect(new Set(messages).size).toBe(LIBRARY_REMOTE_REASONS.length);
    expect(new LibraryRemoteError('rejected').message).toBe('Account library request rejected');
  });
});

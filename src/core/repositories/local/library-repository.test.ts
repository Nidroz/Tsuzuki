import { describe, expect, it, jest } from '@jest/globals';

import { ENTRY_KEY, entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { describeLibraryRepositoryContract } from '../../../../test/core/library-repository-contract';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { createMemoryStorage, createRecordingReporter } from './__fixtures__/memory-storage';
import { GUEST_LIBRARY_STORAGE_KEY, createLocalLibraryRepository } from './library-repository';

// a guest repository over an in-memory storage holding `stored` under the guest library key
const setup = (stored?: string) => {
  const storage = createMemoryStorage();
  if (stored !== undefined) {
    storage.values.set(GUEST_LIBRARY_STORAGE_KEY, stored);
  }
  const { reporter, captureError } = createRecordingReporter();
  const repository = createLocalLibraryRepository(storage, { reporter });
  return { storage, repository, captureError };
};

const storedDocument = (storage: ReturnType<typeof setup>['storage']): unknown =>
  JSON.parse(storage.values.get(GUEST_LIBRARY_STORAGE_KEY) ?? 'null');

describeLibraryRepositoryContract('local guest', () => setup().repository);

describe('createLocalLibraryRepository', () => {
  it('stores under the guest-library key', () => {
    expect(GUEST_LIBRARY_STORAGE_KEY).toBe('guest-library');
  });

  it('stores a version 1 envelope of the entries in list order', async () => {
    const { storage, repository } = setup();
    const older = await repository.save(entryOf({ updatedAt: '2026-02-01T00:00:00.000Z' }));
    const newer = await repository.save(
      entryOf({ key: keyOf('manga', 3), updatedAt: '2026-03-01T00:00:00.000Z' }),
    );

    expect(storedDocument(storage)).toStrictEqual({ version: 1, entries: [newer, older] });
  });

  it('stores and resolves to the entry with normalized timestamps', async () => {
    const { storage, repository } = setup();

    const stored = await repository.save(
      entryOf({
        createdAt: '2026-01-05T12:00:00.987654+02:00',
        updatedAt: '2026-02-10T20:30:00.123456+00:00',
      }),
    );

    expect(stored).toStrictEqual(
      entryOf({ createdAt: '2026-01-05T10:00:00.987Z', updatedAt: '2026-02-10T20:30:00.123Z' }),
    );
    expect(storedDocument(storage)).toStrictEqual({ version: 1, entries: [stored] });
  });

  it('keeps the guest timestamps it is given, replacing createdAt only with the stored one', async () => {
    const { repository } = setup();
    await repository.save(entryOf({ createdAt: '2026-01-01T00:00:00.000Z' }));

    const replaced = await repository.save(
      entryOf({ createdAt: '2026-03-03T00:00:00.000Z', updatedAt: '2026-03-04T00:00:00.000Z' }),
    );

    expect(replaced.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(replaced.updatedAt).toBe('2026-03-04T00:00:00.000Z');
  });

  it('lists ties by kind then numeric external id', async () => {
    const { repository } = setup();
    const tie = '2026-03-01T09:00:00.000Z';
    for (const key of [keyOf('manga', 2), keyOf('anime', 10), keyOf('anime', 9)]) {
      await repository.save(entryOf({ key, updatedAt: tie }));
    }

    const keys = (await repository.list()).map((entry) => entry.key);

    expect(keys).toStrictEqual([keyOf('anime', 9), keyOf('anime', 10), keyOf('manga', 2)]);
  });

  it('gets null for the same external id of another kind', async () => {
    const { repository } = setup();
    await repository.save(entryOf());

    await expect(repository.get({ ...ENTRY_KEY, kind: 'manga' })).resolves.toBeNull();
  });

  it('writes nothing when removing a key that is not stored', async () => {
    const { storage, repository } = setup();
    await repository.save(entryOf());
    const before = storage.values.get(GUEST_LIBRARY_STORAGE_KEY);
    const set = jest.spyOn(storage, 'set');
    const remove = jest.spyOn(storage, 'delete');

    await repository.remove(keyOf('anime', 1));

    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(storage.values.get(GUEST_LIBRARY_STORAGE_KEY)).toBe(before);
  });

  it('writes nothing for an invalid entry', async () => {
    const { storage, repository } = setup();
    const set = jest.spyOn(storage, 'set');

    await failureOf(repository.save(entryOf({ score: 11 })));

    expect(set).not.toHaveBeenCalled();
    expect(storage.values.has(GUEST_LIBRARY_STORAGE_KEY)).toBe(false);
  });

  describe('clear', () => {
    it('deletes the stored key', async () => {
      const { storage, repository } = setup();
      await repository.save(entryOf());

      await repository.clear();

      expect(storage.values.has(GUEST_LIBRARY_STORAGE_KEY)).toBe(false);
      await expect(repository.list()).resolves.toStrictEqual([]);
    });

    it('resolves on an empty store', async () => {
      const { storage, repository, captureError } = setup();

      await expect(repository.clear()).resolves.toBeUndefined();

      expect(storage.values.size).toBe(0);
      expect(captureError).not.toHaveBeenCalled();
    });

    it('deletes a damaged document without reading it', async () => {
      const { storage, repository, captureError } = setup('{not json');

      await repository.clear();

      expect(storage.values.has(GUEST_LIBRARY_STORAGE_KEY)).toBe(false);
      expect(captureError).not.toHaveBeenCalled();
    });

    it('rejects when the storage fails', async () => {
      const { storage, repository } = setup();
      const failure = new Error('storage failure');
      jest.spyOn(storage, 'delete').mockImplementation(() => {
        throw failure;
      });

      await expect(repository.clear()).rejects.toBe(failure);
    });
  });

  describe('storage failures', () => {
    it('rejects save when the write throws, keeping the previous document', async () => {
      const { storage, repository } = setup();
      await repository.save(entryOf());
      const before = storage.values.get(GUEST_LIBRARY_STORAGE_KEY);
      const failure = new Error('storage full');
      jest.spyOn(storage, 'set').mockImplementation(() => {
        throw failure;
      });

      await expect(repository.save(entryOf({ key: keyOf('manga', 1) }))).rejects.toBe(failure);
      await expect(repository.remove(ENTRY_KEY)).rejects.toBe(failure);

      expect(storage.values.get(GUEST_LIBRARY_STORAGE_KEY)).toBe(before);
    });

    it('rejects every read when the storage read throws', async () => {
      const { storage, repository } = setup();
      const failure = new Error('storage unavailable');
      jest.spyOn(storage, 'getString').mockImplementation(() => {
        throw failure;
      });

      await expect(repository.list()).rejects.toBe(failure);
      await expect(repository.get(ENTRY_KEY)).rejects.toBe(failure);
      await expect(repository.save(entryOf())).rejects.toBe(failure);
      await expect(repository.remove(ENTRY_KEY)).rejects.toBe(failure);
    });

    it('never throws synchronously, even when the storage does', () => {
      const { storage, repository } = setup();
      jest.spyOn(storage, 'getString').mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      const pending = repository.list();

      expect(pending).toBeInstanceOf(Promise);
      return expect(pending).rejects.toThrow('storage unavailable');
    });
  });
});

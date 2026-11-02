import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import { createMemoryStorage, createRecordingReporter } from './__fixtures__/memory-storage';
import { GUEST_LIBRARY_STORAGE_KEY, createLocalLibraryRepository } from './library-repository';

// a guest repository over an in-memory storage
const setup = () => {
  const storage = createMemoryStorage();
  const { reporter, captureError } = createRecordingReporter();
  const repository = createLocalLibraryRepository(storage, { reporter });
  return { storage, repository, captureError };
};

const FRIEREN = entryOf();
const BERSERK = entryOf({ key: keyOf('manga', 2), updatedAt: '2026-02-01T00:00:00.000Z' });
const MONSTER = entryOf({ key: keyOf('anime', 19), updatedAt: '2026-01-20T00:00:00.000Z' });

// the store holding `entries`, and the entries a merge listed from it
const listedStore = async (entries: readonly LibraryEntry[]) => {
  const library = setup();
  for (const entry of entries) {
    await library.repository.save(entry);
  }
  const listed = await library.repository.list();
  return { ...library, listed };
};

describe('createLocalLibraryRepository removeUnchanged (BR-08)', () => {
  it('removes the merged entries that did not change', async () => {
    const { repository, listed } = await listedStore([FRIEREN, BERSERK, MONSTER]);

    await repository.removeUnchanged(listed.slice(1));

    await expect(repository.list()).resolves.toStrictEqual([FRIEREN]);
  });

  it('deletes the stored document when no entry remains', async () => {
    const { storage, repository, listed, captureError } = await listedStore([FRIEREN, BERSERK]);
    const remove = jest.spyOn(storage, 'delete');

    await repository.removeUnchanged(listed);

    expect(remove).toHaveBeenCalledWith(GUEST_LIBRARY_STORAGE_KEY);
    expect(storage.values.has(GUEST_LIBRARY_STORAGE_KEY)).toBe(false);
    await expect(repository.list()).resolves.toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'a later updatedAt', change: { progress: 13, updatedAt: '2026-02-11T00:00:00.000Z' } },
    { label: 'the same updatedAt', change: { notes: 'changed on the same millisecond' } },
    { label: 'only its snapshot', change: { media: { ...FRIEREN.media, totalUnits: 30 } } },
  ])('keeps an entry changed after the listing, with $label', async ({ change }) => {
    const { repository, listed } = await listedStore([FRIEREN, BERSERK]);
    const changed = await repository.save({ ...FRIEREN, ...change });

    await repository.removeUnchanged(listed);

    await expect(repository.list()).resolves.toStrictEqual([changed]);
  });

  it('keeps an entry added after the listing', async () => {
    const { repository, listed } = await listedStore([FRIEREN]);
    const added = await repository.save(MONSTER);

    await repository.removeUnchanged(listed);

    await expect(repository.list()).resolves.toStrictEqual([added]);
  });

  it('writes nothing when no stored entry matches', async () => {
    const { storage, repository } = await listedStore([FRIEREN]);
    const before = storage.values.get(GUEST_LIBRARY_STORAGE_KEY);
    const set = jest.spyOn(storage, 'set');
    const remove = jest.spyOn(storage, 'delete');

    await repository.removeUnchanged([BERSERK, { ...FRIEREN, progress: 13 }]);
    await repository.removeUnchanged([]);

    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(storage.values.get(GUEST_LIBRARY_STORAGE_KEY)).toBe(before);
  });

  it('resolves on an empty store without writing', async () => {
    const { storage, repository } = setup();

    await expect(repository.removeUnchanged([FRIEREN])).resolves.toBeUndefined();

    expect(storage.values.size).toBe(0);
  });

  // the write keeps one entry, the delete removes both
  it.each([
    { method: 'set', mergedCount: 1 },
    { method: 'delete', mergedCount: 2 },
  ] as const)(
    'rejects when the storage $method fails, leaving the document as it was',
    async ({ method, mergedCount }) => {
      const { storage, repository, listed } = await listedStore([FRIEREN, BERSERK]);
      const before = storage.values.get(GUEST_LIBRARY_STORAGE_KEY);
      const failure = new Error('storage full');
      jest.spyOn(storage, method).mockImplementation(() => {
        throw failure;
      });

      await expect(repository.removeUnchanged(listed.slice(-mergedCount))).rejects.toBe(failure);

      expect(storage.values.get(GUEST_LIBRARY_STORAGE_KEY)).toBe(before);
    },
  );
});

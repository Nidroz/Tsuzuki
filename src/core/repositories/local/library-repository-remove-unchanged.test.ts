import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type * as guestMerge from '../../domain/guest-merge';
import { isSameLibraryEntry } from '../../domain/guest-merge';
import type { LibraryEntry } from '../../domain/library-entry';
import { createMemoryStorage, createRecordingReporter } from './__fixtures__/memory-storage';
import { GUEST_LIBRARY_STORAGE_KEY, createLocalLibraryRepository } from './library-repository';
import { serializeGuestLibrary } from './library-store';

// the real comparison, its calls counted by the cost test
jest.mock('../../domain/guest-merge', () => {
  const actual = jest.requireActual<typeof guestMerge>('../../domain/guest-merge');
  return { ...actual, isSameLibraryEntry: jest.fn(actual.isSameLibraryEntry) };
});

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

// the stored and merged entry counts of the cost test: n x m comparisons before indexing
const COST_ENTRY_COUNT = 1_000;

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

  it('removes a stored entry equal to any merged entry of its key', async () => {
    const { repository, listed } = await listedStore([FRIEREN, BERSERK]);
    const changed = { ...FRIEREN, progress: 13 };

    await repository.removeUnchanged([changed, ...listed, { ...BERSERK, progress: 2 }]);

    await expect(repository.list()).resolves.toStrictEqual([]);
  });

  it('keeps a stored entry when every merged entry of its key differs', async () => {
    const { repository, listed } = await listedStore([FRIEREN]);

    await repository.removeUnchanged([
      { ...FRIEREN, progress: 13 },
      { ...FRIEREN, notes: 'another device' },
    ]);

    await expect(repository.list()).resolves.toStrictEqual(listed);
  });

  // the cost of the call (A-04 review): each stored entry is compared with the merged entries of
  // its key only, never with the whole merged list
  it('compares each stored entry with the merged entry of its key only', async () => {
    const { storage, repository } = setup();
    const storedOf = (externalId: number) => entryOf({ key: keyOf('anime', externalId) });
    const stored = Array.from({ length: COST_ENTRY_COUNT }, (_, index) => storedOf(index + 1));
    // half of the merged keys are stored ones, unchanged; the other half are not stored
    const merged = Array.from({ length: COST_ENTRY_COUNT }, (_, index) =>
      storedOf(index + 1 + COST_ENTRY_COUNT / 2),
    );
    storage.set(GUEST_LIBRARY_STORAGE_KEY, serializeGuestLibrary(stored));
    const compare = jest.mocked(isSameLibraryEntry);
    compare.mockClear();

    await repository.removeUnchanged(merged);

    expect(compare.mock.calls.length).toBeLessThanOrEqual(stored.length);
    await expect(repository.list()).resolves.toHaveLength(COST_ENTRY_COUNT / 2);
  });
});

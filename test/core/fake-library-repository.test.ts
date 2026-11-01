import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { describeAccountLibraryMergeContract } from './account-library-merge-contract';
import {
  createDeferred,
  createFakeAccountLibraryRepository,
  createFakeGuestLibraryRepository,
  holdNextCall,
  mergedCopyOf,
} from './fake-library-repository';
import { entryOf, keyOf } from './library-entry-fixtures';

// the in-memory doubles of the hook tests follow the contracts of the real repositories

// a merge time after every guest and account time of the contract, as a server's would be
const SERVER_NOW = Date.UTC(2026, 2, 1, 9);
// a later merge of the same entry
const LATER_MERGE_DELAY_MS = 1000;

describe('in-memory fake at a server time after the entries', () => {
  beforeEach(() => {
    jest.setSystemTime(SERVER_NOW);
  });

  describeAccountLibraryMergeContract('in-memory fake', (seed) =>
    createFakeAccountLibraryRepository(seed),
  );
});

const FRIEREN = entryOf();
const BERSERK = entryOf({ key: keyOf('manga', 2) });

describe('createFakeAccountLibraryRepository', () => {
  it('holds a merge on beforeCall, changing nothing until it is released', async () => {
    const repository = createFakeAccountLibraryRepository();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);

    const merge = repository.mergeGuestEntries([FRIEREN]);

    expect(repository.beforeCall).toHaveBeenCalledWith('mergeGuestEntries');
    expect(repository.stored(FRIEREN.key)).toBeNull();
    held.resolve();
    await merge;
    expect(repository.stored(FRIEREN.key)).toStrictEqual(
      mergedCopyOf(FRIEREN, new Date().toISOString()),
    );
  });

  it('keeps the guest times on what it writes, capped at the merge time, as the database does', async () => {
    jest.setSystemTime(SERVER_NOW);
    const mergedAt = new Date(SERVER_NOW).toISOString();
    const older = { ...BERSERK, progress: 1, updatedAt: '2026-01-15T00:00:00.000Z' };
    const newer = { ...BERSERK, progress: 3, updatedAt: '2026-02-20T00:00:00.000Z' };
    const ahead = entryOf({ key: keyOf('manga', 3), updatedAt: '2100-01-01T00:00:00.000Z' });
    const repository = createFakeAccountLibraryRepository([older]);

    await repository.mergeGuestEntries([FRIEREN, newer, ahead]);

    // inserted: its own updatedAt, the merge time as createdAt
    expect(repository.stored(FRIEREN.key)).toStrictEqual({ ...FRIEREN, createdAt: mergedAt });
    // replaced: its own updatedAt, the stored createdAt kept
    expect(repository.stored(BERSERK.key)).toStrictEqual({ ...newer, createdAt: older.createdAt });
    // a time after the merge is capped at it
    expect(repository.stored(ahead.key)).toStrictEqual({
      ...ahead,
      createdAt: mergedAt,
      updatedAt: mergedAt,
    });
    expect(mergedCopyOf(FRIEREN, mergedAt)).toStrictEqual(repository.stored(FRIEREN.key));
    expect(mergedCopyOf(newer, mergedAt, older)).toStrictEqual(repository.stored(BERSERK.key));
    expect(mergedCopyOf(ahead, mergedAt)).toStrictEqual(repository.stored(ahead.key));
  });

  it('keeps the merged copy over a change of the same time merged again later (BR-08)', async () => {
    jest.setSystemTime(SERVER_NOW);
    const repository = createFakeAccountLibraryRepository();
    const guest = { ...FRIEREN, updatedAt: '2026-02-20T00:00:00.000Z' };
    await repository.mergeGuestEntries([guest]);
    const merged = repository.stored(FRIEREN.key);

    await jest.advanceTimersByTimeAsync(LATER_MERGE_DELAY_MS);
    await repository.mergeGuestEntries([{ ...guest, progress: guest.progress + 1 }]);

    expect(repository.stored(FRIEREN.key)).toBe(merged);
  });

  it('compares the capped time: a time ahead merged again after the merge time replaces it', async () => {
    jest.setSystemTime(SERVER_NOW);
    const repository = createFakeAccountLibraryRepository();
    const ahead = { ...FRIEREN, updatedAt: '2100-01-01T00:00:00.000Z' };
    await repository.mergeGuestEntries([ahead]);

    await jest.advanceTimersByTimeAsync(LATER_MERGE_DELAY_MS);
    await repository.mergeGuestEntries([ahead]);

    expect(repository.stored(FRIEREN.key)?.updatedAt).toBe(
      new Date(SERVER_NOW + LATER_MERGE_DELAY_MS).toISOString(),
    );
  });
});

describe('createFakeGuestLibraryRepository', () => {
  it('removes the unchanged entries only (BR-08)', async () => {
    const changed = { ...BERSERK, progress: 3, updatedAt: '2026-03-01T00:00:00.000Z' };
    const repository = createFakeGuestLibraryRepository([FRIEREN, changed]);

    await repository.removeUnchanged([FRIEREN, BERSERK]);

    expect(repository.beforeCall).toHaveBeenCalledWith('removeUnchanged');
    await expect(repository.list()).resolves.toStrictEqual([changed]);
  });

  it('clears every entry', async () => {
    const repository = createFakeGuestLibraryRepository([FRIEREN, BERSERK]);

    await repository.clear();

    expect(repository.beforeCall).toHaveBeenCalledWith('clear');
    await expect(repository.list()).resolves.toStrictEqual([]);
  });

  it('fails a removal through beforeCall, removing nothing', async () => {
    const repository = createFakeGuestLibraryRepository([FRIEREN]);
    const failure = new Error('storage failure');
    repository.beforeCall.mockRejectedValueOnce(failure);

    await expect(repository.removeUnchanged([FRIEREN])).rejects.toBe(failure);

    expect(repository.stored(FRIEREN.key)).toStrictEqual(FRIEREN);
  });
});

describe('holdNextCall', () => {
  it('holds the next call of the method only, then fails it without a change', async () => {
    const repository = createFakeGuestLibraryRepository([FRIEREN]);
    const held = holdNextCall(repository, 'removeUnchanged');
    const failure = new Error('storage failure');

    // another method goes on at once
    await expect(repository.list()).resolves.toStrictEqual([FRIEREN]);
    const removal = repository.removeUnchanged([FRIEREN]);
    held.reject(failure);

    await expect(removal).rejects.toBe(failure);
    expect(repository.stored(FRIEREN.key)).toStrictEqual(FRIEREN);
    // the later calls go on at once
    await repository.removeUnchanged([FRIEREN]);
    expect(repository.stored(FRIEREN.key)).toBeNull();
  });
});

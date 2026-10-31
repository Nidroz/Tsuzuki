import { describe, expect, it } from '@jest/globals';

import { describeAccountLibraryMergeContract } from './account-library-merge-contract';
import {
  createDeferred,
  createFakeAccountLibraryRepository,
  createFakeGuestLibraryRepository,
  holdNextCall,
} from './fake-library-repository';
import { entryOf, keyOf } from './library-entry-fixtures';

// the in-memory doubles of the hook tests follow the contracts of the real repositories

describeAccountLibraryMergeContract('in-memory fake', (seed) =>
  createFakeAccountLibraryRepository(seed),
);

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
    expect(repository.stored(FRIEREN.key)).toStrictEqual(FRIEREN);
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

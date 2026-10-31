// the guest merge contract every AccountLibraryRepository passes (BR-08, FR-22, ADR-0016): the
// account store (supabase/, A-04) and the in-memory fake of the hook tests. it knows the
// interface, the domain and the schemas only, never a storage: each implementation test calls
// describeAccountLibraryMergeContract with a factory of a repository holding seed entries stored
// with their own timestamps. the database sets the timestamps of what a merge writes, so written
// entries are compared without them, and untouched ones whole
import { describe, expect, it } from '@jest/globals';

import type { LibraryEntry } from '@core/domain/library-entry';
import { compareMediaKeys } from '@core/domain/media';
import type { AccountLibraryRepository } from '@core/repositories/library-repository';

import { NOTES_TEXT, TITLE_TEXT, entryOf, keyOf } from './library-entry-fixtures';
import { INVALID_ENTRIES, failureOf } from './library-repository-contract-support';

/** a new repository holding `seed`, each entry stored with its own timestamps. */
export type AccountLibraryMergeFactory = (
  seed: readonly LibraryEntry[],
) => AccountLibraryRepository | Promise<AccountLibraryRepository>;

// guest and account times, all before any time a server sets in the tests
const EARLIER = '2026-02-01T08:00:00.000Z';
const LATER = '2026-02-20T08:00:00.000Z';

/** a guest entry of a key the seeded account never has. */
export const GUEST_ONLY = entryOf({
  key: keyOf('anime', 1),
  notes: 'guest only',
  updatedAt: LATER,
});
const ACCOUNT_ONLY = entryOf({ key: keyOf('anime', 2), notes: 'account', updatedAt: EARLIER });
// the account copy older than the guest one: replaced
const ACCOUNT_OLDER = entryOf({ key: keyOf('anime', 3), progress: 3, updatedAt: EARLIER });
const GUEST_NEWER = entryOf({
  key: keyOf('anime', 3),
  status: 'completed',
  progress: 28,
  score: 10,
  notes: 'finished on the device',
  isFavorite: true,
  finishedAt: '2026-02-19',
  updatedAt: LATER,
});
// the account copy newer than the guest one: kept
const ACCOUNT_NEWER = entryOf({ key: keyOf('manga', 4), progress: 40, updatedAt: LATER });
const GUEST_OLDER = entryOf({ key: keyOf('manga', 4), progress: 12, updatedAt: EARLIER });
// as recent on both sides: the account copy kept
const ACCOUNT_TIED = entryOf({ key: keyOf('anime', 5), progress: 5, updatedAt: LATER });
const GUEST_TIED = entryOf({
  key: keyOf('anime', 5),
  progress: 6,
  isFavorite: true,
  updatedAt: LATER,
});

const MIXED_ACCOUNT = [ACCOUNT_ONLY, ACCOUNT_OLDER, ACCOUNT_NEWER, ACCOUNT_TIED];
const MIXED_GUEST = [GUEST_ONLY, GUEST_NEWER, GUEST_OLDER, GUEST_TIED];

/** an entry without its timestamps, which the account store takes from the server. */
export const valuesOf = (entry: LibraryEntry) => ({
  ...entry,
  createdAt: undefined,
  updatedAt: undefined,
});

/** the listed entries without their timestamps, in key order. */
export const listedValues = async (repository: AccountLibraryRepository) =>
  [...(await repository.list())].sort((a, b) => compareMediaKeys(a.key, b.key)).map(valuesOf);

const expectNoValue = (error: unknown): void => {
  expect(error).toBeInstanceOf(RangeError);
  expect(String(error)).not.toContain(TITLE_TEXT);
  expect(String(error)).not.toContain(NOTES_TEXT);
  expect(String(error)).not.toContain('52991');
};

/** registers the guest merge contract of one AccountLibraryRepository implementation. */
export const describeAccountLibraryMergeContract = (
  name: string,
  createRepository: AccountLibraryMergeFactory,
): void => {
  describe(`${name} guest merge contract (BR-08)`, () => {
    it('inserts a guest entry the account does not have', async () => {
      const repository = await createRepository([]);

      await repository.mergeGuestEntries([GUEST_ONLY]);

      await expect(listedValues(repository)).resolves.toStrictEqual([valuesOf(GUEST_ONLY)]);
    });

    it('leaves an account entry the guest does not have untouched', async () => {
      const repository = await createRepository([ACCOUNT_ONLY]);

      await repository.mergeGuestEntries([GUEST_ONLY]);

      const listed = await repository.list();
      expect(listed).toHaveLength(2);
      expect(listed).toContainEqual(ACCOUNT_ONLY);
    });

    it('replaces the account values with a newer guest entry (the most recent wins)', async () => {
      const repository = await createRepository([ACCOUNT_OLDER]);

      await repository.mergeGuestEntries([GUEST_NEWER]);

      await expect(listedValues(repository)).resolves.toStrictEqual([valuesOf(GUEST_NEWER)]);
    });

    it('keeps an account entry newer than the guest one', async () => {
      const repository = await createRepository([ACCOUNT_NEWER]);

      await repository.mergeGuestEntries([GUEST_OLDER]);

      await expect(repository.list()).resolves.toStrictEqual([ACCOUNT_NEWER]);
    });

    it('keeps the account entry when both are as recent', async () => {
      const repository = await createRepository([ACCOUNT_TIED]);

      await repository.mergeGuestEntries([GUEST_TIED]);

      await expect(repository.list()).resolves.toStrictEqual([ACCOUNT_TIED]);
    });

    it('merges inserted, untouched, replaced and kept entries in one call', async () => {
      const repository = await createRepository(MIXED_ACCOUNT);

      await repository.mergeGuestEntries(MIXED_GUEST);

      await expect(listedValues(repository)).resolves.toStrictEqual(
        [GUEST_ONLY, ACCOUNT_ONLY, GUEST_NEWER, ACCOUNT_TIED, ACCOUNT_NEWER].map(valuesOf),
      );
      const listed = await repository.list();
      expect(listed).toContainEqual(ACCOUNT_ONLY);
      expect(listed).toContainEqual(ACCOUNT_NEWER);
      expect(listed).toContainEqual(ACCOUNT_TIED);
    });

    it('changes nothing when the same entries are merged again', async () => {
      const repository = await createRepository(MIXED_ACCOUNT);
      await repository.mergeGuestEntries(MIXED_GUEST);
      const merged = await repository.list();

      await repository.mergeGuestEntries(MIXED_GUEST);

      await expect(repository.list()).resolves.toStrictEqual(merged);
    });

    it('resolves an empty list, changing nothing', async () => {
      const repository = await createRepository([ACCOUNT_ONLY]);

      await expect(repository.mergeGuestEntries([])).resolves.toBeUndefined();

      await expect(repository.list()).resolves.toStrictEqual([ACCOUNT_ONLY]);
    });

    it.each(INVALID_ENTRIES)(
      'rejects $label with a RangeError holding no value, writing nothing',
      async ({ entry }) => {
        const repository = await createRepository([ACCOUNT_ONLY]);

        const error = await failureOf(repository.mergeGuestEntries([GUEST_ONLY, entry]));

        expectNoValue(error);
        await expect(repository.list()).resolves.toStrictEqual([ACCOUNT_ONLY]);
      },
    );

    it('rejects two entries of one key with a RangeError holding no value, writing nothing', async () => {
      const repository = await createRepository([ACCOUNT_ONLY]);
      const twice = entryOf({ progress: 13 });

      const error = await failureOf(repository.mergeGuestEntries([GUEST_ONLY, entryOf(), twice]));

      expectNoValue(error);
      await expect(repository.list()).resolves.toStrictEqual([ACCOUNT_ONLY]);
    });
  });
};

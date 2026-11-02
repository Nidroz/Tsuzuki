// the replay contract every RemoteAccountLibraryRepository passes (BR-08, FR-23, ADR-0017): the
// account store (supabase/, A-05) and the in-memory fake of the hook tests. it knows the
// interface, the domain and the schemas only, never a storage: each implementation test calls
// describeAccountLibraryReplayContract with a factory of a repository holding seed entries stored
// with their own timestamps, its server time after every time below except FUTURE. a written save
// keeps its own `updatedAt`, capped at the server time, and the server sets the `createdAt` of an
// inserted one, so written entries are compared without `createdAt`, and untouched ones whole
import { describe, expect, it } from '@jest/globals';

import type { LibraryEntry } from '@core/domain/library-entry';
import { LIBRARY_REPLAY_BATCH_SIZE, type LibraryQueuedWrite } from '@core/domain/library-sync';
import { compareMediaKeys, type MediaKey } from '@core/domain/media';
import type { RemoteAccountLibraryRepository } from '@core/repositories/library-repository';

import { listedValues, valuesOf } from './account-library-merge-contract';
import { NOTES_TEXT, TITLE_TEXT, entryOf, keyOf } from './library-entry-fixtures';
import { INVALID_ENTRIES, INVALID_KEYS, failureOf } from './library-repository-contract-support';

/** a new repository holding `seed`, each entry stored with its own timestamps. */
export type AccountLibraryReplayFactory = (
  seed: readonly LibraryEntry[],
) => RemoteAccountLibraryRepository | Promise<RemoteAccountLibraryRepository>;

// times of changes, all before any time a server sets in the tests
const EARLIER = '2026-02-01T08:00:00.000Z';
const BETWEEN = '2026-02-10T08:00:00.000Z';
const LATER = '2026-02-20T08:00:00.000Z';
// a time after the server time: a device clock ahead of the server
const FUTURE = '2100-01-01T00:00:00.000Z';

const save = (entry: LibraryEntry): LibraryQueuedWrite => ({ type: 'save', entry });
const removal = (key: MediaKey, removedAt: string): LibraryQueuedWrite => ({
  type: 'remove',
  key,
  removedAt,
});

// a save of a key the seeded account never has
const SAVE_ONLY = entryOf({ key: keyOf('anime', 1), notes: 'queued only', updatedAt: LATER });
const UNTOUCHED = entryOf({ key: keyOf('anime', 2), notes: 'account', updatedAt: EARLIER });
// the stored copy older than the queued save: replaced
const STORED_OLDER = entryOf({ key: keyOf('anime', 3), progress: 3, updatedAt: EARLIER });
const SAVE_NEWER = entryOf({
  key: keyOf('anime', 3),
  createdAt: BETWEEN,
  status: 'completed',
  progress: 28,
  score: 10,
  notes: 'finished offline',
  isFavorite: true,
  finishedAt: '2026-02-19',
  updatedAt: LATER,
});
// the stored copy newer than the queued save: kept
const STORED_NEWER = entryOf({ key: keyOf('manga', 4), progress: 40, updatedAt: LATER });
const SAVE_OLDER = entryOf({ key: keyOf('manga', 4), progress: 12, updatedAt: EARLIER });
// as recent on both sides: the stored copy kept
const STORED_TIED = entryOf({ key: keyOf('anime', 5), progress: 5, updatedAt: LATER });
const SAVE_TIED = entryOf({ key: keyOf('anime', 5), progress: 6, updatedAt: LATER });
// removals: of an older stored entry (removed), of a newer one (kept), of a key not stored
const REMOVED_OLDER = entryOf({ key: keyOf('anime', 6), progress: 6, updatedAt: EARLIER });
const KEPT_NEWER = entryOf({ key: keyOf('anime', 7), progress: 7, updatedAt: LATER });
const MISSING_KEY = keyOf('anime', 8);

const MIXED_SEED = [UNTOUCHED, STORED_OLDER, STORED_NEWER, STORED_TIED, REMOVED_OLDER, KEPT_NEWER];
// in no key order, so the answer is checked against the input order
const MIXED_WRITES = [
  removal(KEPT_NEWER.key, BETWEEN),
  save(SAVE_ONLY),
  save(SAVE_OLDER),
  removal(REMOVED_OLDER.key, BETWEEN),
  save(SAVE_NEWER),
  removal(MISSING_KEY, BETWEEN),
  save(SAVE_TIED),
];
const MIXED_OUTCOMES = ['kept', 'written', 'kept', 'written', 'written', 'written', 'kept'];
// the same writes again: the saves now as recent as the stored copies, the removed key missing
const REPLAYED_OUTCOMES = ['kept', 'kept', 'kept', 'written', 'kept', 'written', 'kept'];

const byKey = (entries: readonly LibraryEntry[]): LibraryEntry[] =>
  [...entries].sort((a, b) => compareMediaKeys(a.key, b.key));

const expectNoValue = (error: unknown): void => {
  expect(error).toBeInstanceOf(RangeError);
  expect(String(error)).not.toContain(TITLE_TEXT);
  expect(String(error)).not.toContain(NOTES_TEXT);
  expect(String(error)).not.toContain('52991');
};

// writes refused before anything is written: each with a valid save of another key
const INVALID_WRITES: readonly { readonly label: string; readonly write: LibraryQueuedWrite }[] = [
  ...INVALID_ENTRIES.map(({ label, entry }) => ({
    label: `a save of ${label}`,
    write: save(entry),
  })),
  ...INVALID_KEYS.map(({ label, entry }) => ({
    label: `a removal of ${label}`,
    write: removal(entry.key, LATER),
  })),
  { label: 'a removal time without offset', write: removal(keyOf('anime', 9), '2026-02-10T20:30') },
  { label: 'a removal time that is not one', write: removal(keyOf('anime', 9), 'now') },
];

/** registers the replay contract of one RemoteAccountLibraryRepository implementation. */
export const describeAccountLibraryReplayContract = (
  name: string,
  createRepository: AccountLibraryReplayFactory,
): void => {
  describe(`${name} replay contract (BR-08)`, () => {
    it('inserts a save of a key the account does not have, with its own updatedAt', async () => {
      const repository = await createRepository([UNTOUCHED]);

      await expect(repository.replayWrites([save(SAVE_ONLY)])).resolves.toStrictEqual(['written']);

      await expect(listedValues(repository)).resolves.toStrictEqual(
        byKey([SAVE_ONLY, UNTOUCHED]).map(valuesOf),
      );
      await expect(repository.get(UNTOUCHED.key)).resolves.toStrictEqual(UNTOUCHED);
    });

    it('replaces an older stored copy, keeping its createdAt (the most recent wins)', async () => {
      const repository = await createRepository([STORED_OLDER]);

      await expect(repository.replayWrites([save(SAVE_NEWER)])).resolves.toStrictEqual(['written']);

      await expect(repository.list()).resolves.toStrictEqual([
        { ...SAVE_NEWER, createdAt: STORED_OLDER.createdAt },
      ]);
    });

    it.each([
      { label: 'newer than', stored: STORED_NEWER, write: SAVE_OLDER },
      { label: 'as recent as', stored: STORED_TIED, write: SAVE_TIED },
    ])('keeps a stored copy $label the queued save', async ({ stored, write }) => {
      const repository = await createRepository([stored]);

      await expect(repository.replayWrites([save(write)])).resolves.toStrictEqual(['kept']);

      await expect(repository.list()).resolves.toStrictEqual([stored]);
    });

    it.each([
      { label: 'an inserted', seed: [] },
      { label: 'a replacing', seed: [STORED_OLDER] },
    ])('caps the future updatedAt of $label save at the server time', async ({ seed }) => {
      const repository = await createRepository(seed);

      await expect(
        repository.replayWrites([save({ ...SAVE_NEWER, updatedAt: FUTURE })]),
      ).resolves.toStrictEqual(['written']);

      const listed = await repository.list();
      expect(listed).toMatchObject([{ key: SAVE_NEWER.key, progress: SAVE_NEWER.progress }]);
      // the server time: after every time of the entries, before the device's
      const updatedAt = listed[0]?.updatedAt ?? '';
      expect(updatedAt > LATER && updatedAt < FUTURE).toBe(true);
    });

    it('removes a stored entry strictly older than the removal', async () => {
      const repository = await createRepository([REMOVED_OLDER, UNTOUCHED]);

      await expect(
        repository.replayWrites([removal(REMOVED_OLDER.key, BETWEEN)]),
      ).resolves.toStrictEqual(['written']);

      await expect(repository.list()).resolves.toStrictEqual([UNTOUCHED]);
    });

    it.each([
      { label: 'newer than', removedAt: BETWEEN },
      { label: 'as recent as', removedAt: LATER },
    ])('keeps a stored entry $label the removal', async ({ removedAt }) => {
      const repository = await createRepository([KEPT_NEWER]);

      await expect(
        repository.replayWrites([removal(KEPT_NEWER.key, removedAt)]),
      ).resolves.toStrictEqual(['kept']);

      await expect(repository.list()).resolves.toStrictEqual([KEPT_NEWER]);
    });

    it('answers written for the removal of a key the account does not hold', async () => {
      const repository = await createRepository([UNTOUCHED]);

      await expect(repository.replayWrites([removal(MISSING_KEY, BETWEEN)])).resolves.toStrictEqual(
        ['written'],
      );

      await expect(repository.list()).resolves.toStrictEqual([UNTOUCHED]);
    });

    it('removes an older stored entry with a removal timed after the server time', async () => {
      const repository = await createRepository([KEPT_NEWER]);

      await expect(
        repository.replayWrites([removal(KEPT_NEWER.key, FUTURE)]),
      ).resolves.toStrictEqual(['written']);

      await expect(repository.list()).resolves.toStrictEqual([]);
    });

    it('applies saves and removals in one call, answering in input order', async () => {
      const repository = await createRepository(MIXED_SEED);

      await expect(repository.replayWrites(MIXED_WRITES)).resolves.toStrictEqual(MIXED_OUTCOMES);

      await expect(listedValues(repository)).resolves.toStrictEqual(
        byKey([SAVE_ONLY, UNTOUCHED, SAVE_NEWER, STORED_NEWER, STORED_TIED, KEPT_NEWER]).map(
          valuesOf,
        ),
      );
      const listed = await repository.list();
      for (const untouched of [UNTOUCHED, STORED_NEWER, STORED_TIED, KEPT_NEWER]) {
        expect(listed).toContainEqual(untouched);
      }
    });

    it('changes nothing when the same writes are replayed again', async () => {
      const repository = await createRepository(MIXED_SEED);
      await repository.replayWrites(MIXED_WRITES);
      const replayed = await repository.list();

      await expect(repository.replayWrites(MIXED_WRITES)).resolves.toStrictEqual(REPLAYED_OUTCOMES);

      await expect(repository.list()).resolves.toStrictEqual(replayed);
    });

    it('resolves an empty list to an empty answer, changing nothing', async () => {
      const repository = await createRepository([UNTOUCHED]);

      await expect(repository.replayWrites([])).resolves.toStrictEqual([]);

      await expect(repository.list()).resolves.toStrictEqual([UNTOUCHED]);
    });

    it.each(INVALID_WRITES)(
      'rejects $label with a RangeError holding no value, writing nothing',
      async ({ write }) => {
        const repository = await createRepository([UNTOUCHED]);

        const error = await failureOf(repository.replayWrites([save(SAVE_ONLY), write]));

        expectNoValue(error);
        await expect(repository.list()).resolves.toStrictEqual([UNTOUCHED]);
      },
    );

    it('rejects two writes of one key with a RangeError holding no value, writing nothing', async () => {
      const repository = await createRepository([UNTOUCHED]);

      const error = await failureOf(
        repository.replayWrites([save(entryOf()), save(SAVE_ONLY), removal(entryOf().key, LATER)]),
      );

      expectNoValue(error);
      await expect(repository.list()).resolves.toStrictEqual([UNTOUCHED]);
    });

    it(`rejects more than ${String(LIBRARY_REPLAY_BATCH_SIZE)} writes with a RangeError, writing nothing`, async () => {
      const repository = await createRepository([UNTOUCHED]);
      const writes = Array.from({ length: LIBRARY_REPLAY_BATCH_SIZE + 1 }, (_, index) =>
        save(entryOf({ key: keyOf('manga', index + 1) })),
      );

      const error = await failureOf(repository.replayWrites(writes));

      expectNoValue(error);
      await expect(repository.list()).resolves.toStrictEqual([UNTOUCHED]);
    });
  });
};

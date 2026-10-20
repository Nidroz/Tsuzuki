// the contract every LibraryRepository implementation passes (docs/ARCHITECTURE.md §4): the guest
// store (local/, L-02) and the account store (supabase/, A-03). it knows the interface, the domain
// and the schemas only, never a storage: each implementation test calls
// describeLibraryRepositoryContract with a factory of an empty repository. stored timestamps may be
// the implementation's own (the database sets them for a signed-in user), so the checks compare
// with what `save` resolved to, never with the timestamps passed in
import { describe, expect, it } from '@jest/globals';

import { MEDIA_TITLE_MAX_LENGTH, POSTGRES_INTEGER_MAX } from '@core/domain/database-limits';
import { NOTES_MAX_LENGTH, SCORE_MAX } from '@core/domain/library-entry';
import type { LibraryRepository } from '@core/repositories/library-repository';
import { libraryEntrySchema } from '@core/schemas/library-entry';

import {
  ENTRY_KEY,
  NOTES_TEXT,
  TITLE_TEXT,
  entryOf,
  entryWithMedia,
  keyOf,
} from './library-entry-fixtures';
import {
  INVALID_ENTRIES,
  INVALID_KEYS,
  ISO_TIMESTAMP,
  failureOf,
  inListOrder,
  saveAll,
} from './library-repository-contract-support';

/** a new, empty repository, called once per test. */
export type LibraryRepositoryFactory = () => LibraryRepository | Promise<LibraryRepository>;

/** registers the contract suite of one library repository implementation. */
export const describeLibraryRepositoryContract = (
  name: string,
  createRepository: LibraryRepositoryFactory,
): void => {
  describe(`${name} library repository contract`, () => {
    it('lists nothing and gets null when empty', async () => {
      const repository = await createRepository();

      await expect(repository.list()).resolves.toStrictEqual([]);
      await expect(repository.get(ENTRY_KEY)).resolves.toBeNull();
    });

    it('gets and lists a saved entry as save resolved it', async () => {
      const repository = await createRepository();

      const stored = await repository.save(entryOf());

      expect(libraryEntrySchema.parse(stored)).toStrictEqual(stored);
      expect(stored).toMatchObject({ key: ENTRY_KEY, media: entryOf().media, notes: NOTES_TEXT });
      await expect(repository.get(ENTRY_KEY)).resolves.toStrictEqual(stored);
      await expect(repository.list()).resolves.toStrictEqual([stored]);
    });

    it('resolves to the stored entry with normalized timestamps', async () => {
      const repository = await createRepository();

      const stored = await repository.save(
        entryOf({
          createdAt: '2026-01-05T12:00:00.987654+02:00',
          updatedAt: '2026-02-10T20:30:00.123456+00:00',
        }),
      );

      expect(stored.createdAt).toMatch(ISO_TIMESTAMP);
      expect(stored.updatedAt).toMatch(ISO_TIMESTAMP);
      await expect(repository.get(ENTRY_KEY)).resolves.toStrictEqual(stored);
    });

    it('drops unknown fields of a saved entry', async () => {
      const repository = await createRepository();
      const wider = { ...entryOf(), id: 'row-id', userId: 'owner' };

      const stored = await repository.save(wider);

      expect(Object.keys(stored).sort()).toStrictEqual(Object.keys(entryOf()).sort());
      await expect(repository.get(ENTRY_KEY)).resolves.toStrictEqual(stored);
    });

    it('lists by updatedAt descending, then by key ascending', async () => {
      const repository = await createRepository();
      const tie = '2026-03-01T09:00:00.000Z';
      // saved in an order that is neither the list order nor its reverse
      const stored = await saveAll(repository, [
        entryOf({ key: keyOf('manga', 2), updatedAt: tie }),
        entryOf({ key: keyOf('anime', 30), updatedAt: '2026-02-01T09:00:00.000Z' }),
        entryOf({ key: keyOf('anime', 9), updatedAt: tie }),
        entryOf({ key: keyOf('manga', 1), updatedAt: '2026-04-01T09:00:00.000Z' }),
        entryOf({ key: keyOf('anime', 10), updatedAt: tie }),
      ]);

      const listed = await repository.list();

      expect(listed).toStrictEqual(inListOrder(stored));
      expect(listed).toHaveLength(stored.length);
    });

    it('replaces the entry of the same key and keeps the stored createdAt', async () => {
      const repository = await createRepository();
      const first = await repository.save(entryOf());

      const second = await repository.save(
        entryOf({
          status: 'completed',
          progress: 28,
          notes: 'second watch',
          isFavorite: true,
          finishedAt: '2026-03-01',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        }),
      );

      expect(second.createdAt).toBe(first.createdAt);
      expect(second).toMatchObject({
        status: 'completed',
        notes: 'second watch',
        isFavorite: true,
      });
      await expect(repository.list()).resolves.toStrictEqual([second]);
      await expect(repository.get(ENTRY_KEY)).resolves.toStrictEqual(second);
    });

    it('keeps entries of the same external id and different kinds apart', async () => {
      const repository = await createRepository();
      const [anime, manga] = await saveAll(repository, [
        entryOf({ key: keyOf('anime', 7), notes: 'the anime' }),
        entryOf({ key: keyOf('manga', 7), notes: 'the manga' }),
      ]);

      await expect(repository.get(keyOf('anime', 7))).resolves.toStrictEqual(anime);
      await expect(repository.get(keyOf('manga', 7))).resolves.toStrictEqual(manga);
      await repository.remove(keyOf('anime', 7));
      await expect(repository.get(keyOf('anime', 7))).resolves.toBeNull();
      await expect(repository.list()).resolves.toStrictEqual([manga]);
    });

    it('removes the entry of a key', async () => {
      const repository = await createRepository();
      const [, kept] = await saveAll(repository, [entryOf(), entryOf({ key: keyOf('anime', 1) })]);

      await repository.remove(ENTRY_KEY);

      await expect(repository.get(ENTRY_KEY)).resolves.toBeNull();
      await expect(repository.list()).resolves.toStrictEqual([kept]);
    });

    it('resolves when removing a key that is not stored', async () => {
      const repository = await createRepository();
      const stored = await repository.save(entryOf());

      await expect(repository.remove(keyOf('manga', 52991))).resolves.toBeUndefined();
      await expect(repository.list()).resolves.toStrictEqual([stored]);
    });

    it('saves an entry at the database limits', async () => {
      const repository = await createRepository();
      const atLimits = entryWithMedia(
        { title: '\u{1F600}'.repeat(MEDIA_TITLE_MAX_LENGTH), totalUnits: null },
        { notes: 'n'.repeat(NOTES_MAX_LENGTH), score: SCORE_MAX, progress: POSTGRES_INTEGER_MAX },
      );

      const stored = await repository.save(atLimits);

      expect(stored).toMatchObject({ media: atLimits.media, notes: atLimits.notes });
    });

    describe.each(INVALID_ENTRIES)('an entry with $label', ({ entry }) => {
      it('rejects with a RangeError holding no title or notes, writing nothing', async () => {
        const repository = await createRepository();
        const stored = await repository.save(entryOf({ key: keyOf('manga', 1) }));

        const error = await failureOf(repository.save(entry));

        expect(error).toBeInstanceOf(RangeError);
        expect(String(error)).not.toContain(TITLE_TEXT);
        expect(String(error)).not.toContain(NOTES_TEXT);
        await expect(repository.list()).resolves.toStrictEqual([stored]);
      });

      it('leaves the stored entry of its key unchanged', async () => {
        const repository = await createRepository();
        const stored = await repository.save(entryOf());

        await failureOf(repository.save({ ...entry, key: ENTRY_KEY }));

        await expect(repository.get(ENTRY_KEY)).resolves.toStrictEqual(stored);
      });
    });

    it.each(INVALID_KEYS)('rejects an entry with $label, writing nothing', async ({ entry }) => {
      const repository = await createRepository();

      const error = await failureOf(repository.save(entry));

      expect(error).toBeInstanceOf(RangeError);
      expect(String(error)).not.toContain(TITLE_TEXT);
      expect(String(error)).not.toContain(NOTES_TEXT);
      await expect(repository.list()).resolves.toStrictEqual([]);
    });
  });
};

import { describe, expect, it, jest } from '@jest/globals';

import {
  ENTRY_KEY,
  NOTES_TEXT,
  TITLE_TEXT,
  entryOf,
  keyOf,
} from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import { LibraryStorageError, type LibraryStorageReason } from '../../errors/library-errors';
import { createMemoryStorage, createRecordingReporter } from './__fixtures__/memory-storage';
import { GUEST_LIBRARY_STORAGE_KEY, createLocalLibraryRepository } from './library-repository';

// the stored guest library is untrusted: what a damaged document reads as, what is reported, and
// how the next write repairs it

const envelopeOf = (entries: readonly unknown[]): string => JSON.stringify({ version: 1, entries });

// a guest repository over an in-memory storage holding `stored` under the guest library key
const setup = (stored: string) => {
  const storage = createMemoryStorage();
  storage.values.set(GUEST_LIBRARY_STORAGE_KEY, stored);
  const { reporter, captureError } = createRecordingReporter();
  const repository = createLocalLibraryRepository(storage, { reporter });
  return { storage, reporter, repository, captureError };
};

const reasonsOf = (captureError: ReturnType<typeof setup>['captureError']): unknown[] =>
  captureError.mock.calls.map(([error]) =>
    error instanceof LibraryStorageError ? error.reason : error,
  );

const ANIME = entryOf();
const MANGA = entryOf({ key: keyOf('manga', 5), updatedAt: '2026-03-01T00:00:00.000Z' });
const INVALID_ENTRY = { ...entryOf({ key: keyOf('anime', 8) }), score: 11 };

describe('a damaged guest library', () => {
  it.each(['{"version":1,"entries":[', '', 'undefined', '{not json'])(
    'reads invalid json %p as empty and reports invalid-json',
    async (stored) => {
      const { repository, captureError } = setup(stored);

      await expect(repository.list()).resolves.toStrictEqual([]);
      await expect(repository.get(ENTRY_KEY)).resolves.toBeNull();
      expect(reasonsOf(captureError)).toStrictEqual(['invalid-json']);
    },
  );

  it.each([
    ['null', 'null'],
    ['an array of entries', JSON.stringify([ANIME])],
    ['no version', JSON.stringify({ entries: [ANIME] })],
    ['version 2', JSON.stringify({ version: 2, entries: [ANIME] })],
    ['a string version', JSON.stringify({ version: '1', entries: [ANIME] })],
    ['entries as an object', JSON.stringify({ version: 1, entries: { 0: ANIME } })],
  ])('reads %s as empty and reports invalid-envelope', async (_label, stored) => {
    const { repository, captureError } = setup(stored);

    await expect(repository.list()).resolves.toStrictEqual([]);
    expect(reasonsOf(captureError)).toStrictEqual(['invalid-envelope']);
  });

  it.each<[string, unknown]>([
    ['a score of 11', INVALID_ENTRY],
    ['an incomplete snapshot', { ...ANIME, key: keyOf('anime', 8), media: { title: TITLE_TEXT } }],
    ['null', null],
    ['a string', 'entry'],
  ])('drops an entry with %s, keeps the valid ones, reports invalid-entries', async (_l, bad) => {
    const { repository, captureError } = setup(envelopeOf([ANIME, bad, MANGA]));

    await expect(repository.list()).resolves.toStrictEqual([MANGA, ANIME]);
    expect(reasonsOf(captureError)).toStrictEqual(['invalid-entries']);
  });

  it('normalizes the timestamps of stored entries', async () => {
    const raw = { ...ANIME, updatedAt: '2026-02-10T22:30:00.123456+02:00' };
    const { repository, captureError } = setup(envelopeOf([raw]));

    await expect(repository.list()).resolves.toStrictEqual([
      { ...ANIME, updatedAt: '2026-02-10T20:30:00.123Z' },
    ]);
    expect(captureError).not.toHaveBeenCalled();
  });

  describe('of entries with the same key', () => {
    it('keeps the most recent and reports duplicate-keys', async () => {
      const recent = entryOf({ notes: 'recent', updatedAt: '2026-04-01T00:00:00.000Z' });
      const { repository, captureError } = setup(envelopeOf([ANIME, recent, MANGA]));

      await expect(repository.list()).resolves.toStrictEqual([recent, MANGA]);
      expect(reasonsOf(captureError)).toStrictEqual(['duplicate-keys']);
    });

    it('compares their normalized timestamps', async () => {
      // 23:00+02:00 is 21:00 utc, earlier than 22:00 utc although the raw string is greater
      const older = entryOf({ notes: 'older', updatedAt: '2026-04-01T23:00:00+02:00' });
      const newer = entryOf({ notes: 'newer', updatedAt: '2026-04-01T22:00:00Z' });
      const { repository } = setup(envelopeOf([newer, older]));

      const listed = await repository.list();

      expect(listed.map((entry) => entry.notes)).toStrictEqual(['newer']);
    });

    it('keeps the first stored on a tie', async () => {
      const first = entryOf({ notes: 'first' });
      const second = entryOf({ notes: 'second' });
      const { repository, captureError } = setup(envelopeOf([first, second]));

      await expect(repository.get(ENTRY_KEY)).resolves.toStrictEqual(first);
      expect(reasonsOf(captureError)).toStrictEqual(['duplicate-keys']);
    });
  });

  describe('reporting', () => {
    it('reports each reason once per repository', async () => {
      const { repository, captureError } = setup(envelopeOf([ANIME, INVALID_ENTRY, ANIME]));

      await repository.list();
      await repository.get(ENTRY_KEY);
      await repository.list();

      expect(reasonsOf(captureError).sort()).toStrictEqual(['duplicate-keys', 'invalid-entries']);
    });

    it('reports again from a new repository over the same storage', async () => {
      const { storage, repository, captureError } = setup('{not json');
      await repository.list();
      const { reporter, captureError: nextCapture } = createRecordingReporter();

      await createLocalLibraryRepository(storage, { reporter }).list();

      expect(reasonsOf(captureError)).toStrictEqual(['invalid-json']);
      expect(reasonsOf(nextCapture)).toStrictEqual(['invalid-json']);
    });

    it('reports a new reason met after an earlier one', async () => {
      const { storage, repository, captureError } = setup('{not json');
      await repository.list();
      storage.values.set(GUEST_LIBRARY_STORAGE_KEY, 'null');

      await repository.list();
      await repository.list();

      expect(reasonsOf(captureError)).toStrictEqual(['invalid-json', 'invalid-envelope']);
    });

    it.each<[LibraryStorageReason, string]>([
      ['invalid-json', `{"notes":"${NOTES_TEXT}"`],
      ['invalid-envelope', JSON.stringify({ version: 2, entries: [ANIME] })],
      ['invalid-entries', envelopeOf([INVALID_ENTRY])],
      ['duplicate-keys', envelopeOf([ANIME, ANIME])],
    ])('reports %s with its reason only, never a title, notes or key', async (reason, stored) => {
      const { repository, captureError } = setup(stored);

      await repository.list();

      expect(captureError).toHaveBeenCalledTimes(1);
      const [error, context] = captureError.mock.calls[0] ?? [];
      expect(error).toBeInstanceOf(LibraryStorageError);
      expect(error).toMatchObject({ name: 'LibraryStorageError', reason });
      expect(context).toStrictEqual({ source: 'library-storage', tags: { reason } });
      const reported = `${String(error)} ${JSON.stringify(error)} ${JSON.stringify(context)}`;
      for (const text of [TITLE_TEXT, NOTES_TEXT, String(ENTRY_KEY.externalId), 'anime']) {
        expect(reported).not.toContain(text);
      }
      expect(error).not.toHaveProperty('cause');
    });

    it('reports nothing for a missing or a valid document', async () => {
      const empty = createRecordingReporter();
      await createLocalLibraryRepository(createMemoryStorage(), empty).list();
      const valid = setup(envelopeOf([ANIME, MANGA]));
      await valid.repository.list();

      expect(empty.captureError).not.toHaveBeenCalled();
      expect(valid.captureError).not.toHaveBeenCalled();
    });
  });

  describe('the next write', () => {
    it('replaces an unreadable document with the saved entry', async () => {
      const { storage, repository } = setup('{not json');

      const stored = await repository.save(MANGA);

      expect(JSON.parse(storage.values.get(GUEST_LIBRARY_STORAGE_KEY) ?? '')).toStrictEqual({
        version: 1,
        entries: [stored],
      });
    });

    it('keeps the readable entries, drops the rest and the duplicates', async () => {
      const older = entryOf({ notes: 'older', updatedAt: '2026-01-31T00:00:00.000Z' });
      const { storage, repository } = setup(envelopeOf([ANIME, INVALID_ENTRY, older]));

      const stored = await repository.save(MANGA);

      const expected: LibraryEntry[] = [stored, ANIME];
      expect(JSON.parse(storage.values.get(GUEST_LIBRARY_STORAGE_KEY) ?? '')).toStrictEqual({
        version: 1,
        entries: expected,
      });
    });

    it('rewrites the document when removing a stored key', async () => {
      const { storage, repository } = setup(envelopeOf([ANIME, INVALID_ENTRY, MANGA]));

      await repository.remove(ENTRY_KEY);

      expect(storage.values.get(GUEST_LIBRARY_STORAGE_KEY)).toBe(envelopeOf([MANGA]));
    });
  });

  it('never writes to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method),
    );
    const { repository } = setup(envelopeOf([ANIME, INVALID_ENTRY, ANIME]));

    await repository.list();
    await repository.save(MANGA);
    await repository.remove(ENTRY_KEY);
    await repository.clear();

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

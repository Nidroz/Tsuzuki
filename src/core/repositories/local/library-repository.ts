// the guest library (FR-20) on the device (docs/ARCHITECTURE.md §4 "Guest store"), over the
// synchronous StorageAdapter. no in-memory cache: each call reads, changes and writes the stored
// document synchronously inside the call, so calls never interleave and apply in call order.
// personal data (notes, titles): never logged, never put in an error or a report tag
import type { LibraryEntry } from '../../domain/library-entry';
import type { ErrorReporter } from '../../errors/error-reporter';
import { LibraryStorageError, type LibraryStorageReason } from '../../errors/library-errors';
import { libraryEntrySchema } from '../../schemas/library-entry';
import type { GuestLibraryRepository } from '../library-repository';
import type { StorageAdapter } from '../storage-adapter';
import {
  isSameMediaKey,
  readGuestLibrary,
  serializeGuestLibrary,
  sortLibraryEntries,
} from './library-store';

/** storage key of the guest library, a json envelope `{ "version": 1, "entries": [...] }`. */
export const GUEST_LIBRARY_STORAGE_KEY = 'guest-library';

/** the source of the reports of a damaged guest store. */
const REPORT_SOURCE = 'library-storage';

export interface LocalLibraryRepositoryOptions {
  /** receives a LibraryStorageError when the stored document is damaged, once per reason. */
  readonly reporter: ErrorReporter;
}

// runs `work` synchronously inside the call and settles with its result: a throw (a storage
// failure, an invalid entry) rejects the promise instead of escaping the call
const settle = <T>(work: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(work());
  });

/**
 * the guest library stored under GUEST_LIBRARY_STORAGE_KEY. reads are untrusted: a damaged
 * document reads as what could be parsed (see readGuestLibrary), each kind of problem reported
 * through `reporter` at most once per repository, never thrown; the next write replaces the
 * document with the entries read plus the change. `save` validates with libraryEntrySchema first
 * (a RangeError without values, nothing written) and keeps the stored `createdAt` when replacing;
 * `remove` of a missing key writes nothing; `clear` deletes the key. a storage failure rejects.
 */
export const createLocalLibraryRepository = (
  storage: StorageAdapter,
  { reporter }: LocalLibraryRepositoryOptions,
): GuestLibraryRepository => {
  const reported = new Set<LibraryStorageReason>();

  const report = (reason: LibraryStorageReason): void => {
    if (reported.has(reason)) {
      return;
    }
    reported.add(reason);
    reporter.captureError(new LibraryStorageError(reason), {
      source: REPORT_SOURCE,
      tags: { reason },
    });
  };

  const read = (): readonly LibraryEntry[] => {
    const { entries, problems } = readGuestLibrary(storage.getString(GUEST_LIBRARY_STORAGE_KEY));
    for (const reason of problems) {
      report(reason);
    }
    return entries;
  };

  const write = (entries: readonly LibraryEntry[]): void => {
    storage.set(GUEST_LIBRARY_STORAGE_KEY, serializeGuestLibrary(sortLibraryEntries(entries)));
  };

  return {
    list: () => settle(read),

    get: (key) => settle(() => read().find((entry) => isSameMediaKey(entry.key, key)) ?? null),

    save: (entry) =>
      settle(() => {
        const parsed = libraryEntrySchema.safeParse(entry);
        if (!parsed.success) {
          // the message holds no value: the ui validates user input first, this is a bug
          throw new RangeError('library entry is outside the database limits');
        }
        const entries = read();
        const existing = entries.find((other) => isSameMediaKey(other.key, parsed.data.key));
        const stored =
          existing === undefined ? parsed.data : { ...parsed.data, createdAt: existing.createdAt };
        write([...entries.filter((other) => other !== existing), stored]);
        return stored;
      }),

    remove: (key) =>
      settle(() => {
        const entries = read();
        const remaining = entries.filter((entry) => !isSameMediaKey(entry.key, key));
        if (remaining.length !== entries.length) {
          write(remaining);
        }
      }),

    clear: () =>
      settle(() => {
        storage.delete(GUEST_LIBRARY_STORAGE_KEY);
      }),
  };
};

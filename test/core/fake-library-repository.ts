// in-memory test doubles of the library repositories (src/core/repositories/), for tests of the
// library writer, the hooks and the guest merge: calls can be held or failed one by one to
// control their order
import { jest } from '@jest/globals';

import { guestMergeDecision, isSameLibraryEntry } from '@core/domain/guest-merge';
import type { LibraryEntry } from '@core/domain/library-entry';
import type { MediaKey } from '@core/domain/media';
import type {
  AccountLibraryRepository,
  GuestLibraryRepository,
  LibraryRepository,
} from '@core/repositories/library-repository';
import { libraryEntrySchema } from '@core/schemas/library-entry';

/** a promise settled from the outside */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

export const createDeferred = <T = void>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

/** every method of the library repositories, as `beforeCall` receives it */
export type LibraryMethod = keyof AccountLibraryRepository | keyof GuestLibraryRepository;

const idOf = (key: MediaKey): string => `${key.namespace}:${key.kind}:${String(key.externalId)}`;

// the map of a fake, its `save` storage and its LibraryRepository methods
const createInMemoryLibrary = (initial: readonly LibraryEntry[]) => {
  const entries = new Map(initial.map((entry) => [idOf(entry.key), entry]));
  const beforeCall = jest.fn<(method: LibraryMethod) => Promise<void>>(() => Promise.resolve());
  // stores a copy keeping the stored createdAt, as the real implementations do
  const store = (entry: LibraryEntry): LibraryEntry => {
    const existing = entries.get(idOf(entry.key));
    const stored = { ...entry, createdAt: existing?.createdAt ?? entry.createdAt };
    entries.set(idOf(entry.key), stored);
    return stored;
  };
  const repository = {
    beforeCall,
    list: jest.fn<LibraryRepository['list']>(async () => {
      await beforeCall('list');
      return [...entries.values()];
    }),
    get: jest.fn<LibraryRepository['get']>(async (key) => {
      await beforeCall('get');
      return entries.get(idOf(key)) ?? null;
    }),
    save: jest.fn<LibraryRepository['save']>(async (entry) => {
      await beforeCall('save');
      return store(entry);
    }),
    remove: jest.fn<LibraryRepository['remove']>(async (key) => {
      await beforeCall('remove');
      entries.delete(idOf(key));
    }),
    stored: (key: MediaKey): LibraryEntry | null => entries.get(idOf(key)) ?? null,
  } satisfies LibraryRepository & {
    readonly beforeCall: typeof beforeCall;
    readonly stored: (key: MediaKey) => LibraryEntry | null;
  };
  return { entries, store, repository };
};

/**
 * a repository over an in-memory map, seeded with `initial`. every call first awaits
 * `beforeCall(method)`, a jest mock resolving at once by default: a test holds one call with
 * `beforeCall.mockReturnValueOnce(deferred.promise)` or fails it with
 * `beforeCall.mockRejectedValueOnce(error)`, and nothing changes in the map then. `save` stores a
 * copy keeping the stored `createdAt`, as the real implementations do, and resolves to it.
 * `stored(key)` reads the map without a call
 */
export const createFakeLibraryRepository = (initial: readonly LibraryEntry[] = []) =>
  createInMemoryLibrary(initial).repository;

export type FakeLibraryRepository = ReturnType<typeof createFakeLibraryRepository>;

// the merge input checks of the account store: each entry within libraryEntrySchema, each key once
const parseGuestEntries = (entries: readonly LibraryEntry[]): LibraryEntry[] => {
  const ids = new Set<string>();
  return entries.map((entry) => {
    const parsed = libraryEntrySchema.safeParse(entry);
    if (!parsed.success || ids.has(idOf(parsed.data.key))) {
      throw new RangeError('invalid guest entries');
    }
    ids.add(idOf(parsed.data.key));
    return parsed.data;
  });
};

/**
 * the fake repository plus `mergeGuestEntries`: after `beforeCall('mergeGuestEntries')`, it
 * rejects an entry outside libraryEntrySchema or two entries of one key with a RangeError, writing
 * nothing, then applies guestMergeDecision to each entry, storing the inserted and replaced ones
 * as `save` does (with their own timestamps, where the account store takes the server's)
 */
export const createFakeAccountLibraryRepository = (initial: readonly LibraryEntry[] = []) => {
  const { entries, store, repository } = createInMemoryLibrary(initial);
  return {
    ...repository,
    mergeGuestEntries: jest.fn<AccountLibraryRepository['mergeGuestEntries']>(async (guest) => {
      await repository.beforeCall('mergeGuestEntries');
      for (const entry of parseGuestEntries(guest)) {
        const account = entries.get(idOf(entry.key));
        if (guestMergeDecision(entry.updatedAt, account?.updatedAt ?? null) !== 'keep') {
          store(entry);
        }
      }
    }),
  } satisfies AccountLibraryRepository;
};

export type FakeAccountLibraryRepository = ReturnType<typeof createFakeAccountLibraryRepository>;

/**
 * the fake repository plus the guest-only removals, each after `beforeCall(method)`:
 * `removeUnchanged` removes the stored entries equal field by field to one of the given ones
 * (isSameLibraryEntry), `clear` removes every entry
 */
export const createFakeGuestLibraryRepository = (initial: readonly LibraryEntry[] = []) => {
  const { entries, repository } = createInMemoryLibrary(initial);
  return {
    ...repository,
    removeUnchanged: jest.fn<GuestLibraryRepository['removeUnchanged']>(async (merged) => {
      await repository.beforeCall('removeUnchanged');
      for (const [id, entry] of entries) {
        if (merged.some((other) => isSameLibraryEntry(entry, other))) {
          entries.delete(id);
        }
      }
    }),
    clear: jest.fn<GuestLibraryRepository['clear']>(async () => {
      await repository.beforeCall('clear');
      entries.clear();
    }),
  } satisfies GuestLibraryRepository;
};

export type FakeGuestLibraryRepository = ReturnType<typeof createFakeGuestLibraryRepository>;

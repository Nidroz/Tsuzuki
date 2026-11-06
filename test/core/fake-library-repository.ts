// in-memory test doubles of the library repositories (src/core/repositories/), for tests of the
// library writer, the hooks, the guest merge and the replay: calls can be held or failed one by
// one to control their order
import { jest } from '@jest/globals';

import { guestMergeDecision, isSameLibraryEntry } from '@core/domain/guest-merge';
import type { LibraryEntry } from '@core/domain/library-entry';
import {
  LIBRARY_REPLAY_BATCH_SIZE,
  libraryQueuedWriteKey,
  replayRemovalOutcome,
  type LibraryQueuedWrite,
  type LibraryReplayOutcome,
} from '@core/domain/library-sync';
import type { MediaKey } from '@core/domain/media';
import type {
  AccountLibraryRepository,
  GuestLibraryRepository,
  LibraryRepository,
  RemoteAccountLibraryRepository,
} from '@core/repositories/library-repository';
import type { OfflineAccountLibraryRepository } from '@core/repositories/offline-account-library-repository';
import { libraryEntrySchema, mediaKeySchema } from '@core/schemas/library-entry';
import { timestampSchema } from '@core/schemas/timestamp';

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
export type LibraryMethod = keyof RemoteAccountLibraryRepository | keyof GuestLibraryRepository;

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

// the time a merge at `mergedAt` keeps for an entry changed at `updatedAt`: its own, capped at the
// merge time (both in the Date#toISOString form)
const cappedAt = (updatedAt: string, mergedAt: string): string =>
  updatedAt < mergedAt ? updatedAt : mergedAt;

// a queued write as the account store takes it: within the database limits, times normalized
const parseQueuedWrite = (write: LibraryQueuedWrite): LibraryQueuedWrite | null => {
  if (write.type === 'save') {
    const entry = libraryEntrySchema.safeParse(write.entry);
    return entry.success ? { type: 'save', entry: entry.data } : null;
  }
  const key = mediaKeySchema.safeParse(write.key);
  const removedAt = timestampSchema.safeParse(write.removedAt);
  return key.success && removedAt.success
    ? { type: 'remove', key: key.data, removedAt: removedAt.data }
    : null;
};

// the replay input checks of the account store: at most LIBRARY_REPLAY_BATCH_SIZE writes, each
// within the limits, each key once; else a RangeError holding no value
const parseQueuedWrites = (writes: readonly LibraryQueuedWrite[]): LibraryQueuedWrite[] => {
  if (writes.length > LIBRARY_REPLAY_BATCH_SIZE) {
    throw new RangeError('too many queued writes');
  }
  const ids = new Set<string>();
  return writes.map((write) => {
    const parsed = parseQueuedWrite(write);
    if (parsed === null || ids.has(idOf(libraryQueuedWriteKey(parsed)))) {
      throw new RangeError('invalid queued writes');
    }
    ids.add(idOf(libraryQueuedWriteKey(parsed)));
    return parsed;
  });
};

/**
 * the fake repository plus `mergeGuestEntries`: after `beforeCall('mergeGuestEntries')`, it
 * rejects an entry outside libraryEntrySchema or two entries of one key with a RangeError, writing
 * nothing, then applies guestMergeDecision to each entry's own `updatedAt` capped at the time of
 * the merge (the current clock, `new Date()`: fake timers apply), as the database does. what it
 * writes keeps that capped time as `updatedAt`; an inserted entry takes the merge time as
 * `createdAt`, a replaced one keeps its stored `createdAt`.
 *
 * `replayWrites`, after `beforeCall('replayWrites')`, rejects more than LIBRARY_REPLAY_BATCH_SIZE
 * writes, a write outside the limits or two writes of one key with a RangeError, writing nothing,
 * then applies each write in input order at the time of the call (the current clock): a save as a
 * merge entry (guestMergeDecision), a removal through replayRemovalOutcome, deleting the stored
 * entry only when strictly older than `removedAt` capped at that time. it resolves `written` or `kept` per write, in input order, as the database
 * does
 */
export const createFakeAccountLibraryRepository = (initial: readonly LibraryEntry[] = []) => {
  const { entries, store, repository } = createInMemoryLibrary(initial);
  // one merge entry at `writtenAt` (BR-08): true when written, false when the stored copy is kept
  const writeAt = (entry: LibraryEntry, writtenAt: string): boolean => {
    const updatedAt = cappedAt(entry.updatedAt, writtenAt);
    const account = entries.get(idOf(entry.key));
    const decision = guestMergeDecision(updatedAt, account?.updatedAt ?? null);
    if (decision === 'insert') {
      store({ ...entry, createdAt: writtenAt, updatedAt });
    } else if (decision === 'replace') {
      // store keeps the stored createdAt
      store({ ...entry, updatedAt });
    }
    return decision !== 'keep';
  };
  return {
    ...repository,
    mergeGuestEntries: jest.fn<AccountLibraryRepository['mergeGuestEntries']>(async (guest) => {
      await repository.beforeCall('mergeGuestEntries');
      const parsed = parseGuestEntries(guest);
      const mergedAt = new Date().toISOString();
      for (const entry of parsed) {
        writeAt(entry, mergedAt);
      }
    }),
    replayWrites: jest.fn<RemoteAccountLibraryRepository['replayWrites']>(async (writes) => {
      await repository.beforeCall('replayWrites');
      const parsed = parseQueuedWrites(writes);
      const replayedAt = new Date().toISOString();
      return parsed.map((write): LibraryReplayOutcome => {
        if (write.type === 'save') {
          return writeAt(write.entry, replayedAt) ? 'written' : 'kept';
        }
        const id = idOf(write.key);
        const outcome = replayRemovalOutcome(
          cappedAt(write.removedAt, replayedAt),
          entries.get(id)?.updatedAt ?? null,
        );
        if (outcome === 'written') {
          entries.delete(id);
        }
        return outcome;
      });
    }),
  } satisfies RemoteAccountLibraryRepository;
};

/**
 * `entry` as the account holds it once a merge at `mergedAt` wrote it (the fake above, as the
 * database): its own `updatedAt` capped at the merge time; inserted, the merge time as
 * `createdAt`; replacing `replaced`, the `createdAt` of `replaced`
 */
export const mergedCopyOf = (
  entry: LibraryEntry,
  mergedAt: string,
  replaced: LibraryEntry | null = null,
): LibraryEntry => ({
  ...entry,
  createdAt: replaced?.createdAt ?? mergedAt,
  updatedAt: cappedAt(entry.updatedAt, mergedAt),
});

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

/**
 * the stuck write members of an offline account library fake, as jest mocks: no stuck write, a
 * subscription never called, a retry that found nothing to send, a discard that removed nothing
 */
export const createStuckWriteMocks = () => ({
  stuckWriteCount: jest.fn<OfflineAccountLibraryRepository['stuckWriteCount']>(() => 0),
  subscribeToSyncState: jest.fn<OfflineAccountLibraryRepository['subscribeToSyncState']>(
    () => () => undefined,
  ),
  retryStuckWrites: jest.fn<OfflineAccountLibraryRepository['retryStuckWrites']>(() =>
    Promise.resolve({ status: 'done', confirmed: 0 }),
  ),
  discardStuckWrites: jest.fn<OfflineAccountLibraryRepository['discardStuckWrites']>(() => 0),
});

/**
 * holds the next call of `method` on a fake repository until the returned deferred settles: it
 * then goes on, or rejects with the deferred's error and changes nothing. the other calls, and the
 * later calls of `method`, go on at once
 */
export const holdNextCall = (
  repository: { readonly beforeCall: FakeLibraryRepository['beforeCall'] },
  method: LibraryMethod,
): Deferred<void> => {
  const held = createDeferred();
  let holding = true;
  repository.beforeCall.mockImplementation((called) => {
    if (holding && called === method) {
      holding = false;
      return held.promise;
    }
    return Promise.resolve();
  });
  return held;
};

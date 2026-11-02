// an in-memory account store (RemoteAccountLibraryRepository) for the offline account library
// tests: the server rows of one user, the server time from the (fake) clock, the BR-08 replay rule
// of the domain, and calls that can be held or failed one by one
import { jest } from '@jest/globals';

import { guestMergeDecision } from '../../../domain/guest-merge';
import type { LibraryEntry } from '../../../domain/library-entry';
import {
  libraryQueuedWriteKey,
  replayRemovalOutcome,
  type LibraryQueuedWrite,
  type LibraryReplayOutcome,
} from '../../../domain/library-sync';
import { compareLibraryEntries, libraryEntryId } from '../../../domain/library-view';
import type { MediaKey } from '../../../domain/media';
import { LibraryRemoteError, type LibraryRemoteReason } from '../../../errors/library-errors';
import type { RemoteAccountLibraryRepository } from '../../library-repository';
import { createOfflineAccountLibraries } from '../account-libraries';
import { createMemoryStorage, createRecordingReporter, type MemoryStorage } from './memory-storage';

export const USER_A = '00000000-0000-4000-8000-00000000000a';
export const USER_B = '00000000-0000-4000-8000-00000000000b';

export type RemoteMethod = 'list' | 'get' | 'save' | 'remove' | 'replayWrites';

/** a promise settled from the outside */
export interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

export const createGate = (): Gate => {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

// a step run before a call: a failure to throw, or a gate to wait for
type Step = { readonly fail: unknown } | { readonly gate: Gate };

const serverNow = (): string => new Date().toISOString();

// a client time capped at the server time, as the database function does
const capped = (time: string): string => {
  const now = serverNow();
  return time < now ? time : now;
};

export const createInMemoryRemote = () => {
  const rows = new Map<string, LibraryEntry>();
  const steps = new Map<RemoteMethod, Step[]>();
  const replayed: LibraryQueuedWrite[][] = [];
  const calls: RemoteMethod[] = [];
  // keys whose writes the database refuses: a batch holding one is rejected whole
  const refusedKeys = new Set<string>();
  // replay calls applied by the server whose answer never reaches the device
  const lostAnswers = { count: 0 };
  const mergeGuestEntries = jest.fn<RemoteAccountLibraryRepository['mergeGuestEntries']>(() =>
    Promise.resolve(),
  );

  const before = async (method: RemoteMethod): Promise<void> => {
    calls.push(method);
    const step = steps.get(method)?.shift();
    if (step === undefined) {
      return;
    }
    if ('gate' in step) {
      await step.gate.promise;
      return;
    }
    throw step.fail;
  };

  const push = (method: RemoteMethod, step: Step): void => {
    steps.set(method, [...(steps.get(method) ?? []), step]);
  };

  const applyReplay = (write: LibraryQueuedWrite): LibraryReplayOutcome => {
    const id = libraryEntryId(libraryQueuedWriteKey(write));
    const stored = rows.get(id);
    if (write.type === 'remove') {
      const outcome = replayRemovalOutcome(capped(write.removedAt), stored?.updatedAt ?? null);
      if (outcome === 'written') {
        rows.delete(id);
      }
      return outcome;
    }
    const time = capped(write.entry.updatedAt);
    const decision = guestMergeDecision(time, stored?.updatedAt ?? null);
    if (decision === 'keep') {
      return 'kept';
    }
    rows.set(id, {
      ...write.entry,
      createdAt: stored?.createdAt ?? serverNow(),
      updatedAt: time,
    });
    return 'written';
  };

  const repository: RemoteAccountLibraryRepository = {
    // reads see the rows as they stand when called: a held read answers a state written over since
    list: async () => {
      const snapshot = [...rows.values()].sort(compareLibraryEntries('updated'));
      await before('list');
      return snapshot;
    },
    get: async (key: MediaKey) => {
      const snapshot = rows.get(libraryEntryId(key)) ?? null;
      await before('get');
      return snapshot;
    },
    save: async (entry) => {
      await before('save');
      const id = libraryEntryId(entry.key);
      const stored = {
        ...entry,
        createdAt: rows.get(id)?.createdAt ?? serverNow(),
        updatedAt: serverNow(),
      };
      rows.set(id, stored);
      return stored;
    },
    remove: async (key) => {
      await before('remove');
      rows.delete(libraryEntryId(key));
    },
    mergeGuestEntries,
    replayWrites: async (writes) => {
      replayed.push([...writes]);
      await before('replayWrites');
      if (writes.some((write) => refusedKeys.has(libraryEntryId(libraryQueuedWriteKey(write))))) {
        throw new LibraryRemoteError('rejected');
      }
      const outcomes = writes.map(applyReplay);
      if (lostAnswers.count > 0) {
        lostAnswers.count -= 1;
        throw new LibraryRemoteError('network');
      }
      return outcomes;
    },
  };

  return {
    repository,
    rows,
    replayed,
    calls,
    mergeGuestEntries,
    /** the next call of `method` rejects with a LibraryRemoteError of `reason` (or `error`). */
    failNext: (method: RemoteMethod, failure: LibraryRemoteReason | Error): void => {
      push(method, {
        fail: typeof failure === 'string' ? new LibraryRemoteError(failure) : failure,
      });
    },
    /** the next call of `method` waits for the returned gate. */
    holdNext: (method: RemoteMethod): Gate => {
      const gate = createGate();
      push(method, { gate });
      return gate;
    },
    /** the next replay call is applied, then fails with network (its answer is lost). */
    loseNextReplayAnswer: (): void => {
      lostAnswers.count += 1;
    },
    /** every replay call holding a write of `key` is rejected whole. */
    refuseKey: (key: MediaKey): void => {
      refusedKeys.add(libraryEntryId(key));
    },
    seed: (...entries: readonly LibraryEntry[]): void => {
      for (const entry of entries) {
        rows.set(libraryEntryId(entry.key), entry);
      }
    },
  };
};

export type InMemoryRemote = ReturnType<typeof createInMemoryRemote>;

export interface OfflineSetupOptions {
  readonly storage?: MemoryStorage;
  readonly remotes?: Map<string, InMemoryRemote>;
  /** the device clock; the factory default (the jest clock) when absent. */
  readonly now?: () => Date;
}

/**
 * a factory of offline account libraries over an in-memory storage, one in-memory remote per user
 * and a switchable connectivity (online at first).
 */
export const setupOfflineLibraries = (options: OfflineSetupOptions = {}) => {
  const storage = options.storage ?? createMemoryStorage();
  const remotes = options.remotes ?? new Map<string, InMemoryRemote>();
  const recording = createRecordingReporter();
  const connectivity = { online: true };
  const remoteOf = (userId: string): InMemoryRemote => {
    const existing = remotes.get(userId);
    if (existing !== undefined) {
      return existing;
    }
    const created = createInMemoryRemote();
    remotes.set(userId, created);
    return created;
  };
  const libraryFor = createOfflineAccountLibraries({
    storage,
    remoteFor: (userId) => remoteOf(userId).repository,
    isOnline: () => connectivity.online,
    reporter: recording.reporter,
    ...(options.now !== undefined && { now: options.now }),
  });
  return {
    storage,
    remotes,
    remoteOf,
    libraryFor,
    connectivity,
    captureError: recording.captureError,
  };
};

/** lets every settled promise run its callbacks. */
export const flush = async (): Promise<void> => {
  await jest.advanceTimersByTimeAsync(0);
};

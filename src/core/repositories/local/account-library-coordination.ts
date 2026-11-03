// what every offline account library instance of one user shares (ADR-0017), owned by the factory
// (account-libraries.ts), never a module global: the documents, the keys with a direct attempt in
// flight or being sent by the replay run, the run in flight, the writes refused in this process,
// the queue listeners, and the states confirmed while a read was in flight. the purge of the
// device data closes it for good (ADR-0018). entries hold personal data: never logged
import type { LibraryEntry } from '../../domain/library-entry';
import { libraryQueuedWriteKey } from '../../domain/library-sync';
import { libraryEntryId } from '../../domain/library-view';
import type { MediaKey } from '../../domain/media';
import { LibraryRemoteError } from '../../errors/library-errors';
import type { LibraryReplayRun } from '../library-repository';
import type { QueuedWriteRecord } from './account-library-documents';
import type { AccountLibraryStore } from './account-library-store';

/** the replay run in flight for a user: joined by every call, unless it was aborted. */
export interface ReplayRunState {
  readonly promise: Promise<LibraryReplayRun>;
  aborted: boolean;
}

// a state confirmed by the server for a key, and when (in the coordination's ticks)
interface ConfirmedState {
  readonly tick: number;
  readonly entry: LibraryEntry | null;
}

export interface UserCoordination {
  /** the user's documents; once the coordination is closed, every call throws `signed-out`. */
  readonly store: AccountLibraryStore;
  /** aborted by closeCoordination only, when the purge closes the coordination for good. */
  readonly closer: AbortController;
  /** the keys (libraryEntryId) with a direct save or remove in flight, and how many. */
  readonly directKeys: Map<string, number>;
  /** the keys of the replay batch in flight. */
  readonly sendingKeys: Set<string>;
  /** the writes the server refused alone in this process: key to seq, until a newer write. */
  readonly refused: Map<string, number>;
  readonly listeners: Set<() => void>;
  run: ReplayRunState | null;
  activeReads: number;
  tick: number;
  readonly confirmed: Map<string, ConfirmedState>;
}

// `store` behind the closing: once `closed` aborts, every call throws `signed-out` before it reads
// or writes a document, so no instance of a purged coordination touches them again
const guardStore = (store: AccountLibraryStore, closed: AbortSignal): AccountLibraryStore => {
  const open = <R>(operation: () => R): R => {
    if (closed.aborted) {
      throw new LibraryRemoteError('signed-out');
    }
    return operation();
  };
  return {
    readCopy: () => open(() => store.readCopy()),
    writeCopy: (entries) => {
      open(() => {
        store.writeCopy(entries);
      });
    },
    updateCopy: (key, entry) => {
      open(() => {
        store.updateCopy(key, entry);
      });
    },
    readRecords: () => open(() => store.readRecords()),
    recordOf: (key) => open(() => store.recordOf(key)),
    enqueue: (write) => open(() => store.enqueue(write)),
    removeConfirmed: (sent) => open(() => store.removeConfirmed(sent)),
  };
};

export const createUserCoordination = (store: AccountLibraryStore): UserCoordination => {
  const closer = new AbortController();
  return {
    store: guardStore(store, closer.signal),
    closer,
    directKeys: new Map(),
    sendingKeys: new Set(),
    refused: new Map(),
    listeners: new Set(),
    run: null,
    activeReads: 0,
    tick: 0,
    confirmed: new Map(),
  };
};

/** whether the purge closed `coordination`. */
export const isClosed = (coordination: UserCoordination): boolean =>
  coordination.closer.signal.aborted;

/**
 * closes `coordination` for good (the device purge, ADR-0018): its store refuses every call, its
 * listeners are dropped, and what it tracked is forgotten; a run or a call in flight ends at its
 * next step. false when it was already closed.
 */
export const closeCoordination = (coordination: UserCoordination): boolean => {
  if (isClosed(coordination)) {
    return false;
  }
  coordination.closer.abort();
  coordination.listeners.clear();
  coordination.directKeys.clear();
  coordination.sendingKeys.clear();
  coordination.refused.clear();
  coordination.confirmed.clear();
  return true;
};

/** the key id of a queued write. */
export const recordId = (record: QueuedWriteRecord): string =>
  libraryEntryId(libraryQueuedWriteKey(record.write));

/** a mark of the confirmations made before a read started; end it with endRead. */
export const beginRead = (coordination: UserCoordination): number => {
  coordination.activeReads += 1;
  return coordination.tick;
};

/**
 * ends a read begun at `mark`: the states confirmed since then, by key id (null: absent), which
 * win over what the read returned. the log is dropped once no read is in flight.
 */
export const endRead = (
  coordination: UserCoordination,
  mark: number,
): ReadonlyMap<string, LibraryEntry | null> => {
  const since = new Map<string, LibraryEntry | null>();
  for (const [id, state] of coordination.confirmed) {
    if (state.tick > mark) {
      since.set(id, state.entry);
    }
  }
  coordination.activeReads -= 1;
  if (coordination.activeReads === 0) {
    coordination.confirmed.clear();
  }
  return since;
};

/**
 * the server confirmed the state of `key` (its stored entry, or null: absent): an existing copy
 * takes it, and a read in flight keeps it over what it reads.
 */
export const confirmState = (
  coordination: UserCoordination,
  key: MediaKey,
  entry: LibraryEntry | null,
): void => {
  coordination.store.updateCopy(key, entry);
  coordination.tick += 1;
  if (coordination.activeReads > 0) {
    coordination.confirmed.set(libraryEntryId(key), { tick: coordination.tick, entry });
  }
};

/** tells every listener of this user that a write stays queued. */
export const notifyQueued = (coordination: UserCoordination): void => {
  for (const listener of [...coordination.listeners]) {
    listener();
  }
};

/** adds (1) or removes (-1) a direct attempt of the key `id`. */
export const countDirectAttempt = (
  coordination: UserCoordination,
  id: string,
  change: 1 | -1,
): void => {
  const count = (coordination.directKeys.get(id) ?? 0) + change;
  if (count > 0) {
    coordination.directKeys.set(id, count);
  } else {
    coordination.directKeys.delete(id);
  }
};

/**
 * whether the replay may send `record`: no direct attempt of its key in flight, and not refused
 * alone in this process (a newer write of the key, under another seq, is replayable again).
 */
export const isReplayable = (
  coordination: UserCoordination,
  record: QueuedWriteRecord,
): boolean => {
  const id = recordId(record);
  return !coordination.directKeys.has(id) && coordination.refused.get(id) !== record.seq;
};

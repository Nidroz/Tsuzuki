// what every offline account library instance of one user shares (ADR-0017), owned by the factory
// (account-libraries.ts), never a module global: the documents, the keys with a direct attempt in
// flight or being sent by the replay run, the run in flight, the writes refused in this process,
// the queue listeners, and the states confirmed while a read was in flight. entries hold personal
// data: never logged
import type { LibraryEntry } from '../../domain/library-entry';
import { libraryQueuedWriteKey } from '../../domain/library-sync';
import { libraryEntryId } from '../../domain/library-view';
import type { MediaKey } from '../../domain/media';
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
  readonly store: AccountLibraryStore;
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

export const createUserCoordination = (store: AccountLibraryStore): UserCoordination => ({
  store,
  directKeys: new Map(),
  sendingKeys: new Set(),
  refused: new Map(),
  listeners: new Set(),
  run: null,
  activeReads: 0,
  tick: 0,
  confirmed: new Map(),
});

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

// the factory of the offline account libraries (A-05, ADR-0017), wired only by the composition
// root: a new instance per signed-in user and call, over that user's account store, device copy
// and write queue. what the instances of one user share (the run in flight, the keys in flight,
// the refused writes a retry released, the listeners) lives in the factory, never in a module
// global, until the device purge closes it and deletes the documents (ADR-0018)
import type { ErrorReporter } from '../../errors/error-reporter';
import { LibraryStorageError, type LibraryStorageReason } from '../../errors/library-errors';
import type {
  OfflineAccountLibraryRepository,
  RemoteAccountLibraryRepository,
} from '../library-repository';
import type { StorageAdapter } from '../storage-adapter';
import { createOfflineAccountLibrary } from './account-library';
import {
  closeCoordination,
  createUserCoordination,
  type UserCoordination,
} from './account-library-coordination';
import {
  accountLibraryStorageKeys,
  type AccountLibraryDocument,
} from './account-library-documents';
import { createAccountLibraryStore, deleteAccountLibraryDocuments } from './account-library-store';

/** the source of the reports of a damaged device copy or write queue. */
const STORAGE_REPORT_SOURCE = 'library-storage';

export interface OfflineAccountLibrariesOptions {
  /** the app storage (MMKV on mobile): the device copy and the queue of each user. */
  readonly storage: StorageAdapter;
  /** the account store of a user (supabase/library-repository.ts). */
  readonly remoteFor: (userId: string) => RemoteAccountLibraryRepository;
  /** whether the device is online now (isDeviceOnline, src/core/query/online-manager.ts). */
  readonly isOnline: () => boolean;
  /** receives damaged documents (once per reason and document) and failed replay runs. */
  readonly reporter: ErrorReporter;
  /** the wall clock that times a removal; default `new Date()`. */
  readonly now?: () => Date;
}

/**
 * `(userId) => OfflineAccountLibraryRepository`: a new instance per call (a session switch needs
 * a new instance per sign in) over `remoteFor(userId)` and the documents of that user id, checked
 * as a uuid first (a RangeError without a value). instances of one user share the documents and
 * the replay run; instances of different users share nothing, so one user's queued writes are
 * never read or sent by another user's instance. `purgeDeviceData` of an instance closes what the
 * instances of its user share, so none of them touches the documents again, and deletes them;
 * the next instance of that user starts afresh.
 */
export const createOfflineAccountLibraries = ({
  storage,
  remoteFor,
  isOnline,
  reporter,
  now = () => new Date(),
}: OfflineAccountLibrariesOptions): ((userId: string) => OfflineAccountLibraryRepository) => {
  const reported = new Set<string>();
  const coordinations = new Map<string, UserCoordination>();

  const report = (reason: LibraryStorageReason, document: AccountLibraryDocument): void => {
    const id = `${document}:${reason}`;
    if (reported.has(id)) {
      return;
    }
    reported.add(id);
    reporter.captureError(new LibraryStorageError(reason), {
      source: STORAGE_REPORT_SOURCE,
      tags: { reason, document },
    });
  };

  const coordinationOf = (userId: string): UserCoordination => {
    const keys = accountLibraryStorageKeys(userId);
    const existing = coordinations.get(userId);
    if (existing !== undefined) {
      return existing;
    }
    const store = createAccountLibraryStore({ storage, keys, seqFloor: { highest: 0 }, report });
    const created = createUserCoordination(store);
    coordinations.set(userId, created);
    return created;
  };

  // closes the coordination of `userId` and deletes its documents; nothing when it was closed
  // before, so a retired instance never deletes the documents of a later one
  const purge = (userId: string, coordination: UserCoordination): void => {
    if (!closeCoordination(coordination)) {
      return;
    }
    // an open coordination is the one the map holds: the next instance gets a new one
    coordinations.delete(userId);
    deleteAccountLibraryDocuments(storage, accountLibraryStorageKeys(userId));
  };

  return (userId) => {
    const coordination = coordinationOf(userId);
    return createOfflineAccountLibrary({
      coordination,
      remote: remoteFor(userId),
      isOnline,
      reporter,
      now,
      purge: () => {
        purge(userId, coordination);
      },
    });
  };
};

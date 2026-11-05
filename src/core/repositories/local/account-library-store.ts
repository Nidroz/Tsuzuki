// the device copy and the write queue of one user (ADR-0017) over the synchronous StorageAdapter,
// and their deletion by the device purge (ADR-0018). no in-memory cache: each operation reads,
// changes and writes its document synchronously inside the call, as the guest store does, so two
// instances of one user never interleave. a damaged document is reported through `report`, never
// thrown; a storage failure throws. entries and writes hold personal data: never logged
import type { LibraryEntry } from '../../domain/library-entry';
import {
  isLibraryWriteStuck,
  libraryQueuedWriteKey,
  type LibraryQueuedWrite,
} from '../../domain/library-sync';
import { libraryEntryId } from '../../domain/library-view';
import type { MediaKey } from '../../domain/media';
import type { LibraryStorageReason } from '../../errors/library-errors';
import type { StorageAdapter } from '../storage-adapter';
import {
  queuedWriteRecord,
  readAccountCopy,
  readAccountQueue,
  serializeAccountCopy,
  serializeAccountQueue,
  type AccountLibraryDocument,
  type AccountLibraryQueue,
  type QueuedWriteRecord,
} from './account-library-documents';

/** the highest seq issued for a user by this factory: a damaged queue restarts above it. */
export interface SeqFloor {
  highest: number;
}

export interface AccountLibraryStoreOptions {
  readonly storage: StorageAdapter;
  readonly keys: { readonly copy: string; readonly queue: string };
  readonly seqFloor: SeqFloor;
  /** receives each problem of a damaged document (the caller reports each once). */
  readonly report: (reason: LibraryStorageReason, document: AccountLibraryDocument) => void;
}

/** the documents of one user, as the offline account library reads and changes them. */
export interface AccountLibraryStore {
  /** the device copy in the list order, or null when this user has none. */
  readCopy(): readonly LibraryEntry[] | null;
  /** replaces the device copy (created when there is none): only a complete list does it. */
  writeCopy(entries: readonly LibraryEntry[]): void;
  /**
   * sets the server state of one key in an existing copy (`null`: absent), never creating one: a
   * copy holding a few keys would answer `null` offline for entries the account holds.
   */
  updateCopy(key: MediaKey, entry: LibraryEntry | null): void;
  /** the queued writes by ascending seq. */
  readRecords(): readonly QueuedWriteRecord[];
  /** the queued write of `key`, if any. */
  recordOf(key: MediaKey): QueuedWriteRecord | undefined;
  /** queues `write` in place of its key's write, under a seq never issued before for this user. */
  enqueue(write: LibraryQueuedWrite): QueuedWriteRecord;
  /**
   * removes each of `sent` whose key still holds that very seq (a newer write of the key stays);
   * returns how many were removed.
   */
  removeConfirmed(sent: readonly QueuedWriteRecord[]): number;
  /**
   * marks `sent` refused (the database refused it alone) when its key still holds that very seq;
   * whether it was marked.
   */
  markRefused(sent: QueuedWriteRecord): boolean;
  /**
   * adds 1 to the failed runs of each of `sent` whose key still holds that very seq; returns how
   * many were counted.
   */
  countFailedRun(sent: readonly QueuedWriteRecord[]): number;
  /** removes every stuck write (isLibraryWriteStuck); returns how many were removed. */
  removeStuck(): number;
}

const idOf = (record: QueuedWriteRecord): string =>
  libraryEntryId(libraryQueuedWriteKey(record.write));

// a record's key and seq: the same write, unless a newer write of its key replaced it
const writeIdOf = (record: QueuedWriteRecord): string => `${idOf(record)}#${String(record.seq)}`;

export const createAccountLibraryStore = ({
  storage,
  keys,
  seqFloor,
  report,
}: AccountLibraryStoreOptions): AccountLibraryStore => {
  const readCopy = (): readonly LibraryEntry[] | null => {
    const { value, problems } = readAccountCopy(storage.getString(keys.copy));
    for (const reason of problems) {
      report(reason, 'account-copy');
    }
    return value;
  };

  const writeCopy = (entries: readonly LibraryEntry[]): void => {
    storage.set(keys.copy, serializeAccountCopy(entries));
  };

  const readQueue = (): AccountLibraryQueue => {
    const { value, problems } = readAccountQueue(storage.getString(keys.queue));
    for (const reason of problems) {
      report(reason, 'account-queue');
    }
    return value;
  };

  const writeQueue = (queue: AccountLibraryQueue): void => {
    storage.set(keys.queue, serializeAccountQueue(queue));
  };

  // replaces each of `sent` still queued with `change` of it; returns how many were changed
  const changeSent = (
    sent: readonly QueuedWriteRecord[],
    change: (record: QueuedWriteRecord) => QueuedWriteRecord,
  ): number => {
    const queue = readQueue();
    const targets = new Set(sent.map(writeIdOf));
    let changed = 0;
    const records = queue.records.map((record) => {
      if (!targets.has(writeIdOf(record))) {
        return record;
      }
      changed += 1;
      return change(record);
    });
    if (changed > 0) {
      writeQueue({ nextSeq: queue.nextSeq, records });
    }
    return changed;
  };

  // keeps the records `keep` accepts; returns how many were removed
  const removeRecords = (keep: (record: QueuedWriteRecord) => boolean): number => {
    const queue = readQueue();
    const records = queue.records.filter(keep);
    const removed = queue.records.length - records.length;
    if (removed > 0) {
      writeQueue({ nextSeq: queue.nextSeq, records });
    }
    return removed;
  };

  return {
    readCopy,
    writeCopy,

    updateCopy: (key, entry) => {
      const copy = readCopy();
      if (copy === null) {
        return;
      }
      const id = libraryEntryId(key);
      const others = copy.filter((stored) => libraryEntryId(stored.key) !== id);
      if (entry === null && others.length === copy.length) {
        return;
      }
      writeCopy(entry === null ? others : [...others, entry]);
    },

    readRecords: () => readQueue().records,

    recordOf: (key) => {
      const id = libraryEntryId(key);
      return readQueue().records.find((record) => idOf(record) === id);
    },

    enqueue: (write) => {
      const queue = readQueue();
      const seq = Math.max(queue.nextSeq, seqFloor.highest + 1);
      const record: QueuedWriteRecord = { seq, write };
      const id = idOf(record);
      writeQueue({
        nextSeq: seq + 1,
        records: [...queue.records.filter((other) => idOf(other) !== id), record],
      });
      seqFloor.highest = seq;
      return record;
    },

    removeConfirmed: (sent) => {
      const confirmed = new Set(sent.map(writeIdOf));
      return removeRecords((record) => !confirmed.has(writeIdOf(record)));
    },

    markRefused: (sent) =>
      changeSent([sent], (record) =>
        queuedWriteRecord(record.seq, record.write, { ...record, refused: true }),
      ) > 0,

    countFailedRun: (sent) =>
      changeSent(sent, (record) =>
        queuedWriteRecord(record.seq, record.write, {
          ...record,
          failures: (record.failures ?? 0) + 1,
        }),
      ),

    removeStuck: () => removeRecords((record) => !isLibraryWriteStuck(record)),
  };
};

/**
 * deletes the device copy and the write queue at `keys` (the device purge, ADR-0018). both
 * deletions are tried; a storage failure throws once they were, the first failure.
 */
export const deleteAccountLibraryDocuments = (
  storage: StorageAdapter,
  keys: AccountLibraryStoreOptions['keys'],
): void => {
  const failures: unknown[] = [];
  for (const key of [keys.copy, keys.queue]) {
    try {
      storage.delete(key);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw failures[0];
  }
};

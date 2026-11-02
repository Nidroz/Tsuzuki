// one offline account library instance (ADR-0017): the account store of one user behind the
// device copy and the write queue shared by every instance of that user. a write is queued before
// any request, tried at once when the device is online and its key is not being replayed, and
// replayed later otherwise; reads show the queue over the server state, or over the device copy
// offline. entries hold personal data: never logged, never in an error or a report tag
import type { LibraryEntry } from '../../domain/library-entry';
import {
  libraryQueuedWriteTime,
  overlayQueuedWrites,
  queuedWriteTime,
  type LibraryQueuedWrite,
} from '../../domain/library-sync';
import { libraryEntryId } from '../../domain/library-view';
import type { MediaKey } from '../../domain/media';
import { LibraryRemoteError } from '../../errors/library-errors';
import { libraryEntrySchema, mediaKeySchema } from '../../schemas/library-entry';
import type { OfflineAccountLibraryRepository } from '../library-repository';
import type { QueuedWriteRecord } from './account-library-documents';
import {
  beginRead,
  confirmState,
  countDirectAttempt,
  endRead,
  notifyQueued,
  recordId,
} from './account-library-coordination';
import {
  LIBRARY_REPLAY_REPORT_SOURCE,
  replayQueuedWrites,
  type ReplayContext,
} from './account-library-replay';

/** a replay context and the wall clock that times a removal. */
export interface OfflineAccountLibraryContext extends ReplayContext {
  readonly now: () => Date;
}

const isRemoteFailure = (error: unknown, reasons: readonly string[]): boolean =>
  error instanceof LibraryRemoteError && reasons.includes(error.reason);

// a direct attempt failing so leaves the queue and rejects: the server refused the write, or wrote
// it and answered a row that does not parse. any other failure (network, signed-out, unknown: the
// server may have committed it) keeps the write queued for this user, until a replay confirms it
const LEAVING_REASONS = ['rejected', 'invalid-row'] as const;
// a read failing so falls back to the copy
const UNREACHABLE_REASONS = ['network'] as const;

// the state a queued write asks for: its entry, or null for a removal
const stateOf = (write: LibraryQueuedWrite): LibraryEntry | null =>
  write.type === 'save' ? write.entry : null;

export const createOfflineAccountLibrary = (
  context: OfflineAccountLibraryContext,
): OfflineAccountLibraryRepository => {
  const { coordination, remote, isOnline, reporter, now } = context;
  const { store } = coordination;

  const queuedStateOf = (key: MediaKey): LibraryEntry | null | undefined => {
    const record = store.recordOf(key);
    return record === undefined ? undefined : stateOf(record.write);
  };

  const copyEntryOf = (key: MediaKey): LibraryEntry | undefined => {
    const id = libraryEntryId(key);
    return store.readCopy()?.find((entry) => libraryEntryId(entry.key) === id);
  };

  // the device answer of a read: the queued write, else the copy, else no copy to read: network
  const deviceGet = (key: MediaKey): LibraryEntry | null => {
    const queued = queuedStateOf(key);
    if (queued !== undefined) {
      return queued;
    }
    const copy = store.readCopy();
    if (copy === null) {
      throw new LibraryRemoteError('network');
    }
    const id = libraryEntryId(key);
    return copy.find((entry) => libraryEntryId(entry.key) === id) ?? null;
  };

  const deviceList = (): readonly LibraryEntry[] => {
    const copy = store.readCopy();
    if (copy === null) {
      throw new LibraryRemoteError('network');
    }
    return overlayQueuedWrites(
      copy,
      store.readRecords().map(({ write }) => write),
    );
  };

  // the time of a change of `key` made at `changeTime`: after the known state of the key, the
  // key's queued write else its copy entry
  const timeOfChange = (
    changeTime: string,
    previous: QueuedWriteRecord | undefined,
    copyEntry: LibraryEntry | undefined,
  ): string =>
    queuedWriteTime(
      changeTime,
      previous === undefined
        ? (copyEntry?.updatedAt ?? null)
        : libraryQueuedWriteTime(previous.write),
    );

  // the queued write stays for the replay: the call resolves with the queued state
  const keepQueued = <R>(queued: R): R => {
    notifyQueued(coordination);
    return queued;
  };

  // the regular request of a queued write: a success confirms it, a definite refusal (rejected,
  // invalid-row) removes it and rejects, any other failure keeps it for the replay
  const attemptDirect = async <T, R>(
    record: QueuedWriteRecord,
    request: () => Promise<T>,
    onConfirmed: (value: T) => R,
    queued: R,
  ): Promise<R> => {
    const id = recordId(record);
    if (!isOnline() || coordination.sendingKeys.has(id)) {
      return keepQueued(queued);
    }
    countDirectAttempt(coordination, id, 1);
    let value: T;
    try {
      value = await request();
    } catch (error) {
      // released before the listeners hear of the write: a run they start may send it
      countDirectAttempt(coordination, id, -1);
      if (isRemoteFailure(error, LEAVING_REASONS)) {
        store.removeConfirmed([record]);
        throw error;
      }
      if (!(error instanceof LibraryRemoteError)) {
        // a bug of the account store, which maps its failures: read as unknown, never silent
        reporter.captureError(error, { source: LIBRARY_REPLAY_REPORT_SOURCE });
      }
      return keepQueued(queued);
    }
    countDirectAttempt(coordination, id, -1);
    store.removeConfirmed([record]);
    return onConfirmed(value);
  };

  return {
    get: async (key) => {
      const queued = queuedStateOf(key);
      if (queued !== undefined) {
        return queued;
      }
      if (!isOnline()) {
        return deviceGet(key);
      }
      const mark = beginRead(coordination);
      let fetched: LibraryEntry | null;
      try {
        fetched = await remote.get(key);
      } catch (error) {
        endRead(coordination, mark);
        if (isRemoteFailure(error, UNREACHABLE_REASONS)) {
          return deviceGet(key);
        }
        throw error;
      }
      // a state of the key confirmed while the read was in flight is newer than the one read
      const confirmed = endRead(coordination, mark).get(libraryEntryId(key));
      if (confirmed === undefined) {
        store.updateCopy(key, fetched);
      }
      const latest = queuedStateOf(key);
      if (latest !== undefined) {
        return latest;
      }
      return confirmed === undefined ? fetched : confirmed;
    },

    list: async () => {
      if (!isOnline()) {
        return deviceList();
      }
      const mark = beginRead(coordination);
      let fetched: readonly LibraryEntry[];
      try {
        fetched = await remote.list();
      } catch (error) {
        endRead(coordination, mark);
        if (isRemoteFailure(error, UNREACHABLE_REASONS)) {
          return deviceList();
        }
        throw error;
      }
      // the keys confirmed while the list was in flight keep their confirmed state
      const confirmed = endRead(coordination, mark);
      const kept = fetched.filter((entry) => !confirmed.has(libraryEntryId(entry.key)));
      const copy = [
        ...kept,
        ...[...confirmed.values()].filter((entry): entry is LibraryEntry => entry !== null),
      ];
      store.writeCopy(copy);
      return overlayQueuedWrites(
        copy,
        store.readRecords().map(({ write }) => write),
      );
    },

    save: async (entry) => {
      const parsed = libraryEntrySchema.safeParse(entry);
      if (!parsed.success) {
        // the message holds no value: the ui validates user input first, this is a bug
        throw new RangeError('library entry is outside the database limits');
      }
      const { key } = parsed.data;
      const previous = store.recordOf(key);
      const copyEntry = copyEntryOf(key);
      const previousSave = previous?.write.type === 'save' ? previous.write.entry : undefined;
      const timed = libraryEntrySchema.safeParse({
        ...parsed.data,
        createdAt: copyEntry?.createdAt ?? previousSave?.createdAt ?? parsed.data.createdAt,
        updatedAt: timeOfChange(parsed.data.updatedAt, previous, copyEntry),
      });
      if (!timed.success) {
        throw new RangeError('library entry is outside the database limits');
      }
      const record = store.enqueue({ type: 'save', entry: timed.data });
      return attemptDirect(
        record,
        () => remote.save(timed.data),
        (stored) => {
          confirmState(coordination, key, stored);
          return stored;
        },
        timed.data,
      );
    },

    remove: async (key) => {
      const parsed = mediaKeySchema.safeParse(key);
      if (!parsed.success) {
        throw new RangeError('media key is outside the database limits');
      }
      const removedAt = timeOfChange(
        now().toISOString(),
        store.recordOf(parsed.data),
        copyEntryOf(parsed.data),
      );
      const record = store.enqueue({ type: 'remove', key: parsed.data, removedAt });
      await attemptDirect(
        record,
        () => remote.remove(parsed.data),
        () => {
          confirmState(coordination, parsed.data, null);
        },
        undefined,
      );
    },

    mergeGuestEntries: (entries, options) => remote.mergeGuestEntries(entries, options),

    replayQueuedWrites: (options) => replayQueuedWrites(context, options),

    subscribeToQueuedWrites: (listener) => {
      // a wrapper per subscription: the same listener subscribed twice is two subscriptions
      const subscription = (): void => {
        listener();
      };
      coordination.listeners.add(subscription);
      return () => {
        coordination.listeners.delete(subscription);
      };
    },
  };
};

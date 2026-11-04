// the device side of one offline account library instance (ADR-0017): the queued state of a key,
// its device copy entry, the answers of reads from the device, and the time of a change. entries
// hold personal data: never logged, never in an error or a report tag
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
import type { QueuedWriteRecord } from './account-library-documents';
import type { AccountLibraryStore } from './account-library-store';

// the state a queued write asks for: its entry, or null for a removal
const stateOf = (write: LibraryQueuedWrite): LibraryEntry | null =>
  write.type === 'save' ? write.entry : null;

/**
 * the time of a change of a key made at `changeTime`: after the known state of the key, its queued
 * write (`previous`) else its copy entry.
 */
export const timeOfChange = (
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

/** the reads of `store` an instance makes on the device. */
export const createDeviceReads = (store: AccountLibraryStore) => {
  // the state the queued write of `key` asks for, undefined when none is queued
  const queuedStateOf = (key: MediaKey): LibraryEntry | null | undefined => {
    const record = store.recordOf(key);
    return record === undefined ? undefined : stateOf(record.write);
  };

  const copyEntryOf = (key: MediaKey): LibraryEntry | undefined => {
    const id = libraryEntryId(key);
    return store.readCopy()?.find((entry) => libraryEntryId(entry.key) === id);
  };

  // the device answer of a get: the queued write, else the copy, else no copy to read: network
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

  // the device answer of a list: the queued writes over the copy, else no copy to read: network
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

  return { queuedStateOf, copyEntryOf, deviceGet, deviceList };
};

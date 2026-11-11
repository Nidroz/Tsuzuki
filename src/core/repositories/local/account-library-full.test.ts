import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import { libraryEntryId } from '../../domain/library-view';
import type { MediaKey } from '../../domain/media';
import { LibraryRemoteError } from '../../errors/library-errors';
import { USER_A, setupOfflineLibraries } from './__fixtures__/in-memory-remote';
import { readAccountQueue } from './account-library-documents';

// a full account library (R-04): the database refuses a new key past the user's cap with
// `library-full`, a refusal like `rejected`. a direct write leaves the queue and rejects, so the
// user is told; a replay batch is sent again one write per call, and a write refused alone stays
// queued, stuck, until the user's retry once there is room; the guest merge rejects with it

const QUEUE_KEY = `account-library-queue.${USER_A}`;
const STORED_KEY = keyOf('anime', 1);
const NEW_KEY = keyOf('anime', 2);
// the server holds the stored key only, the most it takes in these tests
const ENTRY_CAP = 1;

const entryAt = (key: MediaKey, progress: number, updatedAt: string): LibraryEntry =>
  entryOf({ key, progress, createdAt: '2025-11-01T00:00:00.000Z', updatedAt });

const STORED = entryAt(STORED_KEY, 0, '2025-11-01T00:00:00.000Z');

const setup = () => {
  const offline = setupOfflineLibraries();
  const library = offline.libraryFor(USER_A);
  const remote = offline.remoteOf(USER_A);
  remote.seed(STORED);
  remote.setEntryCap(ENTRY_CAP);
  const listener = jest.fn();
  library.subscribeToQueuedWrites(listener);
  const queued = () => readAccountQueue(offline.storage.getString(QUEUE_KEY)).value.records;
  const progressOf = (key: MediaKey) => remote.rows.get(libraryEntryId(key))?.progress;
  return { ...offline, library, remote, listener, queued, progressOf };
};

describe('a direct write at the cap', () => {
  it('of a new key leaves the queue and rejects with library-full, not reported', async () => {
    const { library, remote, listener, queued, captureError } = setup();

    await expect(
      library.save(entryAt(NEW_KEY, 1, '2025-12-31T00:00:00.000Z')),
    ).rejects.toMatchObject({ name: 'LibraryRemoteError', reason: 'library-full' });

    expect(queued()).toStrictEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(remote.rows.size).toBe(ENTRY_CAP);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('of a stored key is written', async () => {
    const { library, queued, progressOf } = setup();

    await expect(
      library.save(entryAt(STORED_KEY, 5, '2025-12-31T00:00:00.000Z')),
    ).resolves.toMatchObject({ progress: 5 });

    expect(queued()).toStrictEqual([]);
    expect(progressOf(STORED_KEY)).toBe(5);
  });
});

describe('a replay batch at the cap', () => {
  // a save of a new key, then a newer save of the stored key, both queued offline
  const queueBoth = async (offline: ReturnType<typeof setup>) => {
    offline.connectivity.online = false;
    await offline.library.save(entryAt(NEW_KEY, 1, '2025-12-31T00:00:00.000Z'));
    await offline.library.save(entryAt(STORED_KEY, 7, '2025-12-31T00:00:00.000Z'));
    offline.connectivity.online = true;
  };

  it('is sent one write per call: the new key refused alone and stuck, the other written', async () => {
    const offline = setup();
    const { library, remote, queued, progressOf, captureError } = offline;
    await queueBoth(offline);

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });

    expect(remote.replayed.map((batch) => batch.length)).toStrictEqual([2, 1, 1]);
    expect(queued()).toMatchObject([{ seq: 1, refused: true }]);
    expect(library.stuckWriteCount()).toBe(1);
    expect(progressOf(STORED_KEY)).toBe(7);
    expect(remote.rows.has(libraryEntryId(NEW_KEY))).toBe(false);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('syncs the stuck write on the retry once the user removed an entry', async () => {
    const offline = setup();
    const { library, remote, queued } = offline;
    await queueBoth(offline);
    await library.replayQueuedWrites();

    await library.remove(STORED_KEY);
    await expect(library.retryStuckWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });

    expect(queued()).toStrictEqual([]);
    expect(library.stuckWriteCount()).toBe(0);
    expect([...remote.rows.keys()]).toStrictEqual([libraryEntryId(NEW_KEY)]);
  });
});

describe('a guest merge at the cap', () => {
  it('rejects with library-full through the store, the queue untouched', async () => {
    const { library, remote, queued, captureError } = setup();
    const guestEntries = [entryAt(NEW_KEY, 3, '2025-12-31T00:00:00.000Z')];
    remote.mergeGuestEntries.mockRejectedValueOnce(new LibraryRemoteError('library-full'));

    await expect(library.mergeGuestEntries(guestEntries)).rejects.toMatchObject({
      reason: 'library-full',
    });

    expect(remote.mergeGuestEntries).toHaveBeenCalledWith(guestEntries, undefined);
    expect(queued()).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });
});

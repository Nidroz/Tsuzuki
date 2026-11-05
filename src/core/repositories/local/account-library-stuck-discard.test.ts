import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import type { MediaKey } from '../../domain/media';
import { USER_A, USER_B, flush, setupOfflineLibraries } from './__fixtures__/in-memory-remote';
import {
  queuedWriteRecord,
  readAccountQueue,
  serializeAccountQueue,
  type QueuedWriteRecord,
} from './account-library-documents';

// the discard of the stuck writes, the sync state listeners, and the purge closing both
// (ADR-0017 "Stuck writes", update of 2026-11-04)

const KEY_1 = keyOf('anime', 1);
const KEY_2 = keyOf('anime', 2);
const KEY_3 = keyOf('anime', 3);
const KEY_4 = keyOf('anime', 4);
const copyKeyOf = (userId: string): string => `account-library-copy.${userId}`;
const queueKeyOf = (userId: string): string => `account-library-queue.${userId}`;

const entryAt = (key: MediaKey, progress = 1): LibraryEntry =>
  entryOf({
    key,
    progress,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-31T00:00:00.000Z',
  });

const saveOf = (key: MediaKey) => ({ type: 'save', entry: entryAt(key) }) as const;

// refused, failed as often as the limit, failed less often, refused (each a save of its key)
const STATES: readonly QueuedWriteRecord[] = [
  queuedWriteRecord(1, saveOf(KEY_1), { refused: true }),
  queuedWriteRecord(2, saveOf(KEY_2), { failures: 3 }),
  queuedWriteRecord(3, saveOf(KEY_3), { failures: 2 }),
  queuedWriteRecord(4, saveOf(KEY_4), { refused: true }),
];

// a factory whose users each have a device copy and the queue of STATES
const setup = async () => {
  const offline = setupOfflineLibraries();
  for (const userId of [USER_A, USER_B]) {
    offline.remoteOf(userId).seed(entryAt(KEY_1, 9));
    await offline.libraryFor(userId).list();
    offline.storage.set(queueKeyOf(userId), serializeAccountQueue({ nextSeq: 5, records: STATES }));
  }
  const library = offline.libraryFor(USER_A);
  const queued = (userId = USER_A) =>
    readAccountQueue(offline.storage.getString(queueKeyOf(userId))).value.records;
  return { ...offline, library, queued };
};

describe('discardStuckWrites', () => {
  it('removes the writes stuck at the call only, keeping a replaced one and the copy', async () => {
    const { library, queued, storage, connectivity } = await setup();
    connectivity.online = false;
    const newer = { ...entryAt(KEY_4, 2), updatedAt: '2026-01-01T00:00:00.000Z' };
    await library.save(newer);
    const copy = storage.getString(copyKeyOf(USER_A));
    expect(library.stuckWriteCount()).toBe(2);

    expect(library.discardStuckWrites()).toBe(2);

    expect(queued()).toStrictEqual([STATES[2], { seq: 5, write: { type: 'save', entry: newer } }]);
    expect(library.stuckWriteCount()).toBe(0);
    expect(library.queuedWriteCount()).toBe(2);
    expect(storage.getString(copyKeyOf(USER_A))).toBe(copy);
    expect(library.discardStuckWrites()).toBe(0);
  });

  it("leaves another user's queue untouched", async () => {
    const { library, queued, libraryFor } = await setup();

    library.discardStuckWrites();

    expect(queued(USER_B)).toStrictEqual(STATES);
    expect(libraryFor(USER_B).stuckWriteCount()).toBe(3);
  });
});

describe('subscribeToSyncState', () => {
  it('tells every instance of the user, never another user, until unsubscribed', async () => {
    const { library, libraryFor, connectivity } = await setup();
    const listener = jest.fn<() => void>();
    const otherInstance = jest.fn<() => void>();
    const otherUser = jest.fn<() => void>();
    const unsubscribe = library.subscribeToSyncState(listener);
    libraryFor(USER_A).subscribeToSyncState(otherInstance);
    libraryFor(USER_B).subscribeToSyncState(otherUser);
    connectivity.online = false;

    // a write replacing a stuck one, a discard that removed writes; neither a write replacing one
    // that is not stuck nor a discard that removed nothing
    await library.save({ ...entryAt(KEY_1, 2), updatedAt: '2026-01-01T00:00:00.000Z' });
    library.discardStuckWrites();
    library.discardStuckWrites();
    await library.save({ ...entryAt(KEY_3, 2), updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    connectivity.online = true;
    await library.replayQueuedWrites();

    expect(listener).toHaveBeenCalledTimes(2);
    // and the end of the run
    expect(otherInstance).toHaveBeenCalledTimes(3);
    expect(otherUser).not.toHaveBeenCalled();
  });

  it('is called by a retry, a write marked refused and the end of each run', async () => {
    const { library, remoteOf } = await setup();
    const remote = remoteOf(USER_A);
    remote.refuseKey(KEY_1);
    const listener = jest.fn<() => void>();
    library.subscribeToSyncState(listener);
    const gate = remote.holdNext('replayWrites');

    const retry = library.retryStuckWrites();
    expect(listener).toHaveBeenCalledTimes(1);
    gate.open();
    await retry;

    // the retry, KEY_1 marked refused again, the end of the run
    expect(listener).toHaveBeenCalledTimes(3);
    expect(remote.replayed.map((batch) => batch.length)).toStrictEqual([4, 1, 1, 1, 1]);
  });
});

describe('the purge', () => {
  it('closes the stuck write members of every instance created before', async () => {
    const { library, libraryFor, storage, remoteOf } = await setup();
    const other = libraryFor(USER_A);
    const listener = jest.fn<() => void>();
    other.subscribeToSyncState(listener);

    library.purgeDeviceData();
    const set = jest.spyOn(storage, 'set');

    expect(other.stuckWriteCount()).toBe(0);
    expect(other.discardStuckWrites()).toBe(0);
    await expect(other.retryStuckWrites()).resolves.toStrictEqual({
      status: 'signed-out',
      confirmed: 0,
    });
    const late = jest.fn<() => void>();
    other.subscribeToSyncState(late)();
    await libraryFor(USER_A).replayQueuedWrites();

    expect(listener).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(remoteOf(USER_A).replayed).toStrictEqual([]);
    expect(libraryFor(USER_B).stuckWriteCount()).toBe(3);
  });

  it('ends a retry in flight signed-out, its listeners never called again', async () => {
    const { library, remoteOf } = await setup();
    const listener = jest.fn<() => void>();
    library.subscribeToSyncState(listener);
    const gate = remoteOf(USER_A).holdNext('replayWrites');
    const retry = library.retryStuckWrites();
    await flush();

    library.purgeDeviceData();
    gate.open();

    await expect(retry).resolves.toStrictEqual({ status: 'signed-out', confirmed: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

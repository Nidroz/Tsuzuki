import { describe, expect, it } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { USER_A, setupOfflineLibraries } from './__fixtures__/in-memory-remote';
import { readAccountQueue } from './account-library-documents';

// what a removal tells the queue listeners when its key already has a queued write (ADR-0017
// "Writes"): the queue holds one write per key, so a removal kept queued replaces that write and
// the queued write count stays 1. only the listeners, called during the call, tell that the
// removal is not confirmed; a removal the server confirms calls none and leaves the count at 0

const QUEUE_KEY = `account-library-queue.${USER_A}`;
const KEY = keyOf('anime', 1);

const QUEUED_REMOVAL = { type: 'remove', key: KEY, removedAt: expect.any(String) };

// a write of KEY queued offline (seq 1), the device online again; the listener subscribed after
// it records the queued write count each time it is called
const setup = async () => {
  const offline = setupOfflineLibraries();
  const library = offline.libraryFor(USER_A);
  const remote = offline.remoteOf(USER_A);
  offline.connectivity.online = false;
  await library.save(
    entryOf({
      key: KEY,
      createdAt: '2025-12-01T00:00:00.000Z',
      updatedAt: '2025-12-31T00:00:00.000Z',
    }),
  );
  offline.connectivity.online = true;
  const countsHeard: number[] = [];
  library.subscribeToQueuedWrites(() => {
    countsHeard.push(library.queuedWriteCount());
  });
  const queued = () => readAccountQueue(offline.storage.getString(QUEUE_KEY)).value.records;
  return { ...offline, library, remote, countsHeard, queued };
};

describe('a removal of a key with a queued write', () => {
  it.each(['offline', 'network', 'unknown'] as const)(
    'kept queued (%s) calls the listeners during the call, the count staying 1',
    async (kept) => {
      const { library, remote, connectivity, countsHeard, queued } = await setup();
      if (kept === 'offline') {
        connectivity.online = false;
      } else {
        remote.failNext('remove', kept);
      }
      expect(library.queuedWriteCount()).toBe(1);

      await expect(library.remove(KEY)).resolves.toBeUndefined();

      expect(countsHeard).toStrictEqual([1]);
      expect(library.queuedWriteCount()).toBe(1);
      // only the seq of the key tells the earlier write was replaced
      expect(queued()).toStrictEqual([{ seq: 2, write: QUEUED_REMOVAL }]);
    },
  );

  it('kept queued while that write is stuck (refused alone by the database) calls the listeners, the count staying 1', async () => {
    const { library, remote, countsHeard, queued } = await setup();
    remote.refuseKey(KEY);
    await library.replayQueuedWrites();
    expect(queued()).toMatchObject([{ seq: 1, refused: true }]);
    expect(countsHeard).toStrictEqual([]);
    remote.failNext('remove', 'network');

    await library.remove(KEY);

    expect(countsHeard).toStrictEqual([1]);
    expect(library.queuedWriteCount()).toBe(1);
    // a newer write of its key is no longer stuck
    expect(queued()).toStrictEqual([{ seq: 2, write: QUEUED_REMOVAL }]);
    expect(library.stuckWriteCount()).toBe(0);
  });

  it('confirmed by the server calls no listener and leaves the count at 0', async () => {
    const { library, remote, countsHeard, queued } = await setup();

    await library.remove(KEY);

    expect(remote.calls).toStrictEqual(['remove']);
    expect(countsHeard).toStrictEqual([]);
    expect(library.queuedWriteCount()).toBe(0);
    expect(queued()).toStrictEqual([]);
  });
});

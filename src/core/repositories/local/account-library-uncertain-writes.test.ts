import { describe, expect, it } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import { USER_A, setupOfflineLibraries } from './__fixtures__/in-memory-remote';
import { readAccountQueue } from './account-library-documents';

// a direct attempt whose outcome is uncertain (ADR-0017 "Writes"): failing with `unknown`, the
// server may have committed the write, so it stays queued until a replay confirms it. nothing is
// lost, not even an offline change the failed one replaced

const DEVICE_TIME = '2025-12-31T23:00:00.000Z';
const LATER_DEVICE_TIME = '2025-12-31T23:30:00.000Z';
const QUEUE_KEY = `account-library-queue.${USER_A}`;
const OTHER_KEY = keyOf('manga', 8);

const changed = (overrides: Partial<LibraryEntry> = {}): LibraryEntry =>
  entryOf({ createdAt: DEVICE_TIME, updatedAt: DEVICE_TIME, ...overrides });

const setup = () => {
  const offline = setupOfflineLibraries();
  const library = offline.libraryFor(USER_A);
  const remote = offline.remoteOf(USER_A);
  const queued = () => readAccountQueue(offline.storage.getString(QUEUE_KEY)).value.records;
  return { ...offline, library, remote, queued };
};

describe('a save failing with unknown', () => {
  it('stays queued, then is replayed and confirmed', async () => {
    const { library, remote, queued, captureError } = setup();
    remote.failNext('save', 'unknown');
    await expect(library.save(changed({ progress: 4 }))).resolves.toStrictEqual(
      changed({ progress: 4 }),
    );

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });

    expect(queued()).toStrictEqual([]);
    expect([...remote.rows.values()]).toMatchObject([{ progress: 4 }]);
    // the account store reports its own unknown failures
    expect(captureError).not.toHaveBeenCalled();
  });

  it('replacing an offline change, keeps the latest change queued and replays it', async () => {
    const { library, remote, connectivity, queued } = setup();
    connectivity.online = false;
    await library.save(changed({ progress: 1 }));
    connectivity.online = true;
    remote.failNext('save', 'unknown');
    const latest = changed({ progress: 2, updatedAt: LATER_DEVICE_TIME });

    await expect(library.save(latest)).resolves.toStrictEqual(latest);
    expect(queued()).toStrictEqual([{ seq: 2, write: { type: 'save', entry: latest } }]);

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });
    expect(queued()).toStrictEqual([]);
    expect(remote.replayed).toStrictEqual([[{ type: 'save', entry: latest }]]);
    expect([...remote.rows.values()]).toMatchObject([{ progress: 2 }]);
  });

  it('replacing an offline change, still rejects and leaves the queue when rejected', async () => {
    const { library, remote, connectivity, queued } = setup();
    connectivity.online = false;
    await library.save(changed({ progress: 1 }));
    connectivity.online = true;
    remote.failNext('save', 'rejected');

    await expect(
      library.save(changed({ progress: 2, updatedAt: LATER_DEVICE_TIME })),
    ).rejects.toMatchObject({ reason: 'rejected' });

    expect(queued()).toStrictEqual([]);
  });
});

describe('a removal failing with unknown', () => {
  it('stays queued, notifies, then is replayed', async () => {
    const { library, remote, queued } = setup();
    remote.seed(changed({ key: OTHER_KEY }));
    remote.failNext('remove', 'unknown');
    let notified = 0;
    library.subscribeToQueuedWrites(() => {
      notified += 1;
    });

    await expect(library.remove(OTHER_KEY)).resolves.toBeUndefined();
    expect(notified).toBe(1);
    expect(queued()).toHaveLength(1);

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });
    expect(queued()).toStrictEqual([]);
    expect(remote.rows.size).toBe(0);
  });
});

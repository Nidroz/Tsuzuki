import { describe, expect, it } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import { LIBRARY_REPLAY_BATCH_SIZE } from '../../domain/library-sync';
import {
  USER_A,
  USER_B,
  flush,
  setupOfflineLibraries,
  type InMemoryRemote,
} from './__fixtures__/in-memory-remote';
import { readAccountQueue } from './account-library-documents';

// the replay run (ADR-0017 "Replay run"): the queued writes of one user sent with the time of
// their change by ascending seq, one run per user at a time, a write leaving the queue only once
// the server confirmed it

const QUEUE_KEY = `account-library-queue.${USER_A}`;
// the jest clock (test/core/fixed-clock.ts) is the server time; a copy stamped before it, and a
// device clock behind both
const SERVER_TIME = '2026-01-01T00:00:00.000Z';
const COPY_TIME = '2025-12-31T12:00:00.000Z';
const DEVICE_TIME = '2025-12-30T00:00:00.000Z';
const OTHER_KEY = keyOf('manga', 8);

const at = (updatedAt: string, overrides: Partial<LibraryEntry> = {}): LibraryEntry =>
  entryOf({ createdAt: '2025-12-01T00:00:00.000Z', updatedAt, ...overrides });

const QUEUED = at('2025-12-31T00:00:00.000Z', { progress: 20 });

const setup = () => {
  const offline = setupOfflineLibraries();
  const library = offline.libraryFor(USER_A);
  const remote = offline.remoteOf(USER_A);
  const queued = () => readAccountQueue(offline.storage.getString(QUEUE_KEY)).value.records;
  // queues writes offline, then goes back online
  const queueOffline = async (write: () => Promise<unknown>): Promise<void> => {
    offline.connectivity.online = false;
    await write();
    offline.connectivity.online = true;
  };
  return { ...offline, library, remote, queued, queueOffline };
};

const sentKeys = (remote: InMemoryRemote) =>
  remote.replayed.map((batch) =>
    batch.map((write) =>
      write.type === 'save' ? write.entry.key.externalId : write.key.externalId,
    ),
  );

describe('a replay run', () => {
  it('replays the writes of a killed app from a new factory over the same storage', async () => {
    const first = setup();
    await first.queueOffline(() => first.library.save(QUEUED));
    await first.queueOffline(() => first.library.remove(OTHER_KEY));
    first.remote.seed(at('2025-12-02T00:00:00.000Z', { key: OTHER_KEY }));

    const restarted = setupOfflineLibraries({ storage: first.storage, remotes: first.remotes });
    const run = await restarted.libraryFor(USER_A).replayQueuedWrites();

    expect(run).toStrictEqual({ status: 'done', confirmed: 2 });
    // inserted: the server time is its creation time
    expect([...first.remote.rows.values()]).toStrictEqual([{ ...QUEUED, createdAt: SERVER_TIME }]);
    expect(first.queued()).toStrictEqual([]);
  });

  it('sends the writes by ascending seq in batches of LIBRARY_REPLAY_BATCH_SIZE', async () => {
    const { library, remote, queueOffline } = setup();
    for (let id = 1; id <= LIBRARY_REPLAY_BATCH_SIZE + 1; id += 1) {
      await queueOffline(() =>
        library.save(at('2025-12-31T00:00:00.000Z', { key: keyOf('anime', id) })),
      );
    }

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: LIBRARY_REPLAY_BATCH_SIZE + 1,
    });
    expect(sentKeys(remote).map((batch) => batch.length)).toStrictEqual([
      LIBRARY_REPLAY_BATCH_SIZE,
      1,
    ]);
    expect(sentKeys(remote)[1]).toStrictEqual([LIBRARY_REPLAY_BATCH_SIZE + 1]);
  });

  it('ends at once, sending nothing, offline or with nothing queued', async () => {
    const { library, remote, connectivity, queueOffline } = setup();

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 0,
    });
    await queueOffline(() => library.save(QUEUED));
    connectivity.online = false;
    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'offline',
      confirmed: 0,
    });
    expect(remote.replayed).toStrictEqual([]);
  });

  it('gives the copy the state of each written write', async () => {
    const { library, remote, queueOffline } = setup();
    const stored = at('2025-12-02T00:00:00.000Z', { key: OTHER_KEY });
    remote.seed(stored);
    await library.list();
    await queueOffline(() => library.save(QUEUED));
    await queueOffline(() => library.remove(OTHER_KEY));

    await library.replayQueuedWrites();
    remote.failNext('list', 'network');

    await expect(library.list()).resolves.toStrictEqual([QUEUED]);
  });

  // a device clock behind the server: an offline change is timed after the copy it replaced, so
  // it wins when replayed instead of losing to it (BR-08)
  it('makes offline changes win over the copy they replaced, the device clock behind', async () => {
    const offline = setupOfflineLibraries({ now: () => new Date(DEVICE_TIME) });
    const library = offline.libraryFor(USER_A);
    const remote = offline.remoteOf(USER_A);
    const stored = at(COPY_TIME, { progress: 3 });
    remote.seed(stored, at(COPY_TIME, { key: OTHER_KEY }));
    await library.list();
    offline.connectivity.online = false;
    await library.save(at(DEVICE_TIME, { progress: 4 }));
    await library.save(at(DEVICE_TIME, { progress: 5 }));
    await library.remove(OTHER_KEY);
    offline.connectivity.online = true;

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 2,
    });

    const saved = { ...stored, progress: 5, updatedAt: '2025-12-31T12:00:00.002Z' };
    expect(remote.replayed).toStrictEqual([
      [
        { type: 'save', entry: saved },
        { type: 'remove', key: OTHER_KEY, removedAt: '2025-12-31T12:00:00.001Z' },
      ],
    ]);
    expect([...remote.rows.values()]).toStrictEqual([saved]);
  });
});

describe('one run per user', () => {
  it('joins three concurrent calls into one run, one call per batch', async () => {
    const { library, libraryFor, remote, queueOffline } = setup();
    await queueOffline(() => library.save(QUEUED));
    const gate = remote.holdNext('replayWrites');

    const runs = [
      library.replayQueuedWrites(),
      library.replayQueuedWrites(),
      libraryFor(USER_A).replayQueuedWrites(),
    ];
    gate.open();

    const [first, ...others] = await Promise.all(runs);
    expect(first).toStrictEqual({ status: 'done', confirmed: 1 });
    expect(others).toStrictEqual([first, first]);
    expect(remote.replayed).toHaveLength(1);
  });

  it('sends a write queued during the run, and starts a new run once one ended', async () => {
    const { library, remote, queueOffline } = setup();
    await queueOffline(() => library.save(QUEUED));
    const gate = remote.holdNext('replayWrites');
    const run = library.replayQueuedWrites();
    remote.failNext('remove', 'network');
    await library.remove(OTHER_KEY);

    gate.open();

    await expect(run).resolves.toStrictEqual({ status: 'done', confirmed: 2 });
    expect(sentKeys(remote)).toStrictEqual([[52991], [8]]);
    await queueOffline(() => library.save(QUEUED));
    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });
  });

  it('keeps a save of a key it is sending queued, never removed by the older confirmation', async () => {
    const { library, remote, queued, queueOffline } = setup();
    await queueOffline(() => library.save(QUEUED));
    const gate = remote.holdNext('replayWrites');
    remote.failNext('replayWrites', 'signed-out');
    const run = library.replayQueuedWrites();
    const newer = at('2025-12-31T12:00:00.000Z', { progress: 21 });

    await expect(library.save(newer)).resolves.toStrictEqual(newer);
    gate.open();

    await expect(run).resolves.toStrictEqual({ status: 'signed-out', confirmed: 0 });
    expect(remote.calls).not.toContain('save');
    expect(queued()).toStrictEqual([{ seq: 2, write: { type: 'save', entry: newer } }]);
  });

  it('skips a key with a direct attempt in flight', async () => {
    const { library, remote, queueOffline } = setup();
    await queueOffline(() => library.save(QUEUED));
    const gate = remote.holdNext('save');
    const saving = library.save(at('2025-12-31T12:00:00.000Z'));

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 0,
    });
    gate.open();
    await saving;
    expect(remote.replayed).toStrictEqual([]);
  });
});

describe('two users on one device', () => {
  it("never sends a user's queued writes from another user's instance", async () => {
    const { library, libraryFor, remote, remoteOf, queued, queueOffline } = setup();
    await queueOffline(() => library.save(QUEUED));
    const before = queued();

    await expect(libraryFor(USER_B).replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 0,
    });
    await flush();

    expect(remoteOf(USER_B).replayed).toStrictEqual([]);
    expect(remote.calls).toStrictEqual([]);
    expect(queued()).toStrictEqual(before);
    await expect(libraryFor(USER_A).replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });
  });
});

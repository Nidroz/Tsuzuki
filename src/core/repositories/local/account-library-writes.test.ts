import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import { LibraryRemoteError } from '../../errors/library-errors';
import { USER_A, flush, setupOfflineLibraries } from './__fixtures__/in-memory-remote';
import { readAccountQueue } from './account-library-documents';

// the writes of the offline account library (ADR-0017 "Writes"): queued on the device before any
// request, tried at once online, kept for the replay on network, signed-out and unknown (the
// server may have committed them), removed and rejected when the server refused them

// the jest clock starts at 2026-01-01T00:00:00Z (test/core/fixed-clock.ts): the server time
const DEVICE_TIME = '2025-12-31T23:00:00.000Z';
const SERVER_TIME = '2026-01-01T00:00:00.000Z';
const QUEUE_KEY = `account-library-queue.${USER_A}`;
const OTHER_KEY = keyOf('manga', 8);

const changed = (overrides: Partial<LibraryEntry> = {}): LibraryEntry =>
  entryOf({ createdAt: DEVICE_TIME, updatedAt: DEVICE_TIME, ...overrides });

const setup = () => {
  const offline = setupOfflineLibraries();
  const library = offline.libraryFor(USER_A);
  const remote = offline.remoteOf(USER_A);
  const listener = jest.fn();
  library.subscribeToQueuedWrites(listener);
  const queued = () => readAccountQueue(offline.storage.getString(QUEUE_KEY)).value;
  return { ...offline, library, remote, listener, queued };
};

describe('a save', () => {
  it('is queued before any request, and stays queued while the request is in flight', async () => {
    const { library, remote, queued } = setup();
    const gate = remote.holdNext('save');

    const saving = library.save(changed());

    expect(queued().records).toStrictEqual([{ seq: 1, write: { type: 'save', entry: changed() } }]);
    gate.open();
    await expect(saving).resolves.toStrictEqual(
      changed({ createdAt: SERVER_TIME, updatedAt: SERVER_TIME }),
    );
    expect(queued()).toStrictEqual({ nextSeq: 2, records: [] });
  });

  it('offline, resolves at once with the queued entry, sends nothing and notifies', async () => {
    const { library, remote, connectivity, listener, queued } = setup();
    connectivity.online = false;

    await expect(library.save(changed())).resolves.toStrictEqual(changed());

    expect(remote.calls).toStrictEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(queued().records).toHaveLength(1);
  });

  it.each(['network', 'signed-out', 'unknown'] as const)(
    'failing with %s, keeps the write for this user and resolves with the queued entry',
    async (reason) => {
      const { library, remote, listener, queued } = setup();
      remote.failNext('save', reason);

      await expect(library.save(changed())).resolves.toStrictEqual(changed());

      expect(listener).toHaveBeenCalledTimes(1);
      expect(queued().records).toStrictEqual([
        { seq: 1, write: { type: 'save', entry: changed() } },
      ]);
    },
  );

  it('kept on network, is sent by a replay its listener starts at once', async () => {
    const { library, remote, queued } = setup();
    const runs: Promise<unknown>[] = [];
    library.subscribeToQueuedWrites(() => {
      runs.push(library.replayQueuedWrites());
    });
    remote.failNext('save', 'network');

    await library.save(changed());

    await expect(Promise.all(runs)).resolves.toStrictEqual([{ status: 'done', confirmed: 1 }]);
    expect(queued().records).toStrictEqual([]);
  });

  it.each(['rejected', 'invalid-row'] as const)(
    'refused with %s, leaves the queue and rejects with that error',
    async (reason) => {
      const { library, remote, listener, queued } = setup();
      remote.failNext('save', reason);

      await expect(library.save(changed())).rejects.toMatchObject({ reason });

      expect(listener).not.toHaveBeenCalled();
      expect(queued().records).toStrictEqual([]);
    },
  );

  it('failing with an error the account store did not map, keeps the write, reported', async () => {
    const { library, remote, listener, queued, captureError } = setup();
    const bug = new TypeError('store bug');
    remote.failNext('save', bug);

    await expect(library.save(changed())).resolves.toStrictEqual(changed());

    expect(listener).toHaveBeenCalledTimes(1);
    expect(queued().records).toHaveLength(1);
    expect(captureError).toHaveBeenCalledWith(bug, { source: 'library-write' });
  });

  it('confirmed, leaves a newer write of its key queued meanwhile in the queue', async () => {
    const { library, remote, connectivity, queued } = setup();
    const gate = remote.holdNext('save');
    const first = library.save(changed({ progress: 1 }));
    connectivity.online = false;
    const newer = changed({ progress: 2, updatedAt: '2025-12-31T23:30:00.000Z' });

    await library.save(newer);
    gate.open();
    await first;

    expect(queued().records).toStrictEqual([{ seq: 2, write: { type: 'save', entry: newer } }]);
  });

  it('outside the database limits, rejects with a RangeError and queues nothing', async () => {
    const { library, remote, queued } = setup();

    await expect(library.save(changed({ progress: -1 }))).rejects.toThrow(
      new RangeError('library entry is outside the database limits'),
    );

    expect(queued().records).toStrictEqual([]);
    expect(remote.calls).toStrictEqual([]);
  });

  it('rejects when the storage fails, and sends nothing', async () => {
    const { library, storage, remote } = setup();
    const failure = new Error('storage full');
    jest.spyOn(storage, 'set').mockImplementation(() => {
      throw failure;
    });

    await expect(library.save(changed())).rejects.toBe(failure);
    expect(remote.calls).toStrictEqual([]);
  });
});

describe('a removal', () => {
  it('is queued with the device time, then removed once the server confirmed it', async () => {
    const { library, remote, queued } = setup();
    remote.seed(changed({ key: OTHER_KEY }));
    const gate = remote.holdNext('remove');

    const removing = library.remove(OTHER_KEY);

    expect(queued().records).toStrictEqual([
      { seq: 1, write: { type: 'remove', key: OTHER_KEY, removedAt: SERVER_TIME } },
    ]);
    gate.open();
    await expect(removing).resolves.toBeUndefined();
    expect(queued().records).toStrictEqual([]);
    expect(remote.rows.size).toBe(0);
  });

  it('offline or on network, resolves with the removal queued and notifies', async () => {
    const { library, remote, connectivity, listener, queued } = setup();
    remote.failNext('remove', 'network');

    await library.remove(OTHER_KEY);
    connectivity.online = false;
    await library.remove(keyOf('anime', 3));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(queued().records.map(({ seq }) => seq)).toStrictEqual([1, 2]);
  });

  it('refused, leaves the queue and rejects', async () => {
    const { library, remote, queued } = setup();
    remote.failNext('remove', 'rejected');

    await expect(library.remove(OTHER_KEY)).rejects.toBeInstanceOf(LibraryRemoteError);
    expect(queued().records).toStrictEqual([]);
  });

  it('of an invalid key, rejects with a RangeError and queues nothing', async () => {
    const { library, queued } = setup();

    await expect(library.remove(keyOf('anime', 0))).rejects.toBeInstanceOf(RangeError);
    expect(queued().records).toStrictEqual([]);
  });
});

describe('the seq of a write', () => {
  it('is never reused, after a confirmation nor after a damaged queue', async () => {
    const { library, storage, connectivity, queued, captureError } = setup();
    await library.save(changed());
    connectivity.online = false;
    await library.save(changed({ key: OTHER_KEY }));
    storage.set(QUEUE_KEY, '{');

    await library.remove(keyOf('anime', 3));

    expect(queued().records.map(({ seq }) => seq)).toStrictEqual([3]);
    expect(captureError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'invalid-json' }), {
      source: 'library-storage',
      tags: { reason: 'invalid-json', document: 'account-queue' },
    });
  });

  it('reports a damaged document once per reason and document per factory', async () => {
    const { library, libraryFor, storage, connectivity, captureError } = setup();
    storage.set(QUEUE_KEY, '{');
    storage.set(`account-library-copy.${USER_A}`, '{');
    connectivity.online = false;

    // a damaged copy reads as no copy: offline, the reads have nothing to answer
    await expect(library.list()).rejects.toMatchObject({ reason: 'network' });
    await expect(library.get(OTHER_KEY)).rejects.toMatchObject({ reason: 'network' });
    await expect(libraryFor(USER_A).get(OTHER_KEY)).rejects.toMatchObject({ reason: 'network' });

    expect(captureError.mock.calls.map(([, context]) => context?.tags)).toStrictEqual([
      { reason: 'invalid-json', document: 'account-copy' },
      { reason: 'invalid-json', document: 'account-queue' },
    ]);
    expect(JSON.stringify(captureError.mock.calls)).not.toContain(USER_A);
  });
});

describe('the other calls', () => {
  it('forwards a guest merge to the account store, never through the queue', async () => {
    const { library, remote, queued } = setup();
    const signal = new AbortController().signal;
    const entries = [changed()];

    await library.mergeGuestEntries(entries, { signal });

    expect(remote.mergeGuestEntries).toHaveBeenCalledWith(entries, { signal });
    expect(queued().records).toStrictEqual([]);
  });

  it('notifies every instance of the user until it unsubscribes', async () => {
    const { library, libraryFor, connectivity, listener } = setup();
    const other = jest.fn();
    const unsubscribe = libraryFor(USER_A).subscribeToQueuedWrites(other);
    connectivity.online = false;

    await library.save(changed());
    unsubscribe();
    await library.save(changed());
    await flush();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });
});

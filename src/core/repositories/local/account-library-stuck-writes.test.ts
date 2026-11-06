import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import { LIBRARY_WRITE_FAILURE_LIMIT } from '../../domain/library-sync';
import type { MediaKey } from '../../domain/media';
import { LibraryRemoteError, type LibraryRemoteReason } from '../../errors/library-errors';
import type { OfflineAccountLibraryRepository } from '../offline-account-library-repository';
import {
  USER_A,
  flush,
  setupOfflineLibraries,
  type InMemoryRemote,
} from './__fixtures__/in-memory-remote';
import { readAccountQueue } from './account-library-documents';
import { LIBRARY_REPLAY_RETRY_DELAYS_MS } from './account-library-replay';

// the stuck writes of the offline account library (ADR-0017 "Stuck writes", update of
// 2026-11-04): a write refused alone is marked and no longer sent by a run, a write whose runs keep
// failing unknown is counted and still sent, and the user's retry

const QUEUE_KEY = `account-library-queue.${USER_A}`;
const KEY_1 = keyOf('anime', 1);
const KEY_2 = keyOf('anime', 2);
const KEY_3 = keyOf('anime', 3);
const ALL_RETRIES_MS = LIBRARY_REPLAY_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0);

const entryAt = (key: MediaKey, progress = 1): LibraryEntry =>
  entryOf({
    key,
    progress,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-31T00:00:00.000Z',
  });

const setup = async (keys: readonly MediaKey[] = [KEY_1]) => {
  const offline = setupOfflineLibraries();
  const library = offline.libraryFor(USER_A);
  const remote = offline.remoteOf(USER_A);
  offline.connectivity.online = false;
  for (const key of keys) {
    await library.save(entryAt(key));
  }
  offline.connectivity.online = true;
  const queued = () => readAccountQueue(offline.storage.getString(QUEUE_KEY)).value.records;
  return { ...offline, library, remote, queued };
};

// a run whose every call fails with `reason`, its retries spent
const failRun = async (
  library: OfflineAccountLibraryRepository,
  remote: InMemoryRemote,
  reason: LibraryRemoteReason,
) => {
  for (let call = 0; call <= LIBRARY_REPLAY_RETRY_DELAYS_MS.length; call += 1) {
    remote.failNext('replayWrites', reason);
  }
  const run = library.replayQueuedWrites();
  await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
  return run;
};

describe('a write refused alone', () => {
  it('is marked refused in the queue and counted stuck, the other writes confirmed', async () => {
    const { library, remote, queued } = await setup([KEY_1, KEY_2]);
    remote.refuseKey(KEY_1);

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });

    expect(queued()).toMatchObject([{ seq: 1, refused: true }]);
    expect(library.stuckWriteCount()).toBe(1);
    expect(library.queuedWriteCount()).toBe(1);
    // still shown over the server state
    await expect(library.get(KEY_1)).resolves.toStrictEqual(entryAt(KEY_1));
  });

  it('is sent by no later run, nor by the next launch over the same storage', async () => {
    const { library, remote, storage, remotes } = await setup();
    remote.refuseKey(KEY_1);
    await library.replayQueuedWrites();
    const sent = remote.replayed.length;

    await library.replayQueuedWrites();
    const relaunched = setupOfflineLibraries({ storage, remotes }).libraryFor(USER_A);
    await expect(relaunched.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 0,
    });

    expect(remote.replayed).toHaveLength(sent);
    expect(relaunched.stuckWriteCount()).toBe(1);
  });

  it('is sent by retryStuckWrites at the next launch, and leaves the queue once confirmed', async () => {
    const { library, remote, storage, remotes } = await setup();
    remote.refuseKey(KEY_1);
    await library.replayQueuedWrites();
    remote.acceptKey(KEY_1);
    const relaunched = setupOfflineLibraries({ storage, remotes }).libraryFor(USER_A);

    await expect(relaunched.retryStuckWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });

    expect(relaunched.queuedWriteCount()).toBe(0);
    expect(relaunched.stuckWriteCount()).toBe(0);
    expect(remote.rows.size).toBe(1);
  });

  it('refused again on retry, stays refused and is not sent by the next run', async () => {
    const { library, remote, queued } = await setup();
    remote.refuseKey(KEY_1);
    await library.replayQueuedWrites();
    const sent = remote.replayed.length;

    await expect(library.retryStuckWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 0,
    });
    expect(remote.replayed).toHaveLength(sent + 1);
    expect(queued()).toMatchObject([{ seq: 1, refused: true }]);

    await library.replayQueuedWrites();
    expect(remote.replayed).toHaveLength(sent + 1);
  });

  it('released by a retry while a run is in flight, is sent by its next batch', async () => {
    const { library, remote, connectivity } = await setup();
    remote.refuseKey(KEY_1);
    await library.replayQueuedWrites();
    remote.acceptKey(KEY_1);
    connectivity.online = false;
    await library.save(entryAt(KEY_2));
    connectivity.online = true;
    const gate = remote.holdNext('replayWrites');
    const run = library.replayQueuedWrites();
    await flush();

    const retry = library.retryStuckWrites();
    gate.open();

    await expect(retry).resolves.toStrictEqual({ status: 'done', confirmed: 2 });
    await expect(run).resolves.toStrictEqual({ status: 'done', confirmed: 2 });
    expect(remote.replayed.slice(-2).map((batch) => batch.length)).toStrictEqual([1, 1]);
  });

  it('replaced by a newer write while it was sent, leaves the newer write unmarked', async () => {
    const { library, remote, queued } = await setup();
    const newer = { ...entryAt(KEY_1, 2), updatedAt: '2026-01-01T00:00:00.000Z' };
    jest.spyOn(remote.repository, 'replayWrites').mockImplementationOnce(async () => {
      // its key is being sent: queued for the replay, not tried directly
      await library.save(newer);
      throw new LibraryRemoteError('rejected');
    });
    const listener = jest.fn<() => void>();
    library.subscribeToSyncState(listener);

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });

    expect(queued()).toStrictEqual([]);
    expect(remote.rows.size).toBe(1);
    // the end of the run only
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('a write whose runs fail unknown', () => {
  it('counts one failed run per run, stuck at the limit, still sent by every run', async () => {
    const { library, remote, queued } = await setup();

    for (let run = 1; run <= LIBRARY_WRITE_FAILURE_LIMIT; run += 1) {
      await expect(failRun(library, remote, 'unknown')).resolves.toStrictEqual({
        status: 'failed',
        confirmed: 0,
      });
      expect(queued()).toMatchObject([{ seq: 1, failures: run }]);
      expect(library.stuckWriteCount()).toBe(run < LIBRARY_WRITE_FAILURE_LIMIT ? 0 : 1);
    }
    const sent = remote.replayed.length;

    // the server answers again
    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });
    expect(remote.replayed).toHaveLength(sent + 1);
    expect(queued()).toStrictEqual([]);
    expect(library.stuckWriteCount()).toBe(0);
  });

  it('counts the writes of the batch that failed last only', async () => {
    const { library, remote, queued } = await setup([KEY_1, KEY_2, KEY_3]);
    // the batch of three is refused and sent again one write per call: KEY_1 is confirmed, then
    // every call of KEY_2 fails unknown, and KEY_3 is never sent
    remote.failNext('replayWrites', 'rejected');
    remote.holdNext('replayWrites').open();
    for (let call = 0; call <= LIBRARY_REPLAY_RETRY_DELAYS_MS.length; call += 1) {
      remote.failNext('replayWrites', 'unknown');
    }

    const run = library.replayQueuedWrites();
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);

    await expect(run).resolves.toStrictEqual({ status: 'failed', confirmed: 1 });
    expect(queued()).toStrictEqual([
      expect.objectContaining({ seq: 2, failures: 1 }),
      expect.not.objectContaining({ failures: expect.anything() }),
    ]);
  });

  it('never counts a run ended by network, signed-out or the abort', async () => {
    const { library, remote, queued } = await setup();

    await expect(failRun(library, remote, 'network')).resolves.toMatchObject({ status: 'failed' });
    remote.failNext('replayWrites', 'signed-out');
    await expect(library.replayQueuedWrites()).resolves.toMatchObject({ status: 'signed-out' });
    remote.failNext('replayWrites', 'unknown');
    const controller = new AbortController();
    const aborted = library.replayQueuedWrites({ signal: controller.signal });
    await flush();
    controller.abort();
    await expect(aborted).resolves.toMatchObject({ status: 'aborted' });

    expect(queued()[0]).not.toHaveProperty('failures');
  });

  it('is not counted when the last failure of the run is network', async () => {
    const { library, remote, queued } = await setup();
    for (let call = 0; call < LIBRARY_REPLAY_RETRY_DELAYS_MS.length; call += 1) {
      remote.failNext('replayWrites', 'unknown');
    }
    remote.failNext('replayWrites', 'network');
    const run = library.replayQueuedWrites();
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);

    await expect(run).resolves.toMatchObject({ status: 'failed' });
    expect(queued()[0]).not.toHaveProperty('failures');
  });
});

describe('a newer write of a stuck key', () => {
  it('replaces it: a new seq, neither refused nor counted, sent by the next run', async () => {
    const { library, remote, queued, connectivity } = await setup();
    remote.refuseKey(KEY_1);
    await library.replayQueuedWrites();
    remote.acceptKey(KEY_1);
    const listener = jest.fn<() => void>();
    library.subscribeToSyncState(listener);
    connectivity.online = false;
    const newer = { ...entryAt(KEY_1, 2), updatedAt: '2026-01-01T00:00:00.000Z' };

    await library.save(newer);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(queued()).toStrictEqual([{ seq: 2, write: { type: 'save', entry: newer } }]);
    expect(library.stuckWriteCount()).toBe(0);
    connectivity.online = true;
    await expect(library.replayQueuedWrites()).resolves.toMatchObject({ confirmed: 1 });
  });
});

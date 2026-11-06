import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import { LIBRARY_REPLAY_BATCH_SIZE } from '../../domain/library-sync';
import type { MediaKey } from '../../domain/media';
import type { LibraryReplayRun } from '../offline-account-library-repository';
import { USER_A, flush, setupOfflineLibraries } from './__fixtures__/in-memory-remote';
import { readAccountQueue } from './account-library-documents';
import { LIBRARY_REPLAY_RETRY_DELAYS_MS } from './account-library-replay';

// the failures of a replay run (ADR-0017 "Replay run"): bounded retries with backoff, a stop on
// signed-out, a refused write isolated, the abort, and a run interrupted then run again

const QUEUE_KEY = `account-library-queue.${USER_A}`;
const KEY_1 = keyOf('anime', 1);
const KEY_2 = keyOf('anime', 2);
const KEY_3 = keyOf('anime', 3);

const entryAt = (key: MediaKey, progress = 1): LibraryEntry =>
  entryOf({
    key,
    progress,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-31T00:00:00.000Z',
  });

// a run's outcome, readable before it settles
const track = (run: Promise<LibraryReplayRun>) => {
  const state: { result: LibraryReplayRun | null } = { result: null };
  void run.then((result) => {
    state.result = result;
  });
  return state;
};

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

describe('a network or unknown failure', () => {
  it('is retried after 2 s, 10 s and 30 s, then the run ends failed with the queue kept', async () => {
    const { library, remote, queued, captureError } = await setup();
    for (let failure = 0; failure <= LIBRARY_REPLAY_RETRY_DELAYS_MS.length; failure += 1) {
      remote.failNext('replayWrites', failure % 2 === 0 ? 'network' : 'unknown');
    }
    const run = track(library.replayQueuedWrites());
    await flush();
    expect(remote.replayed).toHaveLength(1);

    for (const [retry, delay] of LIBRARY_REPLAY_RETRY_DELAYS_MS.entries()) {
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(remote.replayed).toHaveLength(retry + 1);
      await jest.advanceTimersByTimeAsync(1);
      expect(remote.replayed).toHaveLength(retry + 2);
    }

    expect(run.result).toStrictEqual({ status: 'failed', confirmed: 0 });
    expect(queued()).toHaveLength(1);
    expect(captureError).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('is retried until the call succeeds', async () => {
    const { library, remote, queued } = await setup();
    remote.failNext('replayWrites', 'network');
    const run = track(library.replayQueuedWrites());

    await jest.advanceTimersByTimeAsync(LIBRARY_REPLAY_RETRY_DELAYS_MS[0] ?? 0);

    expect(run.result).toStrictEqual({ status: 'done', confirmed: 1 });
    expect(queued()).toStrictEqual([]);
  });

  it('ends the run offline when the device went offline before the retry', async () => {
    const { library, remote, connectivity } = await setup();
    remote.failNext('replayWrites', 'network');
    const run = track(library.replayQueuedWrites());
    await flush();
    connectivity.online = false;

    await jest.advanceTimersByTimeAsync(LIBRARY_REPLAY_RETRY_DELAYS_MS[0] ?? 0);

    expect(run.result).toStrictEqual({ status: 'offline', confirmed: 0 });
    expect(remote.replayed).toHaveLength(1);
  });
});

describe('an interrupted run run again', () => {
  it('reaches the same state, never sending again a write it confirmed', async () => {
    const keys = Array.from({ length: LIBRARY_REPLAY_BATCH_SIZE + 1 }, (_, id) =>
      keyOf('anime', id + 1),
    );
    const { library, remote, queued } = await setup(keys);
    // the first batch answers, the second fails on every attempt
    remote.holdNext('replayWrites').open();
    for (let failure = 0; failure <= LIBRARY_REPLAY_RETRY_DELAYS_MS.length; failure += 1) {
      remote.failNext('replayWrites', 'network');
    }
    const interrupted = track(library.replayQueuedWrites());
    await jest.advanceTimersByTimeAsync(
      LIBRARY_REPLAY_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0),
    );
    expect(interrupted.result).toStrictEqual({
      status: 'failed',
      confirmed: LIBRARY_REPLAY_BATCH_SIZE,
    });
    expect(queued()).toHaveLength(1);

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 1,
    });

    expect(queued()).toStrictEqual([]);
    expect(remote.rows.size).toBe(keys.length);
    expect(remote.replayed.map((batch) => batch.length)).toStrictEqual([
      LIBRARY_REPLAY_BATCH_SIZE,
      1,
      1,
      1,
      1,
      1,
    ]);
  });

  it('confirms a write whose answer was lost as kept on the retry', async () => {
    const { library, remote, queued } = await setup();
    remote.loseNextReplayAnswer();
    const run = track(library.replayQueuedWrites());

    await jest.advanceTimersByTimeAsync(LIBRARY_REPLAY_RETRY_DELAYS_MS[0] ?? 0);

    expect(run.result).toStrictEqual({ status: 'done', confirmed: 1 });
    expect(remote.replayed).toHaveLength(2);
    // inserted by the lost call, the retry kept it
    expect([...remote.rows.values()]).toStrictEqual([
      { ...entryAt(KEY_1), createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(queued()).toStrictEqual([]);
  });
});

describe('signed-out', () => {
  it('ends the run at once with the queue kept, never taking a write for refused', async () => {
    const { library, remote, queued } = await setup([KEY_1, KEY_2]);
    remote.failNext('replayWrites', 'signed-out');

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'signed-out',
      confirmed: 0,
    });
    expect(queued()).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 2,
    });
  });
});

describe('a batch the database refuses', () => {
  it('is sent again one write per call: the refused write kept, the others confirmed', async () => {
    const { library, remote, queued, connectivity } = await setup([KEY_1, KEY_2, KEY_3]);
    remote.refuseKey(KEY_2);

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 2,
    });
    expect(remote.replayed.map((batch) => batch.length)).toStrictEqual([3, 1, 1, 1]);
    expect(queued().map(({ seq }) => seq)).toStrictEqual([2]);

    // marked refused: not sent again by a run
    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 0,
    });
    expect(remote.replayed).toHaveLength(4);

    // until a newer change of its key replaces it
    connectivity.online = false;
    await library.save(entryAt(KEY_2, 2));
    connectivity.online = true;
    await library.replayQueuedWrites();
    expect(remote.replayed).toHaveLength(5);
  });
});

describe('an unexpected failure', () => {
  it('ends the run failed, reported with the library-replay source, the queue kept', async () => {
    const { library, remote, queued, captureError } = await setup();
    const bug = new RangeError('queued library write is outside the database limits');
    remote.failNext('replayWrites', bug);

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'failed',
      confirmed: 0,
    });
    expect(captureError).toHaveBeenCalledWith(bug, { source: 'library-replay' });
    expect(queued()).toHaveLength(1);
  });

  it('ends the run failed when the storage fails, reported', async () => {
    const { library, storage, captureError } = await setup();
    const failure = new Error('storage unreadable');
    jest.spyOn(storage, 'getString').mockImplementation(() => {
      throw failure;
    });

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'failed',
      confirmed: 0,
    });
    expect(captureError).toHaveBeenCalledWith(failure, { source: 'library-replay' });
  });
});

describe('the abort', () => {
  it('sends no further call once the batch in flight was confirmed', async () => {
    const keys = Array.from({ length: LIBRARY_REPLAY_BATCH_SIZE + 1 }, (_, id) =>
      keyOf('anime', id + 1),
    );
    const { library, remote, queued } = await setup(keys);
    const controller = new AbortController();
    const gate = remote.holdNext('replayWrites');
    const run = library.replayQueuedWrites({ signal: controller.signal });

    controller.abort();
    gate.open();

    await expect(run).resolves.toStrictEqual({
      status: 'aborted',
      confirmed: LIBRARY_REPLAY_BATCH_SIZE,
    });
    expect(remote.replayed).toHaveLength(1);
    expect(queued()).toHaveLength(1);
  });

  it('cuts the wait for a retry', async () => {
    const { library, remote } = await setup();
    const controller = new AbortController();
    remote.failNext('replayWrites', 'network');
    const run = track(library.replayQueuedWrites({ signal: controller.signal }));
    await flush();

    controller.abort();
    await flush();

    expect(run.result).toStrictEqual({ status: 'aborted', confirmed: 0 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('starts a new run for a call made while an aborted run is settling', async () => {
    const { library, remote } = await setup();
    const controller = new AbortController();
    const gate = remote.holdNext('replayWrites');
    const aborted = library.replayQueuedWrites({ signal: controller.signal });
    controller.abort();
    const next = library.replayQueuedWrites();

    gate.open();

    await expect(aborted).resolves.toStrictEqual({ status: 'aborted', confirmed: 1 });
    await expect(next).resolves.toStrictEqual({ status: 'done', confirmed: 0 });
    expect(remote.replayed).toHaveLength(1);
  });

  it('ends at once for a signal already aborted', async () => {
    const { library, remote } = await setup();

    await expect(
      library.replayQueuedWrites({ signal: AbortSignal.abort() }),
    ).resolves.toStrictEqual({ status: 'aborted', confirmed: 0 });
    expect(remote.replayed).toStrictEqual([]);
  });
});

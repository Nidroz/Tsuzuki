import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import type { MediaKey } from '../../domain/media';
import type { LibraryReplayRun } from '../library-repository';
import { USER_A, flush, setupOfflineLibraries } from './__fixtures__/in-memory-remote';
import { LIBRARY_REPLAY_RETRY_DELAYS_MS } from './account-library-replay';

// calls in flight across the device purge (ADR-0018 "Device purge"): a request already sent
// completes on the server, but its outcome is never stored, and nothing more is sent

const KEY_1 = keyOf('anime', 1);
const KEY_2 = keyOf('anime', 2);
const DOCUMENTS = [`account-library-copy.${USER_A}`, `account-library-queue.${USER_A}`];
const SIGNED_OUT = { name: 'LibraryRemoteError', reason: 'signed-out' };
const ALL_RETRIES_MS = LIBRARY_REPLAY_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);

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

const setup = () => {
  const offline = setupOfflineLibraries();
  const library = offline.libraryFor(USER_A);
  const remote = offline.remoteOf(USER_A);
  const listener = jest.fn();
  library.subscribeToQueuedWrites(listener);
  const documents = (): string[] => DOCUMENTS.filter((key) => offline.storage.values.has(key));
  return { ...offline, library, remote, listener, documents };
};

// two writes queued offline, then back online
const setupQueued = async () => {
  const context = setup();
  context.connectivity.online = false;
  await context.library.save(entryAt(KEY_1));
  await context.library.save(entryAt(KEY_2));
  context.connectivity.online = true;
  context.listener.mockClear();
  return context;
};

describe('direct calls in flight across the purge', () => {
  it('rejects a save confirmed after the purge, storing nothing', async () => {
    const { library, remote, documents } = setup();
    const gate = remote.holdNext('save');
    const saving = library.save(entryAt(KEY_1));
    await flush();

    library.purgeDeviceData();
    gate.open();

    await expect(saving).rejects.toMatchObject(SIGNED_OUT);
    expect(remote.rows.size).toBe(1);
    expect(documents()).toStrictEqual([]);
  });

  it('rejects a save failing after the purge, never queueing it nor notifying', async () => {
    const { library, remote, documents, listener } = setup();
    const gate = remote.holdNext('save');
    const saving = library.save(entryAt(KEY_1));
    await flush();

    library.purgeDeviceData();
    remote.failNext('save', 'network');
    gate.open();

    await expect(saving).rejects.toMatchObject(SIGNED_OUT);
    expect(documents()).toStrictEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each(['list', 'get'] as const)(
    'rejects a %s answered after the purge, writing no copy',
    async (method) => {
      const { library, remote, documents } = setup();
      remote.seed(entryAt(KEY_1));
      const gate = remote.holdNext(method);
      const reading = method === 'list' ? library.list() : library.get(KEY_1);
      await flush();

      library.purgeDeviceData();
      gate.open();

      await expect(reading).rejects.toMatchObject(SIGNED_OUT);
      expect(documents()).toStrictEqual([]);
    },
  );
});

describe('a replay run across the purge', () => {
  it('ends signed-out when its batch is answered after the purge, storing nothing', async () => {
    const { library, remote, documents } = await setupQueued();
    const gate = remote.holdNext('replayWrites');
    const run = library.replayQueuedWrites();
    await flush();

    library.purgeDeviceData();
    gate.open();

    await expect(run).resolves.toStrictEqual({ status: 'signed-out', confirmed: 0 });
    expect(remote.replayed).toHaveLength(1);
    expect(remote.rows.size).toBe(2);
    expect(documents()).toStrictEqual([]);
  });

  it('ends signed-out at once when its batch fails after the purge, sending nothing more', async () => {
    const { library, remote, documents, captureError } = await setupQueued();
    const gate = remote.holdNext('replayWrites');
    remote.loseNextReplayAnswer();
    const run = track(library.replayQueuedWrites());
    await flush();

    library.purgeDeviceData();
    gate.open();
    await flush();

    expect(run.result).toStrictEqual({ status: 'signed-out', confirmed: 0 });
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    expect(remote.replayed).toHaveLength(1);
    expect(documents()).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('ends signed-out at once when purged during its backoff, sending nothing more', async () => {
    const { library, remote, documents } = await setupQueued();
    remote.failNext('replayWrites', 'network');
    const run = track(library.replayQueuedWrites());
    await flush();
    expect(run.result).toBeNull();

    library.purgeDeviceData();
    await flush();

    expect(run.result).toStrictEqual({ status: 'signed-out', confirmed: 0 });
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    expect(remote.replayed).toHaveLength(1);
    expect(documents()).toStrictEqual([]);
  });

  it('answers signed-out to a call joining the run after the purge, sending nothing', async () => {
    const { library, remote } = await setupQueued();
    const gate = remote.holdNext('replayWrites');
    const run = library.replayQueuedWrites();
    await flush();
    library.purgeDeviceData();

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'signed-out',
      confirmed: 0,
    });
    gate.open();
    await expect(run).resolves.toMatchObject({ status: 'signed-out' });
    expect(remote.replayed).toHaveLength(1);
  });
});

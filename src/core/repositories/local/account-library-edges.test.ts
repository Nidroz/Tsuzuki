import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import { LibraryRemoteError } from '../../errors/library-errors';
import { USER_A, setupOfflineLibraries } from './__fixtures__/in-memory-remote';
import { readAccountQueue } from './account-library-documents';

// the edges of the offline account library: reads overlapping writes and other reads, the last
// representable time, and a replay answer that does not match its batch

const COPY_KEY = `account-library-copy.${USER_A}`;
const QUEUE_KEY = `account-library-queue.${USER_A}`;
const OTHER_KEY = keyOf('manga', 8);

const at = (updatedAt: string, overrides: Partial<LibraryEntry> = {}): LibraryEntry =>
  entryOf({ createdAt: '2025-12-01T00:00:00.000Z', updatedAt, ...overrides });

const STORED = at('2025-12-10T00:00:00.000Z');
const OTHER = at('2025-12-20T00:00:00.000Z', { key: OTHER_KEY });

const setup = () => {
  const offline = setupOfflineLibraries();
  const library = offline.libraryFor(USER_A);
  const remote = offline.remoteOf(USER_A);
  remote.seed(STORED, OTHER);
  const queued = () => readAccountQueue(offline.storage.getString(QUEUE_KEY)).value.records;
  return { ...offline, library, remote, queued };
};

describe('reads overlapping writes', () => {
  it('keeps, for each of two overlapping reads, the states confirmed since it began', async () => {
    const { library, remote } = setup();
    const listGate = remote.holdNext('list');
    const listing = library.list();
    const saved = await library.save(at('2025-12-31T00:00:00.000Z', { progress: 20 }));
    const getGate = remote.holdNext('get');
    const getting = library.get(OTHER_KEY);
    await library.remove(OTHER_KEY);

    getGate.open();
    await expect(getting).resolves.toBeNull();
    listGate.open();

    await expect(listing).resolves.toStrictEqual([saved]);
  });

  it('answers a write of its key queued while the get was in flight', async () => {
    const { library, remote } = setup();
    const gate = remote.holdNext('get');
    const getting = library.get(OTHER_KEY);
    remote.failNext('remove', 'network');
    await library.remove(OTHER_KEY);

    gate.open();

    await expect(getting).resolves.toBeNull();
  });

  it('answers a write queued while an unreachable get was in flight, without a copy', async () => {
    const { library, remote, connectivity } = setup();
    const queuedEntry = at('2025-12-31T00:00:00.000Z', { key: OTHER_KEY });
    jest.spyOn(remote.repository, 'get').mockImplementationOnce(async () => {
      connectivity.online = false;
      await library.save(queuedEntry);
      connectivity.online = true;
      throw new LibraryRemoteError('network');
    });

    await expect(library.get(OTHER_KEY)).resolves.toStrictEqual(queuedEntry);
  });

  it('leaves the copy document alone for a confirmed removal of a key it does not hold', async () => {
    const { library, storage } = setup();
    await library.list();
    const set = jest.spyOn(storage, 'set');

    await library.remove(keyOf('anime', 3));

    expect(set.mock.calls.map(([key]) => key)).not.toContain(COPY_KEY);
  });
});

describe('the last representable time', () => {
  it('refuses a save that would be timed after it, queueing nothing', async () => {
    const { library, remote, queued } = setup();
    remote.seed(at('9999-12-31T23:59:59.999Z'));
    await library.list();

    await expect(library.save(at('2025-12-31T00:00:00.000Z'))).rejects.toThrow(
      new RangeError('library entry is outside the database limits'),
    );
    expect(queued()).toStrictEqual([]);
  });
});

describe('a replay answer that does not match its batch', () => {
  it('ends the run failed, reported, the queue kept', async () => {
    const { library, remote, connectivity, queued, captureError } = setup();
    connectivity.online = false;
    await library.save(STORED);
    connectivity.online = true;
    jest.spyOn(remote.repository, 'replayWrites').mockResolvedValueOnce([]);

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'failed',
      confirmed: 0,
    });
    expect(captureError).toHaveBeenCalledWith(expect.any(RangeError), {
      source: 'library-replay',
    });
    expect(queued()).toHaveLength(1);
  });
});

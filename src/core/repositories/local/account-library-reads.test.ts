import { describe, expect, it } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import { USER_A, USER_B, setupOfflineLibraries } from './__fixtures__/in-memory-remote';
import { readAccountCopy } from './account-library-documents';

// the reads of the offline account library (ADR-0017 "Reads"): the queue over the server state
// (read your writes), the device copy offline or when the server is unreachable, and the copy
// created by a complete list only

const COPY_KEY = `account-library-copy.${USER_A}`;
const OTHER_KEY = keyOf('manga', 8);
const THIRD_KEY = keyOf('anime', 3);

const at = (updatedAt: string, overrides: Partial<LibraryEntry> = {}): LibraryEntry =>
  entryOf({ createdAt: '2025-12-01T00:00:00.000Z', updatedAt, ...overrides });

const STORED = at('2025-12-10T00:00:00.000Z');
const OTHER = at('2025-12-20T00:00:00.000Z', { key: OTHER_KEY });

const setup = () => {
  const offline = setupOfflineLibraries();
  const library = offline.libraryFor(USER_A);
  const remote = offline.remoteOf(USER_A);
  remote.seed(STORED, OTHER);
  const copy = () => readAccountCopy(offline.storage.getString(COPY_KEY)).value;
  return { ...offline, library, remote, copy };
};

describe('list', () => {
  it('online, replaces the copy and returns it with the queued writes over it', async () => {
    const { library, connectivity, copy } = setup();
    connectivity.online = false;
    const queued = at('2025-12-31T00:00:00.000Z', { key: THIRD_KEY });
    await library.save(queued);
    await library.remove(OTHER_KEY);
    connectivity.online = true;

    await expect(library.list()).resolves.toStrictEqual([queued, STORED]);
    expect(copy()).toStrictEqual([OTHER, STORED]);
  });

  it('offline, reads the copy with the queued writes over it, in list order', async () => {
    const { library, remote, connectivity } = setup();
    await library.list();
    connectivity.online = false;
    const changed = at('2025-12-30T00:00:00.000Z', { progress: 20 });

    await library.save(changed);

    await expect(library.list()).resolves.toStrictEqual([changed, OTHER]);
    expect(remote.calls).toStrictEqual(['list']);
  });

  it('offline without a copy, rejects with network and sends nothing', async () => {
    const { library, remote, connectivity } = setup();
    connectivity.online = false;

    await expect(library.list()).rejects.toMatchObject({ reason: 'network' });
    expect(remote.calls).toStrictEqual([]);
  });

  it('falls back to the copy when the server is unreachable', async () => {
    const { library, remote } = setup();
    remote.failNext('list', 'network');
    await expect(library.list()).rejects.toMatchObject({ reason: 'network' });
    await library.list();
    remote.failNext('list', 'network');
    remote.seed(at('2025-12-31T00:00:00.000Z', { key: THIRD_KEY }));

    await expect(library.list()).resolves.toStrictEqual([OTHER, STORED]);
  });

  it.each(['signed-out', 'rejected', 'invalid-row'] as const)(
    'rejects with %s, the copy untouched',
    async (reason) => {
      const { library, remote, copy } = setup();
      await library.list();
      remote.failNext('list', reason);

      await expect(library.list()).rejects.toMatchObject({ reason });
      expect(copy()).toStrictEqual([OTHER, STORED]);
    },
  );

  it('keeps the confirmed state of a key written while the list was in flight', async () => {
    const { library, remote, copy } = setup();
    const gate = remote.holdNext('list');
    const listing = library.list();
    const saved = await library.save(at('2025-12-31T00:00:00.000Z', { progress: 20 }));
    await library.remove(OTHER_KEY);

    gate.open();

    await expect(listing).resolves.toStrictEqual([saved]);
    expect(copy()).toStrictEqual([saved]);
  });
});

describe('get', () => {
  it('answers a queued write of the key without a request (read your writes)', async () => {
    const { library, remote, connectivity } = setup();
    connectivity.online = false;
    const queued = at('2025-12-31T00:00:00.000Z');
    await library.save(queued);
    await library.remove(OTHER_KEY);
    connectivity.online = true;

    await expect(library.get(STORED.key)).resolves.toStrictEqual(queued);
    await expect(library.get(OTHER_KEY)).resolves.toBeNull();
    expect(remote.calls).toStrictEqual([]);
  });

  it('offline, reads the copy, null for a key it does not hold', async () => {
    const { library, connectivity } = setup();
    await library.list();
    connectivity.online = false;

    await expect(library.get(OTHER_KEY)).resolves.toStrictEqual(OTHER);
    await expect(library.get(THIRD_KEY)).resolves.toBeNull();
  });

  it('offline or unreachable without a copy, rejects with network', async () => {
    const { library, remote, connectivity } = setup();
    remote.failNext('get', 'network');

    await expect(library.get(OTHER_KEY)).rejects.toMatchObject({ reason: 'network' });
    connectivity.online = false;
    await expect(library.get(OTHER_KEY)).rejects.toMatchObject({ reason: 'network' });
  });

  it('online, updates an existing copy for its key, and never creates one', async () => {
    const { library, remote, copy } = setup();
    await expect(library.get(OTHER_KEY)).resolves.toStrictEqual(OTHER);
    expect(copy()).toBeNull();
    await library.list();
    const changed = at('2025-12-31T00:00:00.000Z', { key: OTHER_KEY, progress: 30 });
    remote.seed(changed);
    remote.rows.delete('mal:anime:52991');

    await expect(library.get(OTHER_KEY)).resolves.toStrictEqual(changed);
    await expect(library.get(STORED.key)).resolves.toBeNull();

    expect(copy()).toStrictEqual([changed]);
  });

  it('rejects with signed-out', async () => {
    const { library, remote } = setup();
    remote.failNext('get', 'signed-out');

    await expect(library.get(OTHER_KEY)).rejects.toMatchObject({ reason: 'signed-out' });
  });

  it('answers the state of its key confirmed while it was in flight', async () => {
    const { library, remote, copy } = setup();
    await library.list();
    const gate = remote.holdNext('get');
    const getting = library.get(OTHER_KEY);
    await library.remove(OTHER_KEY);

    gate.open();

    await expect(getting).resolves.toBeNull();
    expect(copy()).toStrictEqual([STORED]);
  });
});

describe('a direct write confirmed', () => {
  it('updates an existing copy, and never creates one', async () => {
    const { library, copy } = setup();
    const first = await library.save(at('2025-12-31T00:00:00.000Z', { key: THIRD_KEY }));
    expect(copy()).toBeNull();
    await library.list();

    await library.remove(THIRD_KEY);
    const saved = await library.save(at('2025-12-31T00:00:00.000Z', { progress: 1 }));

    expect(first.key).toStrictEqual(THIRD_KEY);
    expect(copy()).toStrictEqual([saved, OTHER]);
  });
});

describe('two users on one device', () => {
  it('never shows a user the copy or the queued writes of another user', async () => {
    const { library, libraryFor, connectivity, storage } = setup();
    await library.list();
    connectivity.online = false;
    await library.save(at('2025-12-31T00:00:00.000Z', { key: THIRD_KEY }));
    const stored = new Map(storage.values);
    const other = libraryFor(USER_B);

    await expect(other.list()).rejects.toMatchObject({ reason: 'network' });
    await expect(other.get(THIRD_KEY)).rejects.toMatchObject({ reason: 'network' });
    connectivity.online = true;
    await expect(other.list()).resolves.toStrictEqual([]);

    expect(storage.values.get(`account-library-queue.${USER_A}`)).toBe(
      stored.get(`account-library-queue.${USER_A}`),
    );
    expect(storage.values.get(COPY_KEY)).toBe(stored.get(COPY_KEY));
  });
});

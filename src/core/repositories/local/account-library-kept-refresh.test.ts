import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import type { MediaKey } from '../../domain/media';
import { LibraryRemoteError } from '../../errors/library-errors';
import { USER_A, flush, setupOfflineLibraries } from './__fixtures__/in-memory-remote';

// the refresh of the keys a replay confirmed as kept (ADR-0017 "`kept` replay", update of
// 2026-11-04): the device copy takes the server's version, so an offline read shows it

const COPY_KEY = `account-library-copy.${USER_A}`;
const KEY_1 = keyOf('anime', 1);
const KEY_2 = keyOf('anime', 2);

const at = (key: MediaKey, progress: number, updatedAt: string): LibraryEntry =>
  entryOf({ key, progress, createdAt: '2025-12-01T00:00:00.000Z', updatedAt });

// the state the device saw, the offline change, and the newer change of another device
const SEEN = [KEY_1, KEY_2].map((key) => at(key, 1, '2025-12-10T00:00:00.000Z'));
const OFFLINE = [KEY_1, KEY_2].map((key) => at(key, 5, '2025-12-20T00:00:00.000Z'));
const SERVER = [KEY_1, KEY_2].map((key) => at(key, 9, '2025-12-25T00:00:00.000Z'));

// a device copy of SEEN (unless `withCopy` is false), the OFFLINE changes of `count` keys
// queued, and the server holding the newer SERVER changes, so each replayed write is kept
const setup = async ({ count = 1, withCopy = true } = {}) => {
  const offline = setupOfflineLibraries();
  const library = offline.libraryFor(USER_A);
  const remote = offline.remoteOf(USER_A);
  remote.seed(...SEEN);
  if (withCopy) {
    await library.list();
  }
  offline.connectivity.online = false;
  for (const entry of OFFLINE.slice(0, count)) {
    await library.save(entry);
  }
  remote.seed(...SERVER);
  offline.connectivity.online = true;
  const gets = () => remote.calls.filter((method) => method === 'get').length;
  return { ...offline, library, remote, gets };
};

describe('a write confirmed as kept', () => {
  it("has its key read again, so offline reads show the server's version", async () => {
    const { library, connectivity, gets } = await setup({ count: 2 });

    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'done',
      confirmed: 2,
    });
    expect(gets()).toBe(2);
    connectivity.online = false;

    await expect(library.get(KEY_1)).resolves.toStrictEqual(SERVER[0]);
    await expect(library.list()).resolves.toStrictEqual([SERVER[0], SERVER[1]]);
  });

  it('never creates a copy the device did not have', async () => {
    const { library, storage, gets } = await setup({ withCopy: false });

    await library.replayQueuedWrites();

    expect(gets()).toBe(1);
    expect(storage.getString(COPY_KEY)).toBeUndefined();
  });

  it.each([
    { label: 'unknown', failure: new LibraryRemoteError('unknown'), reads: 2 },
    { label: 'invalid-row', failure: new LibraryRemoteError('invalid-row'), reads: 2 },
    {
      label: 'network, which stops the refresh',
      failure: new LibraryRemoteError('network'),
      reads: 1,
    },
    {
      label: 'signed-out, which stops the refresh',
      failure: new LibraryRemoteError('signed-out'),
      reads: 1,
    },
  ])(
    'failing with $label, keeps the previous copy entry and the status, unreported',
    async ({ failure, reads }) => {
      const { library, remote, connectivity, captureError, gets } = await setup({ count: 2 });
      remote.failNext('get', failure);

      await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
        status: 'done',
        confirmed: 2,
      });

      expect(gets()).toBe(reads);
      expect(captureError).not.toHaveBeenCalled();
      connectivity.online = false;
      await expect(library.get(KEY_1)).resolves.toStrictEqual(SEEN[0]);
    },
  );

  it('failing with an error the account store did not map, is reported, the copy kept', async () => {
    const { library, remote, connectivity, captureError } = await setup();
    const bug = new TypeError('store bug');
    remote.failNext('get', bug);

    await expect(library.replayQueuedWrites()).resolves.toMatchObject({ status: 'done' });

    expect(captureError).toHaveBeenCalledWith(bug, { source: 'library-replay' });
    connectivity.online = false;
    await expect(library.get(KEY_1)).resolves.toStrictEqual(SEEN[0]);
  });

  it('keeps a state confirmed while its read was in flight', async () => {
    const { library, remote, connectivity } = await setup();
    const gate = remote.holdNext('get');
    const run = library.replayQueuedWrites();
    await flush();
    const saved = await library.save(at(KEY_1, 12, '2025-12-30T00:00:00.000Z'));

    gate.open();
    await run;

    connectivity.online = false;
    await expect(library.get(KEY_1)).resolves.toStrictEqual(saved);
  });
});

describe('no refresh', () => {
  it('when the run was aborted', async () => {
    const { library, remote, gets } = await setup();
    const controller = new AbortController();
    const gate = remote.holdNext('replayWrites');
    const run = library.replayQueuedWrites({ signal: controller.signal });

    controller.abort();
    gate.open();

    await expect(run).resolves.toStrictEqual({ status: 'aborted', confirmed: 1 });
    expect(gets()).toBe(0);
  });

  it('once the purge closed the coordination, nor any answer stored', async () => {
    const { library, remote, storage, gets } = await setup({ count: 2 });
    const gate = remote.holdNext('get');
    const run = library.replayQueuedWrites();
    await flush();
    expect(gets()).toBe(1);

    library.purgeDeviceData();
    const set = jest.spyOn(storage, 'set');
    gate.open();

    await expect(run).resolves.toStrictEqual({ status: 'signed-out', confirmed: 2 });
    expect(gets()).toBe(1);
    expect(set).not.toHaveBeenCalled();
  });
});

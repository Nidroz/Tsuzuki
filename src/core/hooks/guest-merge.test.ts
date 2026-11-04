import { describe, expect, it, jest } from '@jest/globals';

import {
  createDeferred,
  createFakeAccountLibraryRepository,
  createFakeGuestLibraryRepository,
  holdNextCall,
  mergedCopyOf,
} from '../../../test/core/fake-library-repository';
import { entryOf, keyOf } from '../../../test/core/library-entry-fixtures';
import { LibraryRemoteError } from '../errors/library-errors';
import { mergeGuestLibrary, type GuestMergeRun } from './guest-merge';

// bR-08, FR-22, ADR-0016: one run of the guest merge, its steps and the session checks between them

const FRIEREN = entryOf();
const BERSERK = entryOf({ key: keyOf('manga', 2), progress: 3 });
const MONSTER = entryOf({ key: keyOf('manga', 3), progress: 1 });

// a run over fakes holding `guestEntries`, every step logged in call order
const setUp = (guestEntries = [FRIEREN, BERSERK], currentChecks: readonly boolean[] = []) => {
  const guest = createFakeGuestLibraryRepository(guestEntries);
  const account = createFakeAccountLibraryRepository();
  const log: string[] = [];
  guest.beforeCall.mockImplementation((method) => {
    log.push(`guest.${method}`);
    return Promise.resolve();
  });
  account.beforeCall.mockImplementation((method) => {
    log.push(`account.${method}`);
    return Promise.resolve();
  });
  // true unless the test lists the answers of the successive checks
  const answers = [...currentChecks];
  const isCurrent = jest.fn(() => answers.shift() ?? true);
  const run: GuestMergeRun = {
    guest,
    account,
    settleWrites: jest.fn(() => {
      log.push('settleWrites');
      return Promise.resolve();
    }),
    isCurrent,
    signal: new AbortController().signal,
    onMerging: jest.fn(() => {
      log.push('onMerging');
    }),
    onCleanupFailed: jest.fn<(error: unknown) => void>(),
  };
  return { guest, account, log, run, isCurrent };
};

describe('mergeGuestLibrary (BR-08)', () => {
  it('waits for the writes, lists, merges, then removes exactly the listed entries', async () => {
    const { guest, account, log, run } = setUp();

    await expect(mergeGuestLibrary(run)).resolves.toBe('merged');

    expect(log).toStrictEqual([
      'settleWrites',
      'guest.list',
      'onMerging',
      'account.mergeGuestEntries',
      'guest.removeUnchanged',
    ]);
    expect(account.mergeGuestEntries).toHaveBeenCalledWith([FRIEREN, BERSERK], {
      signal: run.signal,
    });
    const merged = account.mergeGuestEntries.mock.calls[0]?.[0];
    expect(guest.removeUnchanged.mock.calls[0]?.[0]).toBe(merged);
    // its time after the clock is capped at the merge time, as the account store's database does
    expect(account.stored(BERSERK.key)).toStrictEqual(
      mergedCopyOf(BERSERK, new Date().toISOString()),
    );
    await expect(guest.list()).resolves.toStrictEqual([]);
    expect(run.onCleanupFailed).not.toHaveBeenCalled();
  });

  it('reads the guest store only once the pending writes settled', async () => {
    const { guest, run } = setUp();
    const writes = createDeferred();

    const merging = mergeGuestLibrary({ ...run, settleWrites: () => writes.promise });
    await jest.advanceTimersByTimeAsync(0);

    expect(guest.list).not.toHaveBeenCalled();
    writes.resolve();
    await expect(merging).resolves.toBe('merged');
  });

  it('calls nothing on the account for an empty guest store', async () => {
    const { account, log, run } = setUp([]);

    await expect(mergeGuestLibrary(run)).resolves.toBe('empty');

    expect(log).toStrictEqual(['settleWrites', 'guest.list']);
    expect(account.beforeCall).not.toHaveBeenCalled();
  });

  it.each([
    { after: 'the writes settled', checks: [false], steps: ['settleWrites'] },
    {
      after: 'the guest store was listed',
      checks: [true, false],
      steps: ['settleWrites', 'guest.list'],
    },
  ])(
    'stops without an account call when the session changed once $after',
    async ({ checks, steps }) => {
      const { guest, account, log, run } = setUp([FRIEREN], checks);

      await expect(mergeGuestLibrary(run)).resolves.toBe('stale');

      expect(log).toStrictEqual(steps);
      expect(account.beforeCall).not.toHaveBeenCalled();
      expect(guest.stored(FRIEREN.key)).toStrictEqual(FRIEREN);
    },
  );

  it('keeps the guest entries when the session changed during the merge', async () => {
    const { guest, log, run, isCurrent } = setUp([FRIEREN], [true, true, false]);

    await expect(mergeGuestLibrary(run)).resolves.toBe('stale');

    expect(isCurrent).toHaveBeenCalledTimes(3);
    expect(log.at(-1)).toBe('account.mergeGuestEntries');
    expect(guest.removeUnchanged).not.toHaveBeenCalled();
    expect(guest.stored(FRIEREN.key)).toStrictEqual(FRIEREN);
  });

  it('keeps an entry changed or added on the device while the merge ran', async () => {
    const { guest, account, run } = setUp([FRIEREN, BERSERK]);
    const merge = holdNextCall(account, 'mergeGuestEntries');
    const changed = { ...BERSERK, progress: 4, updatedAt: '2026-03-01T00:00:00.000Z' };

    const merging = mergeGuestLibrary(run);
    await jest.advanceTimersByTimeAsync(0);
    await guest.save(changed);
    await guest.save(MONSTER);
    merge.resolve();

    await expect(merging).resolves.toBe('merged');
    await expect(guest.list()).resolves.toStrictEqual([changed, MONSTER]);
  });

  it('rejects with the merge failure and removes nothing', async () => {
    const { guest, account, run } = setUp([FRIEREN]);
    const failure = new LibraryRemoteError('network');
    account.beforeCall.mockRejectedValueOnce(failure);

    await expect(mergeGuestLibrary(run)).rejects.toBe(failure);

    expect(guest.removeUnchanged).not.toHaveBeenCalled();
    expect(guest.stored(FRIEREN.key)).toStrictEqual(FRIEREN);
    expect(run.onCleanupFailed).not.toHaveBeenCalled();
  });

  it('rejects with a guest store failure, before any account call', async () => {
    const { guest, account, run } = setUp([FRIEREN]);
    const failure = new Error('storage failure');
    guest.beforeCall.mockRejectedValueOnce(failure);

    await expect(mergeGuestLibrary(run)).rejects.toBe(failure);

    expect(account.beforeCall).not.toHaveBeenCalled();
  });

  it('ends merged when the merged entries could not be removed, giving the failure to onCleanupFailed', async () => {
    const { guest, account, run } = setUp([FRIEREN]);
    const failure = new Error('storage failure');
    guest.removeUnchanged.mockRejectedValueOnce(failure);

    await expect(mergeGuestLibrary(run)).resolves.toBe('merged');

    expect(run.onCleanupFailed).toHaveBeenCalledTimes(1);
    expect(run.onCleanupFailed).toHaveBeenCalledWith(failure);
    expect(account.stored(FRIEREN.key)).toStrictEqual(
      mergedCopyOf(FRIEREN, new Date().toISOString()),
    );
    // kept on the device: the next merge sends it again (kept by the account) and removes it
    expect(guest.stored(FRIEREN.key)).toStrictEqual(FRIEREN);
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import {
  holdNextCall,
  mergedCopyOf,
  type Deferred,
} from '../../../test/core/fake-library-repository';
import { ENTRY_KEY, entryOf, keyOf } from '../../../test/core/library-entry-fixtures';
import {
  MEDIA,
  renderSessionLibrary,
  settleSession,
  USER_A,
  type RenderedSessionLibrary,
} from '../../../test/core/library-hooks-support';
import type { LibraryEntry } from '../domain/library-entry';
import { PROGRESS_WRITE_COALESCE_MS } from '../domain/library-progress';
import { LibraryRemoteError } from '../errors/library-errors';
import { PENDING_LIBRARY_REPOSITORY } from './SessionLibraryContextProvider';

// bR-08, ADR-0016: a failed guest merge keeps the library pending (no read, no write of the
// account) with the failure and the guest store kept, until a retry (or the next launch or sign
// in) merges it

// the guest entry of ENTRY_KEY, changed on the device after the account's (both before the fixed
// clock, the server's now: a merge keeps the guest time), and one of a media the account lacks
// (its time after the clock: a merge caps it at the clock)
const GUEST_ENTRY = entryOf({
  progress: 1,
  createdAt: '2025-11-02T00:00:00.000Z',
  updatedAt: '2025-12-20T00:00:00.000Z',
});
const GUEST_OTHER = entryOf({ key: keyOf('manga', 2), progress: 4 });
const ENTRY_A = entryOf({
  progress: 2,
  createdAt: '2025-11-01T00:00:00.000Z',
  updatedAt: '2025-12-01T00:00:00.000Z',
});
const ACCOUNT_ENTRIES: ReadonlyMap<string, readonly LibraryEntry[]> = new Map([
  [USER_A, [ENTRY_A]],
]);
// longer than any write or read of the fakes: what is pending then stays pending
const LONG_WAIT_MS = 60_000;

// signed out with both guest entries; each account's first merge held
const renderHeld = async () => {
  const merges: Deferred<void>[] = [];
  const rendered = await renderSessionLibrary({
    guestEntries: [GUEST_ENTRY, GUEST_OTHER],
    accountEntries: ACCOUNT_ENTRIES,
    onAccount: (_userId, account) => {
      merges.push(holdNextCall(account, 'mergeGuestEntries'));
    },
  });
  return { ...rendered, merges };
};

// releases or fails a held call, its consequences settled inside act: the merge steps, then the
// read of the library shown next
const release = async (held: Deferred<void> | undefined, failure?: unknown) => {
  await act(async () => {
    if (failure === undefined) {
      held?.resolve();
    } else {
      held?.reject(failure);
    }
    await jest.advanceTimersByTimeAsync(0);
  });
  await settleSession();
};

const retry = async (rendered: RenderedSessionLibrary) => {
  await act(async () => {
    rendered.result.current.merge.retry();
    await jest.advanceTimersByTimeAsync(0);
  });
  await settleSession();
};

// the library is the pending one: nothing of the account is read
const expectPendingLibrary = (rendered: RenderedSessionLibrary) => {
  expect(rendered.result.current.repository).toBe(PENDING_LIBRARY_REPOSITORY);
  expect(rendered.result.current.entry.isPending).toBe(true);
};

describe('SessionLibraryContextProvider failed guest merge (A-04)', () => {
  it('keeps the library pending with the failure and the guest store, then merges on retry and shows the account library', async () => {
    const rendered = await renderHeld();
    await rendered.emit({ userId: USER_A });
    const account = rendered.accountOf(0);

    await release(rendered.merges[0], new LibraryRemoteError('network'));
    await settleSession(LONG_WAIT_MS);

    expect(rendered.result.current.merge.status).toBe('failed');
    expectPendingLibrary(rendered);
    expect(account.list).not.toHaveBeenCalled();
    expect(account.get).not.toHaveBeenCalled();
    expect(rendered.guest.removeUnchanged).not.toHaveBeenCalled();
    expect(rendered.guest.stored(ENTRY_KEY)).toStrictEqual(GUEST_ENTRY);
    expect(rendered.guest.stored(GUEST_OTHER.key)).toStrictEqual(GUEST_OTHER);
    // the account store reports its own failures
    expect(rendered.captureError).not.toHaveBeenCalled();
    const from = rendered.frames.length;
    const retried = holdNextCall(account, 'mergeGuestEntries');

    await retry(rendered);

    expect(rendered.result.current.merge.status).toBe('merging');
    expect(rendered.result.current.repository).toBe(PENDING_LIBRARY_REPOSITORY);
    await release(retried);
    const mergedAt = new Date().toISOString();
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.result.current.repository).toBe(account);
    expect(rendered.result.current.entry.data).toStrictEqual(
      mergedCopyOf(GUEST_ENTRY, mergedAt, ENTRY_A),
    );
    expect(account.mergeGuestEntries).toHaveBeenCalledTimes(2);
    expect(rendered.guest.removeUnchanged).toHaveBeenCalledWith([GUEST_ENTRY, GUEST_OTHER]);
    expect(rendered.guest.stored(ENTRY_KEY)).toBeNull();
    expect(rendered.guest.stored(GUEST_OTHER.key)).toBeNull();
    expect(rendered.shownSince(from)).toStrictEqual([
      'checking pending',
      'merging pending',
      'idle account 0',
    ]);
  });

  it('computes no write on the account lacking a guest entry after a failed merge, then merges that entry whole on retry (BR-08)', async () => {
    // a guest entry the account lacks, last changed on the device before the sign in
    const guestOnly = entryOf({
      progress: 10,
      notes: 'paused at the festival arc',
      startedAt: '2025-11-02',
      createdAt: '2025-11-02T10:00:00.000Z',
      updatedAt: '2025-12-20T10:00:00.000Z',
    });
    const rendered = await renderSessionLibrary({
      guestEntries: [guestOnly],
      media: MEDIA,
      onAccount: (_userId, account) => {
        account.mergeGuestEntries.mockRejectedValueOnce(new LibraryRemoteError('network'));
      },
    });
    await rendered.emit({ userId: USER_A });
    const account = rendered.accountOf(0);
    expect(rendered.result.current.merge.status).toBe('failed');
    expectPendingLibrary(rendered);

    // the detail's Add, `+1` and heart while the merge failed: no loaded entry, no write
    await act(async () => {
      rendered.result.current.actions.add();
      rendered.result.current.actions.incrementProgress();
      rendered.result.current.actions.toggleFavorite();
      await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS + LONG_WAIT_MS);
    });

    expectPendingLibrary(rendered);
    for (const method of [account.list, account.get, account.save, account.remove]) {
      expect(method).not.toHaveBeenCalled();
    }
    expect(account.stored(ENTRY_KEY)).toBeNull();
    expect(rendered.guest.save).not.toHaveBeenCalled();
    expect(rendered.guest.stored(ENTRY_KEY)).toStrictEqual(guestOnly);

    await retry(rendered);

    // inserted with its progress, notes and device time, created at the merge time; then the
    // account library shows it
    const merged = mergedCopyOf(guestOnly, new Date().toISOString());
    expect(account.stored(ENTRY_KEY)).toStrictEqual(merged);
    expect(rendered.guest.stored(ENTRY_KEY)).toBeNull();
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.result.current.repository).toBe(account);
    expect(rendered.result.current.entry.data).toStrictEqual(merged);
    expect(rendered.result.current.actions.error).toBeNull();
    expect(account.save).not.toHaveBeenCalled();
  });

  it('gives the merged account library when a merge that failed part way is retried', async () => {
    const rendered = await renderSessionLibrary({
      guestEntries: [GUEST_ENTRY, GUEST_OTHER],
      accountEntries: ACCOUNT_ENTRIES,
      onAccount: (_userId, account) => {
        // the first merge writes the first entry, then fails
        const merge = account.mergeGuestEntries.getMockImplementation();
        account.mergeGuestEntries.mockImplementationOnce(async ([first]) => {
          await merge?.(first === undefined ? [] : [first]);
          throw new LibraryRemoteError('network');
        });
      },
    });
    await rendered.emit({ userId: USER_A });
    const account = rendered.accountOf(0);
    const mergedAt = new Date().toISOString();
    expect(rendered.result.current.merge.status).toBe('failed');
    expectPendingLibrary(rendered);
    expect(account.stored(ENTRY_KEY)).toStrictEqual(mergedCopyOf(GUEST_ENTRY, mergedAt, ENTRY_A));
    expect(account.stored(GUEST_OTHER.key)).toBeNull();

    await retry(rendered);

    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.result.current.repository).toBe(account);
    expect(account.stored(ENTRY_KEY)).toStrictEqual(mergedCopyOf(GUEST_ENTRY, mergedAt, ENTRY_A));
    expect(account.stored(GUEST_OTHER.key)).toStrictEqual(mergedCopyOf(GUEST_OTHER, mergedAt));
    expect(rendered.guest.stored(ENTRY_KEY)).toBeNull();
    expect(rendered.guest.stored(GUEST_OTHER.key)).toBeNull();
  });

  it('ignores a retry while the merge runs, and runs one merge for two retries in a row', async () => {
    const rendered = await renderHeld();
    await rendered.emit({ userId: USER_A });
    const account = rendered.accountOf(0);

    await retry(rendered);

    expect(rendered.result.current.merge.status).toBe('merging');
    expect(account.mergeGuestEntries).toHaveBeenCalledTimes(1);

    await release(rendered.merges[0], new LibraryRemoteError('network'));
    const retried = holdNextCall(account, 'mergeGuestEntries');
    await act(async () => {
      rendered.result.current.merge.retry();
      rendered.result.current.merge.retry();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(rendered.result.current.merge.status).toBe('merging');
    expect(account.mergeGuestEntries).toHaveBeenCalledTimes(2);
    expect(rendered.guest.list).toHaveBeenCalledTimes(2);
    await release(retried);
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(account.mergeGuestEntries).toHaveBeenCalledTimes(2);
  });

  it('ignores a retry once the merge concluded', async () => {
    const rendered = await renderSessionLibrary({ guestEntries: [GUEST_ENTRY] });
    await rendered.emit({ userId: USER_A });
    const account = rendered.accountOf(0);
    expect(rendered.result.current.merge.status).toBe('idle');

    await retry(rendered);

    expect(rendered.result.current.repository).toBe(account);
    expect(rendered.guest.list).toHaveBeenCalledTimes(1);
    expect(account.mergeGuestEntries).toHaveBeenCalledTimes(1);
  });

  it.each([
    { step: 'the guest store read', repository: 'guest', method: 'list' },
    { step: 'the merge input check', repository: 'account', method: 'mergeGuestEntries' },
    { step: 'the merged entries removal', repository: 'guest', method: 'removeUnchanged' },
  ] as const)(
    'reports a failure of $step with the guest-merge source only, and shows it',
    async ({ repository, method }) => {
      const rendered = await renderHeld();
      const failure = method === 'list' ? new Error('storage failure') : new RangeError('invalid');
      const guestCall = repository === 'guest' ? holdNextCall(rendered.guest, method) : undefined;
      await rendered.emit({ userId: USER_A });

      // the account merge goes on, or fails; then the guest call fails, if it is the one held
      await release(rendered.merges[0], repository === 'account' ? failure : undefined);
      await release(guestCall, failure);

      expect(rendered.result.current.merge.status).toBe('failed');
      expect(rendered.result.current.repository).toBe(PENDING_LIBRARY_REPOSITORY);
      expect(rendered.captureError).toHaveBeenCalledTimes(1);
      expect(rendered.captureError).toHaveBeenCalledWith(failure, { source: 'guest-merge' });
    },
  );

  it('shows no failure and reports nothing for a merge failing after its session ended', async () => {
    const rendered = await renderHeld();
    await rendered.emit({ userId: USER_A });

    await rendered.emit(null);
    await release(rendered.merges[0], new LibraryRemoteError('signed-out'));

    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.result.current.repository).toBe(rendered.guest);
    expect(rendered.guest.stored(ENTRY_KEY)).toStrictEqual(GUEST_ENTRY);
    expect(rendered.captureError).not.toHaveBeenCalled();
  });
});

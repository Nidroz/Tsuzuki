import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import { holdNextCall, type Deferred } from '../../../test/core/fake-library-repository';
import { ENTRY_KEY, entryOf, keyOf } from '../../../test/core/library-entry-fixtures';
import {
  renderSessionLibrary,
  settleSession,
  USER_A,
  type RenderedSessionLibrary,
} from '../../../test/core/library-hooks-support';
import type { LibraryEntry } from '../domain/library-entry';
import { LibraryRemoteError } from '../errors/library-errors';
import { PENDING_LIBRARY_REPOSITORY } from './SessionLibraryContextProvider';

// bR-08, ADR-0016: a failed guest merge shows the account library with the failure and keeps the
// guest store, until a retry (or the next launch or sign in) merges it

// the guest entry of ENTRY_KEY, newer than the account's, and one of a media the account lacks
const GUEST_ENTRY = entryOf({ progress: 1, updatedAt: '2026-03-01T00:00:00.000Z' });
const GUEST_OTHER = entryOf({ key: keyOf('manga', 2), progress: 4 });
const ENTRY_A = entryOf({ progress: 2 });
const ACCOUNT_ENTRIES: ReadonlyMap<string, readonly LibraryEntry[]> = new Map([
  [USER_A, [ENTRY_A]],
]);

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

describe('SessionLibraryContextProvider failed guest merge (A-04)', () => {
  it('shows the account library with the failure, keeps the guest store, then merges on retry', async () => {
    const rendered = await renderHeld();
    await rendered.emit({ userId: USER_A });
    const account = rendered.accountOf(0);

    await release(rendered.merges[0], new LibraryRemoteError('network'));

    expect(rendered.result.current.merge.status).toBe('failed');
    expect(rendered.result.current.repository).toBe(account);
    expect(rendered.result.current.entry.data).toStrictEqual(ENTRY_A);
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
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.result.current.repository).toBe(account);
    expect(rendered.result.current.entry.data).toStrictEqual(GUEST_ENTRY);
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

  it('gives the merged account library when a merge that failed part way is retried', async () => {
    const rendered = await renderSessionLibrary({
      guestEntries: [GUEST_ENTRY, GUEST_OTHER],
      accountEntries: ACCOUNT_ENTRIES,
      onAccount: (_userId, account) => {
        // the first merge writes the first entry, then fails
        account.mergeGuestEntries.mockImplementationOnce(async ([first]) => {
          if (first !== undefined) {
            await account.save(first);
          }
          throw new LibraryRemoteError('network');
        });
      },
    });
    await rendered.emit({ userId: USER_A });
    const account = rendered.accountOf(0);
    expect(rendered.result.current.merge.status).toBe('failed');
    expect(account.stored(ENTRY_KEY)).toStrictEqual(GUEST_ENTRY);
    expect(account.stored(GUEST_OTHER.key)).toBeNull();

    await retry(rendered);

    expect(rendered.result.current.merge.status).toBe('idle');
    expect(account.stored(ENTRY_KEY)).toStrictEqual(GUEST_ENTRY);
    expect(account.stored(GUEST_OTHER.key)).toStrictEqual(GUEST_OTHER);
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
      expect(rendered.result.current.repository).toBe(rendered.accountOf(0));
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

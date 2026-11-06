import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import {
  holdNextCall,
  mergedCopyOf,
  type Deferred,
} from '../../../test/core/fake-library-repository';
import { ENTRY_KEY, entryOf, keyOf } from '../../../test/core/library-entry-fixtures';
import {
  MERGE_OPTIONS,
  renderSessionLibrary,
  settleSession,
  USER_A,
  USER_B,
} from '../../../test/core/session-library-support';
import type { ErrorReporter } from '../errors/error-reporter';
import { LibraryRemoteError } from '../errors/library-errors';
import { PENDING_LIBRARY_REPOSITORY } from './SessionLibraryContextProvider';

// see ADR-0016 "Safety": a merge whose session ended (sign out, another user, unmount) changes no
// state and removes no guest entry; the next session's merge handles them, into its own library,
// once the previous merge settled: two merges never overlap

const GUEST_ENTRY = entryOf({ progress: 1 });
const GUEST_OTHER = entryOf({ key: keyOf('manga', 2), progress: 4 });
const GUEST_ENTRIES = [GUEST_ENTRY, GUEST_OTHER];
// longer than any write or read of the fakes: what is pending then stays pending
const LONG_WAIT_MS = 60_000;

// signed out with the guest entries; the first merge of each account instance held. release(n)
// lets the merge of accountOf(n) go on, or fails it with `failure`
const renderHeld = async () => {
  const merges: Deferred<void>[] = [];
  const rendered = await renderSessionLibrary({
    guestEntries: GUEST_ENTRIES,
    onAccount: (_userId, account) => {
      merges.push(holdNextCall(account, 'mergeGuestEntries'));
    },
  });
  const release = async (call: number, failure?: unknown) => {
    await act(async () => {
      if (failure === undefined) {
        merges[call]?.resolve();
      } else {
        merges[call]?.reject(failure);
      }
      await jest.advanceTimersByTimeAsync(0);
    });
    await settleSession();
  };
  return { ...rendered, release };
};

describe('SessionLibraryContextProvider guest merge across sessions (A-04)', () => {
  it("removes nothing when a user's merge ends after another user signed in, then merges into the new user's library", async () => {
    const rendered = await renderHeld();
    await rendered.emit({ userId: USER_A });
    const accountA = rendered.accountOf(0);
    expect(accountA.mergeGuestEntries).toHaveBeenCalledTimes(1);

    await rendered.emit({ userId: USER_B });
    const accountB = rendered.accountOf(1);
    expect(rendered.accountRepositoryFor).toHaveBeenLastCalledWith(USER_B);
    // user B's run waits for user A's
    expect(rendered.result.current.merge.status).toBe('checking');
    expect(rendered.result.current.repository).toBe(PENDING_LIBRARY_REPOSITORY);
    expect(rendered.guest.list).toHaveBeenCalledTimes(1);
    expect(accountB.mergeGuestEntries).not.toHaveBeenCalled();
    const from = rendered.frames.length;

    await rendered.release(0);

    // user A's run is stale: no render of its own, no removal, no other call to A's library;
    // user B's run starts then
    expect(rendered.shownSince(from)).toStrictEqual(['merging pending']);
    expect(rendered.guest.removeUnchanged).not.toHaveBeenCalled();
    expect(rendered.guest.stored(ENTRY_KEY)).toStrictEqual(GUEST_ENTRY);
    expect(accountA.mergeGuestEntries).toHaveBeenCalledTimes(1);
    expect(accountB.mergeGuestEntries).toHaveBeenCalledWith(GUEST_ENTRIES, MERGE_OPTIONS);

    await rendered.release(1);

    const mergedAt = new Date().toISOString();
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.result.current.repository).toBe(accountB);
    expect(rendered.result.current.entry.data).toStrictEqual(mergedCopyOf(GUEST_ENTRY, mergedAt));
    expect(rendered.guest.removeUnchanged).toHaveBeenCalledTimes(1);
    expect(rendered.guest.stored(ENTRY_KEY)).toBeNull();
    expect(accountB.stored(GUEST_OTHER.key)).toStrictEqual(mergedCopyOf(GUEST_OTHER, mergedAt));
    // user A's library was never shown nor read
    expect(accountA.list).not.toHaveBeenCalled();
    expect(accountA.get).not.toHaveBeenCalled();
    expect(rendered.shownSince(0)).not.toContain('idle account 0');
  });

  it.each([
    { outcome: 'succeeded', failure: undefined },
    { outcome: 'failed', failure: new LibraryRemoteError('network') },
  ])(
    'starts the merge of the same user signed in again only once the previous run $outcome',
    async ({ failure }) => {
      const rendered = await renderHeld();
      await rendered.emit({ userId: USER_A });
      expect(rendered.result.current.merge.status).toBe('merging');

      // signed out then in again: a new account instance of the same user, whose session guard
      // the first run would still pass
      await rendered.emit(null);
      await rendered.emit({ userId: USER_A });
      await settleSession(LONG_WAIT_MS);
      const second = rendered.accountOf(1);

      expect(rendered.result.current.merge.status).toBe('checking');
      expect(rendered.result.current.repository).toBe(PENDING_LIBRARY_REPOSITORY);
      expect(rendered.guest.list).toHaveBeenCalledTimes(1);
      expect(second.mergeGuestEntries).not.toHaveBeenCalled();

      await rendered.release(0, failure);

      // the first run, stale, removed nothing; the second one read the guest store only then
      expect(rendered.guest.list).toHaveBeenCalledTimes(2);
      expect(second.mergeGuestEntries).toHaveBeenCalledWith(GUEST_ENTRIES, MERGE_OPTIONS);
      expect(rendered.guest.removeUnchanged).not.toHaveBeenCalled();
      expect(rendered.result.current.merge.status).toBe('merging');

      await rendered.release(1);

      expect(rendered.result.current.merge.status).toBe('idle');
      expect(rendered.result.current.repository).toBe(second);
      expect(rendered.guest.removeUnchanged).toHaveBeenCalledTimes(1);
      expect(rendered.guest.stored(ENTRY_KEY)).toBeNull();
      expect(rendered.captureError).not.toHaveBeenCalled();
    },
  );

  it('shows the guest library at once on sign out during a merge, and removes nothing', async () => {
    const rendered = await renderHeld();
    await rendered.emit({ userId: USER_A });
    expect(rendered.result.current.merge.status).toBe('merging');

    await rendered.emit(null);

    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.result.current.repository).toBe(rendered.guest);
    await rendered.release(0);
    expect(rendered.result.current.repository).toBe(rendered.guest);
    expect(rendered.result.current.entry.data).toStrictEqual(GUEST_ENTRY);
    expect(rendered.guest.removeUnchanged).not.toHaveBeenCalled();
    expect(rendered.guest.stored(GUEST_OTHER.key)).toStrictEqual(GUEST_OTHER);
  });

  it('removes nothing when the merge ends after the provider unmounted', async () => {
    const rendered = await renderHeld();
    await rendered.emit({ userId: USER_A });

    rendered.unmount();
    await rendered.release(0);

    expect(rendered.guest.removeUnchanged).not.toHaveBeenCalled();
    expect(rendered.guest.stored(ENTRY_KEY)).toStrictEqual(GUEST_ENTRY);
  });

  it('sends nothing to the account when the session changed while the guest store was read', async () => {
    const rendered = await renderHeld();
    const read = holdNextCall(rendered.guest, 'list');
    await rendered.emit({ userId: USER_A });
    expect(rendered.result.current.merge.status).toBe('checking');
    expect(rendered.result.current.repository).toBe(PENDING_LIBRARY_REPOSITORY);

    await rendered.emit(null);
    await act(async () => {
      read.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(rendered.accountOf(0).mergeGuestEntries).not.toHaveBeenCalled();
    expect(rendered.result.current.repository).toBe(rendered.guest);
    expect(rendered.result.current.merge.status).toBe('idle');
  });

  it('reports a guest store failure of a run whose session ended, and shows no failure', async () => {
    const rendered = await renderHeld();
    const read = holdNextCall(rendered.guest, 'list');
    const failure = new Error('storage failure');
    await rendered.emit({ userId: USER_A });

    await rendered.emit(null);
    await act(async () => {
      read.reject(failure);
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(rendered.captureError).toHaveBeenCalledTimes(1);
    expect(rendered.captureError).toHaveBeenCalledWith(failure, { source: 'guest-merge' });
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.result.current.repository).toBe(rendered.guest);
  });

  it('runs one merge per account instance when the provider gets new props meanwhile', async () => {
    const rendered = await renderHeld();
    const read = holdNextCall(rendered.guest, 'list');
    await rendered.emit({ userId: USER_A });
    expect(rendered.result.current.merge.status).toBe('checking');
    const captureError = jest.fn<ErrorReporter['captureError']>();

    rendered.replaceReporter({ captureError });
    await act(async () => {
      read.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });
    await rendered.release(0);

    expect(rendered.guest.list).toHaveBeenCalledTimes(1);
    expect(rendered.accountOf(0).mergeGuestEntries).toHaveBeenCalledTimes(1);
    expect(rendered.result.current.merge.status).toBe('idle');
  });
});

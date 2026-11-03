import { describe, expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react';

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
  type RenderedSessionLibrary,
} from '../../../test/core/session-library-support';
import type { LibraryEntry } from '../domain/library-entry';
import { PENDING_LIBRARY_REPOSITORY } from './SessionLibraryContextProvider';

// bR-08, FR-22, ADR-0016: the guest library merged into each account library as it becomes the
// session's, before the account library shows

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

// the pending calls settle inside act first: only the query updates are left to wait for
const showsEntry = async (rendered: RenderedSessionLibrary, entry: LibraryEntry | null) => {
  await settleSession();
  await waitFor(() => {
    expect(rendered.result.current.entry.data).toStrictEqual(entry);
  });
};

describe('SessionLibraryContextProvider guest merge (A-04)', () => {
  it('shows the account library once an empty guest store was checked, never before', async () => {
    const rendered = await renderSessionLibrary({ accountEntries: ACCOUNT_ENTRIES });
    const from = rendered.frames.length;

    await rendered.emit({ userId: USER_A });

    // the very first frame of the new account instance is the check
    expect(rendered.frames[from]).toMatchObject({
      status: 'checking',
      repository: PENDING_LIBRARY_REPOSITORY,
    });
    await showsEntry(rendered, ENTRY_A);
    expect(rendered.shownSince(from)).toStrictEqual(['checking pending', 'idle account 0']);
    expect(rendered.guest.list).toHaveBeenCalledTimes(1);
    expect(rendered.accountOf(0).mergeGuestEntries).not.toHaveBeenCalled();
    expect(rendered.guest.removeUnchanged).not.toHaveBeenCalled();
  });

  it('keeps the library pending while the guest entries are merged, then shows the merged account library', async () => {
    const merges: Deferred<void>[] = [];
    const rendered = await renderSessionLibrary({
      guestEntries: [GUEST_ENTRY, GUEST_OTHER],
      accountEntries: ACCOUNT_ENTRIES,
      onAccount: (_userId, account) => {
        merges.push(holdNextCall(account, 'mergeGuestEntries'));
      },
    });
    const from = rendered.frames.length;

    await rendered.emit({ userId: USER_A });
    await settleSession(LONG_WAIT_MS);

    const account = rendered.accountOf(0);
    expect(rendered.result.current.merge.status).toBe('merging');
    expect(rendered.result.current.repository).toBe(PENDING_LIBRARY_REPOSITORY);
    expect(rendered.result.current.entry.isPending).toBe(true);
    expect(account.mergeGuestEntries).toHaveBeenCalledWith(
      [GUEST_ENTRY, GUEST_OTHER],
      MERGE_OPTIONS,
    );
    // no library call reaches the account while its merge runs
    expect(account.list).not.toHaveBeenCalled();
    expect(account.get).not.toHaveBeenCalled();
    expect(rendered.guest.removeUnchanged).not.toHaveBeenCalled();

    await act(async () => {
      merges[0]?.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });
    // written with the guest time, capped at the merge time, as the account store's database does
    const mergedAt = new Date().toISOString();
    await showsEntry(rendered, mergedCopyOf(GUEST_ENTRY, mergedAt, ENTRY_A));
    expect(rendered.result.current.entry.data?.updatedAt).toBe(GUEST_ENTRY.updatedAt);

    expect(rendered.result.current.repository).toBe(account);
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(account.stored(GUEST_OTHER.key)).toStrictEqual(mergedCopyOf(GUEST_OTHER, mergedAt));
    // exactly the entries the account received leave the device
    expect(rendered.guest.removeUnchanged).toHaveBeenCalledTimes(1);
    expect(rendered.guest.removeUnchanged.mock.calls[0]?.[0]).toBe(
      account.mergeGuestEntries.mock.calls[0]?.[0],
    );
    expect(rendered.guest.stored(ENTRY_KEY)).toBeNull();
    expect(rendered.guest.stored(GUEST_OTHER.key)).toBeNull();
    expect(rendered.shownSince(from)).toStrictEqual([
      'checking pending',
      'merging pending',
      'idle account 0',
    ]);
  });

  it('writes a `+1` still in its coalescing window to the guest store first, then merges it', async () => {
    const rendered = await renderSessionLibrary({ guestEntries: [GUEST_ENTRY] });
    await showsEntry(rendered, GUEST_ENTRY);
    await act(async () => {
      rendered.result.current.actions.incrementProgress();
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(rendered.result.current.entry.data?.progress).toBe(GUEST_ENTRY.progress + 1);
    expect(rendered.guest.save).not.toHaveBeenCalled();
    const save = holdNextCall(rendered.guest, 'save');

    await rendered.emit({ userId: USER_A });
    await settleSession();

    // the merge waits for the flushed write: the guest store is not read yet
    expect(rendered.guest.save).toHaveBeenCalledTimes(1);
    expect(rendered.guest.list).not.toHaveBeenCalled();
    expect(rendered.result.current.merge.status).toBe('checking');

    await act(async () => {
      save.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    const account = rendered.accountOf(0);
    expect(rendered.result.current.merge.status).toBe('idle');
    const merged = account.mergeGuestEntries.mock.calls[0]?.[0];
    expect(merged?.map((entry) => entry.progress)).toStrictEqual([GUEST_ENTRY.progress + 1]);
    expect(account.stored(ENTRY_KEY)?.progress).toBe(GUEST_ENTRY.progress + 1);
    expect(rendered.guest.stored(ENTRY_KEY)).toBeNull();
    await showsEntry(rendered, account.stored(ENTRY_KEY));
  });

  it('merges at launch with a stored session, and not again on a token refresh', async () => {
    const merges: Deferred<void>[] = [];
    const rendered = await renderSessionLibrary({
      session: { userId: USER_A },
      guestEntries: [GUEST_ENTRY],
      accountEntries: ACCOUNT_ENTRIES,
      onAccount: (_userId, account) => {
        merges.push(holdNextCall(account, 'mergeGuestEntries'));
      },
    });
    await settleSession();

    expect(rendered.result.current.merge.status).toBe('merging');
    await act(async () => {
      merges[0]?.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });
    await showsEntry(rendered, mergedCopyOf(GUEST_ENTRY, new Date().toISOString(), ENTRY_A));
    expect(rendered.shownSince(0)).toStrictEqual([
      'idle pending',
      'checking pending',
      'merging pending',
      'idle account 0',
    ]);
    const account = rendered.accountOf(0);
    expect(account.mergeGuestEntries).toHaveBeenCalledTimes(1);

    await rendered.emit({ userId: USER_A });
    await settleSession(LONG_WAIT_MS);

    expect(rendered.accountRepositoryFor).toHaveBeenCalledTimes(1);
    expect(rendered.guest.list).toHaveBeenCalledTimes(1);
    expect(account.mergeGuestEntries).toHaveBeenCalledTimes(1);
    expect(rendered.result.current.repository).toBe(account);
    expect(rendered.result.current.merge.status).toBe('idle');
  });

  it('checks again when the same user signs in again, from the first frame', async () => {
    const rendered = await renderSessionLibrary({ session: { userId: USER_A } });
    await settleSession();
    expect(rendered.result.current.repository).toBe(rendered.accountOf(0));
    await rendered.emit(null);
    await act(async () => {
      await rendered.guest.save(GUEST_OTHER);
    });
    const from = rendered.frames.length;

    await rendered.emit({ userId: USER_A });

    expect(rendered.frames[from]).toMatchObject({
      status: 'checking',
      repository: PENDING_LIBRARY_REPOSITORY,
    });
    await settleSession();
    expect(rendered.result.current.repository).toBe(rendered.accountOf(1));
    expect(rendered.accountOf(1).mergeGuestEntries).toHaveBeenCalledWith(
      [GUEST_OTHER],
      MERGE_OPTIONS,
    );
    expect(rendered.accountOf(0).mergeGuestEntries).not.toHaveBeenCalled();
    expect(rendered.guest.stored(GUEST_OTHER.key)).toBeNull();
  });
});

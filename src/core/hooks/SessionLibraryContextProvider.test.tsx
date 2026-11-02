import { describe, expect, it } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';

import { entryOf } from '../../../test/core/library-entry-fixtures';
import {
  renderSessionLibrary,
  settleSession,
  USER_A,
  USER_B,
  type RenderedSessionLibrary,
} from '../../../test/core/library-hooks-support';
import type { LibraryEntry } from '../domain/library-entry';
import { MISSING_GUEST_MERGE_PROVIDER_MESSAGE } from './guest-merge-context';
import { PENDING_LIBRARY_REPOSITORY } from './SessionLibraryContextProvider';
import { useGuestMerge } from './use-guest-merge';

// the session library switch (A-03); the guest merge it runs at sign in (A-04) is in the
// SessionLibraryContextProvider.merge, .failure and .session tests. the guest store is empty here

// the entry of ENTRY_KEY in each account library: one media, a different progress per owner
const ENTRY_A = entryOf({ progress: 2 });
const ENTRY_B = entryOf({ progress: 3 });
const ACCOUNT_ENTRIES: ReadonlyMap<string, readonly LibraryEntry[]> = new Map([
  [USER_A, [ENTRY_A]],
  [USER_B, [ENTRY_B]],
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

describe('SessionLibraryContextProvider (A-03)', () => {
  it('shows no library while the session loads: pending, neither library called', async () => {
    const rendered = await renderSessionLibrary({ session: 'loading' });

    await settleSession(LONG_WAIT_MS);

    expect(rendered.result.current.repository).toBe(PENDING_LIBRARY_REPOSITORY);
    expect(rendered.result.current.entry.isPending).toBe(true);
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.guest.get).not.toHaveBeenCalled();
    expect(rendered.guest.list).not.toHaveBeenCalled();
    expect(rendered.accountRepositoryFor).not.toHaveBeenCalled();
  });

  it('shows the guest library signed out, with no merge', async () => {
    const guestEntry = entryOf({ progress: 1 });
    const rendered = await renderSessionLibrary({ guestEntries: [guestEntry] });

    await showsEntry(rendered, guestEntry);

    expect(rendered.result.current.repository).toBe(rendered.guest);
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.guest.list).not.toHaveBeenCalled();
    expect(rendered.accountRepositoryFor).not.toHaveBeenCalled();
  });

  it('shows the account library of the user signed in, one per user id across token refreshes', async () => {
    const rendered = await renderSessionLibrary({
      session: { userId: USER_A },
      accountEntries: ACCOUNT_ENTRIES,
    });

    await showsEntry(rendered, ENTRY_A);
    // a token refresh reports the same user again
    await rendered.emit({ userId: USER_A });

    expect(rendered.accountRepositoryFor).toHaveBeenCalledTimes(1);
    expect(rendered.accountRepositoryFor).toHaveBeenCalledWith(USER_A);
    expect(rendered.result.current.repository).toBe(rendered.accountOf(0));
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.guest.get).not.toHaveBeenCalled();
  });

  it('shows the guest library again after sign out, and a new account library on sign in', async () => {
    const rendered = await renderSessionLibrary({
      session: { userId: USER_A },
      accountEntries: ACCOUNT_ENTRIES,
    });
    await showsEntry(rendered, ENTRY_A);

    await rendered.emit(null);
    await showsEntry(rendered, null);
    expect(rendered.result.current.repository).toBe(rendered.guest);
    await rendered.emit({ userId: USER_A });
    await showsEntry(rendered, ENTRY_A);

    expect(rendered.accountRepositoryFor).toHaveBeenCalledTimes(2);
    expect(rendered.result.current.repository).toBe(rendered.accountOf(1));
    expect(rendered.accountOf(1)).not.toBe(rendered.accountOf(0));
  });

  it("never shows a user's entries to the next user, not even for one frame", async () => {
    const rendered = await renderSessionLibrary({
      session: { userId: USER_A },
      accountEntries: ACCOUNT_ENTRIES,
    });
    await showsEntry(rendered, ENTRY_A);

    await rendered.emit({ userId: USER_B });
    await showsEntry(rendered, ENTRY_B);

    const accountB = rendered.accountOf(1);
    const shownForB = rendered.frames.filter((frame) => frame.repository === accountB);
    expect(shownForB.map((frame) => frame.entry)).toStrictEqual([undefined, ENTRY_B]);
  });

  it('makes useGuestMerge throw outside of it', () => {
    expect(() => renderHook(useGuestMerge)).toThrow(MISSING_GUEST_MERGE_PROVIDER_MESSAGE);
  });
});

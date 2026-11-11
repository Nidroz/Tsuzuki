import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import { holdNextCall, type Deferred } from '../../../test/core/fake-library-repository';
import { ENTRY_KEY, entryOf } from '../../../test/core/library-entry-fixtures';
import {
  renderSessionLibrary,
  settleSession,
  USER_A,
} from '../../../test/core/session-library-support';
import { LibraryRemoteError } from '../errors/library-errors';
import { PENDING_LIBRARY_REPOSITORY } from './SessionLibraryContextProvider';

// per R-04, a guest merge the account refused at its cap (LIBRARY_ENTRIES_PER_USER_MAX) tells why
// through useGuestMerge(), keeps the guest entries on the device and reports nothing

const GUEST_ENTRY = entryOf({ progress: 1 });

// signed out with a guest entry; each account's first merge held
const renderHeld = async () => {
  const merges: Deferred<void>[] = [];
  const rendered = await renderSessionLibrary({
    guestEntries: [GUEST_ENTRY],
    onAccount: (_userId, account) => {
      merges.push(holdNextCall(account, 'mergeGuestEntries'));
    },
  });
  return { ...rendered, merges };
};

const reject = async (held: Deferred<void> | undefined, failure: unknown) => {
  await act(async () => {
    held?.reject(failure);
    await jest.advanceTimersByTimeAsync(0);
  });
  await settleSession();
};

describe('SessionLibraryContextProvider: a full account library (R-04)', () => {
  it('fails the merge as library-full, unreported, the guest entries kept, until a retry', async () => {
    const rendered = await renderHeld();
    await rendered.emit({ userId: USER_A });

    await reject(rendered.merges[0], new LibraryRemoteError('library-full'));

    expect(rendered.result.current.merge).toMatchObject({
      status: 'failed',
      failure: 'library-full',
    });
    expect(rendered.result.current.repository).toBe(PENDING_LIBRARY_REPOSITORY);
    expect(rendered.guest.stored(ENTRY_KEY)).toStrictEqual(GUEST_ENTRY);
    expect(rendered.guest.removeUnchanged).not.toHaveBeenCalled();
    expect(rendered.captureError).not.toHaveBeenCalled();

    // the retry runs again: no failure while it checks
    const next = holdNextCall(rendered.accountOf(0), 'mergeGuestEntries');
    await act(async () => {
      rendered.result.current.merge.retry();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(rendered.result.current.merge.status).toBe('merging');
    expect(rendered.result.current.merge.failure).toBeUndefined();

    await reject(next, new LibraryRemoteError('network'));

    expect(rendered.result.current.merge).toMatchObject({ status: 'failed', failure: 'other' });
  });

  it('gives no failure reason in any other status', async () => {
    const rendered = await renderHeld();

    expect(rendered.result.current.merge).toStrictEqual({
      status: 'idle',
      retry: expect.any(Function),
    });

    await rendered.emit({ userId: USER_A });

    expect(rendered.result.current.merge.status).toBe('merging');
    expect(rendered.result.current.merge).not.toHaveProperty('failure');
  });
});

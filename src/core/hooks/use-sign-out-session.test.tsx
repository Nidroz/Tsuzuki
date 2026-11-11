import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import { createSessionSource, type SessionSource } from '../../../test/core/fake-auth-repository';
import {
  PROBE_QUERY_KEY,
  renderSessionEndHook,
  SESSION_USER_ID,
  STORED_SEARCH,
} from '../../../test/core/session-end-hooks-support';
import { createSessionAccount, USER_B } from '../../../test/core/session-library-support';
import { AuthError } from '../errors/auth-errors';
import type { AuthSession } from '../repositories/auth-repository';
import { useSignOut, type SignOutResult } from './use-sign-out';

// per R-04, what the sign out does once `signOut()` settled depends on the session as the auth
// repository last reported it: still this user's, ended, another user's, or this user's again

const SESSION: AuthSession = { userId: SESSION_USER_ID };
const MARKER = { userId: SESSION_USER_ID, clearGuestLibrary: true, deviceWide: true };
const PURGE = ['purgeAccount', 'clearGuest', 'clearRecentSearches', 'removePersistedCache'];

// the sign out of SESSION as the auth repository reports it, its `signOut()` running `signOut`
const renderReported = async (
  signOut: (source: SessionSource) => Promise<void>,
  account = createSessionAccount(),
) => {
  const source = createSessionSource(SESSION);
  const rendered = renderSessionEndHook(useSignOut, {
    account,
    auth: { onAuthStateChange: source.subscribe, signOut: () => signOut(source) },
  });
  // the session as first reported
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  return rendered;
};

type Rendered = Awaited<ReturnType<typeof renderReported>>;

// the sign out, settled inside act
const signOut = async (rendered: Rendered): Promise<SignOutResult> => {
  let outcome: SignOutResult | undefined;
  await act(async () => {
    outcome = await rendered.result.current.hook.mutateAsync({});
  });
  if (outcome === undefined) {
    throw new Error('the sign out did not resolve');
  }
  return outcome;
};

const expectDeviceWideKept = (rendered: Rendered): void => {
  expect(rendered.guest.clear).not.toHaveBeenCalled();
  expect(rendered.recentSearches.stored()).toStrictEqual([STORED_SEARCH]);
  expect(rendered.queryClient.getQueryData(PROBE_QUERY_KEY)).toBe(1);
  expect(rendered.removePersistedCache).not.toHaveBeenCalled();
};

describe('useSignOut after signOut() settled (R-04)', () => {
  it('removes the marker and rejects when signOut rejects with the session still reported', async () => {
    const rendered = await renderReported(() => Promise.reject(new AuthError('network')));

    await act(async () => {
      await expect(rendered.result.current.hook.mutateAsync({})).rejects.toMatchObject({
        reason: 'network',
      });
    });

    expect(rendered.sequence().slice(-3)).toStrictEqual(['addMarker', 'signOut', 'removeMarker']);
    expect(rendered.markers.stored()).toStrictEqual([]);
    expect(rendered.account?.purgeDeviceData).not.toHaveBeenCalled();
    expectDeviceWideKept(rendered);
  });

  it('keeps the marker and purges as after a success when signOut rejects once the session ended', async () => {
    const rendered = await renderReported((source) => {
      source.emit(null);
      return Promise.reject(new AuthError('unknown'));
    });

    await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'signed-out' });

    expect(rendered.sequence().slice(-7)).toStrictEqual([
      'addMarker',
      'signOut',
      ...PURGE,
      'removeMarker',
    ]);
    expect(rendered.markers.remove).toHaveBeenCalledTimes(1);
    expect(rendered.markers.stored()).toStrictEqual([]);
    expect(rendered.recentSearches.stored()).toStrictEqual([]);
    expect(rendered.result.current.generation).toBe(1);
    expect(rendered.result.current.hook.isError).toBe(false);
  });

  it("purges this user's documents only when signOut rejects with another user's session reported", async () => {
    const rendered = await renderReported((source) => {
      source.emit({ userId: USER_B });
      return Promise.reject(new AuthError('unknown'));
    });

    await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'signed-out' });

    expect(rendered.account?.purgeDeviceData).toHaveBeenCalledTimes(1);
    // the other user's device-wide data and documents are untouched
    expectDeviceWideKept(rendered);
    expect(rendered.result.current.generation).toBe(0);
    expect(rendered.accountRepositoryFor).not.toHaveBeenCalled();
    expect(rendered.markers.stored()).toStrictEqual([]);
  });

  it('purges nothing and removes the marker when the same user was reported signed in again inside signOut()', async () => {
    const rendered = await renderReported((source) => {
      source.emit(null);
      source.emit(SESSION);
      return Promise.resolve();
    });

    await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'signed-out' });

    // the new session's account instances stay open: no purge closes them
    expect(rendered.account?.purgeDeviceData).not.toHaveBeenCalled();
    expectDeviceWideKept(rendered);
    expect(rendered.markers.add.mock.calls).toStrictEqual([[MARKER]]);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });

  it('purges as before when no report followed signOut(): the session state object is unchanged', async () => {
    const rendered = await renderReported(() => Promise.resolve());

    await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'signed-out' });

    expect(rendered.sequence().slice(-7)).toStrictEqual([
      'addMarker',
      'signOut',
      ...PURGE,
      'removeMarker',
    ]);
  });

  it('removes the marker instead of rewriting it when the user signs in again while a failed purge runs', async () => {
    const account = createSessionAccount();
    let source: SessionSource | undefined;
    const rendered = await renderReported((reported) => {
      source = reported;
      reported.emit(null);
      return Promise.resolve();
    }, account);
    account.purgeDeviceData.mockImplementation(() => {
      // signed in again as the purge runs, whose account-library step then fails
      source?.emit(SESSION);
      throw new Error('storage unavailable');
    });

    await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'signed-out' });

    expect(account.purgeDeviceData).toHaveBeenCalledTimes(1);
    // never rewritten while they are signed in: a launch read as signed out would purge them
    expect(rendered.markers.add.mock.calls).toStrictEqual([[MARKER]]);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });
});

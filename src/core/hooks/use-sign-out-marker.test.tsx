import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import { createFakeDevicePurgeMarkers } from '../../../test/core/fake-device-purge-markers';
import { createDeferred } from '../../../test/core/fake-library-repository';
import {
  renderSessionEndHook,
  SESSION_USER_ID,
  STORED_SEARCH,
  type SessionEndSetup,
} from '../../../test/core/session-end-hooks-support';
import { createSessionAccount, USER_B } from '../../../test/core/session-library-support';
import { AuthError } from '../errors/auth-errors';
import { DevicePurgeMarkerOperationError } from '../errors/device-purge-errors';
import type { DevicePurgeMarker } from '../repositories/device-purge-marker-repository';
import { useSignOut } from './use-sign-out';

// the purge-pending marker of a sign out (ADR-0018, update of 2026-11-04): written before the
// session ends, so a kill before the purge leaves it for the next launch. on memory (R-09) the
// purge is owed to the files at the same time, as the marker dies with the process

const OTHER_MARKER: DevicePurgeMarker = {
  userId: USER_B,
  clearGuestLibrary: false,
  deviceWide: true,
};

// the sign out that records the markers, and the purges owed to the files, as the session ends.
// the app storage runs on memory: the purges are owed to `owedPurges` (the files' case: no owed
// purges, use-sign-out.test.tsx)
const renderSignOut = ({
  markers = createFakeDevicePurgeMarkers(),
  owedPurges = createFakeDevicePurgeMarkers(),
  auth = {},
  ...setup
}: SessionEndSetup = {}) => {
  const atSignOut: (readonly DevicePurgeMarker[])[] = [];
  const owedAtSignOut: (readonly DevicePurgeMarker[])[] = [];
  const rendered = renderSessionEndHook(useSignOut, {
    ...setup,
    markers,
    owedPurges,
    auth: {
      signOut: () => {
        atSignOut.push(markers.stored());
        owedAtSignOut.push(owedPurges.stored());
        return Promise.resolve();
      },
      ...auth,
    },
  });
  return { ...rendered, owedPurges, atSignOut, owedAtSignOut };
};

const OWED_OF_SESSION_USER: DevicePurgeMarker = {
  userId: SESSION_USER_ID,
  clearGuestLibrary: false,
  deviceWide: true,
};

const signOut = (rendered: ReturnType<typeof renderSignOut>, discardUnsynced?: boolean) =>
  act(() =>
    rendered.result.current.hook.mutateAsync(
      discardUnsynced === undefined ? {} : { discardUnsynced },
    ),
  );

describe('useSignOut purge-pending marker', () => {
  it("marks the user before the session ends and unmarks them once purged, another user's marker kept", async () => {
    const rendered = renderSignOut({ markers: createFakeDevicePurgeMarkers([OTHER_MARKER]) });

    await signOut(rendered);

    expect(rendered.atSignOut).toStrictEqual([
      [OTHER_MARKER, { userId: SESSION_USER_ID, clearGuestLibrary: true, deviceWide: true }],
    ]);
    expect(rendered.markers.stored()).toStrictEqual([OTHER_MARKER]);
    expect(rendered.markers.remove).toHaveBeenCalledWith(SESSION_USER_ID);
  });

  it('records the guest library kept while the merge has not concluded', async () => {
    const rendered = renderSignOut({ mergeStatus: 'failed' });

    await signOut(rendered);

    expect(rendered.atSignOut).toStrictEqual([
      [{ userId: SESSION_USER_ID, clearGuestLibrary: false, deviceWide: true }],
    ]);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });

  it('removes the marker when signOut rejects: still signed in, nothing purged', async () => {
    const rendered = renderSignOut({
      auth: { signOut: () => Promise.reject(new AuthError('network')) },
    });

    await act(async () => {
      await expect(rendered.result.current.hook.mutateAsync({})).rejects.toMatchObject({
        reason: 'network',
      });
    });

    expect(rendered.sequence().slice(-3)).toStrictEqual(['addMarker', 'signOut', 'removeMarker']);
    expect(rendered.markers.stored()).toStrictEqual([]);
    expect(rendered.account?.purgeDeviceData).not.toHaveBeenCalled();
    expect(rendered.recentSearches.stored()).toStrictEqual([STORED_SEARCH]);
  });

  it('rewrites the marker without the device-wide steps when the account-library step fails', async () => {
    const account = createSessionAccount();
    account.purgeDeviceData.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const rendered = renderSignOut({ account });

    await signOut(rendered);

    expect(rendered.markers.stored()).toStrictEqual([
      { userId: SESSION_USER_ID, clearGuestLibrary: false, deviceWide: false },
    ]);
    // the device-wide steps ran this time
    expect(rendered.guest.clear).toHaveBeenCalledTimes(1);
    expect(rendered.recentSearches.stored()).toStrictEqual([]);
  });

  it('writes no marker while it only asks about unsynced changes, nor without an account', async () => {
    const account = createSessionAccount();
    account.queuedWriteCount.mockReturnValue(1);
    const unsynced = renderSignOut({ account });

    await signOut(unsynced);

    expect(unsynced.markers.add).not.toHaveBeenCalled();

    const signedOut = renderSignOut({ account: null });

    await signOut(signedOut);

    expect(signedOut.markers.add).not.toHaveBeenCalled();
    expect(signedOut.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('reports a marker that cannot be written, without the user id, and still signs out and purges', async () => {
    const markers = createFakeDevicePurgeMarkers();
    markers.add.mockImplementation(() => {
      throw new Error(`storage unavailable: ${SESSION_USER_ID}`);
    });
    const rendered = renderSignOut({ markers });

    await signOut(rendered);

    expect(rendered.captureError).toHaveBeenCalledWith(new DevicePurgeMarkerOperationError('add'), {
      source: 'device-purge-marker',
      tags: { operation: 'add' },
    });
    expect(JSON.stringify(rendered.captureError.mock.calls)).not.toContain(SESSION_USER_ID);
    expect(rendered.auth.signOut).toHaveBeenCalledTimes(1);
    expect(rendered.account?.purgeDeviceData).toHaveBeenCalledTimes(1);
  });
  it('owes the purge to the files with the marker, before the session ends, never the guest library', async () => {
    const rendered = renderSignOut();

    await signOut(rendered);

    expect(rendered.owedAtSignOut).toStrictEqual([[OWED_OF_SESSION_USER]]);
    expect(rendered.atSignOut).toStrictEqual([
      [{ userId: SESSION_USER_ID, clearGuestLibrary: true, deviceWide: true }],
    ]);
    // the purge owes it again, unchanged; only a launch on the files settles it
    expect(rendered.owedPurges.stored()).toStrictEqual([OWED_OF_SESSION_USER]);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });

  it('leaves the owed purge of a process killed inside signOut(), nothing purged yet', async () => {
    const pending = createDeferred();
    const rendered = renderSignOut({ auth: { signOut: () => pending.promise } });

    await act(async () => {
      void rendered.result.current.hook.mutateAsync({});
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(rendered.auth.signOut).toHaveBeenCalledTimes(1);
    expect(rendered.owedPurges.stored()).toStrictEqual([OWED_OF_SESSION_USER]);
    expect(rendered.owedPurges.add.mock.invocationCallOrder[0]).toBeLessThan(
      rendered.auth.signOut.mock.invocationCallOrder[0] ?? 0,
    );
    expect(rendered.account?.purgeDeviceData).not.toHaveBeenCalled();
  });

  it('keeps the owed purge when signOut rejects while still signed in, the marker removed', async () => {
    const rendered = renderSignOut({
      auth: { signOut: () => Promise.reject(new AuthError('network')) },
    });

    await act(async () => {
      await expect(rendered.result.current.hook.mutateAsync({})).rejects.toMatchObject({
        reason: 'network',
      });
    });

    expect(rendered.markers.stored()).toStrictEqual([]);
    // the next launch on the files restores the session and unmarks this user
    expect(rendered.owedPurges.stored()).toStrictEqual([OWED_OF_SESSION_USER]);
    expect(rendered.account?.purgeDeviceData).not.toHaveBeenCalled();
  });

  it('owes nothing while it only asks about unsynced changes', async () => {
    const account = createSessionAccount();
    account.queuedWriteCount.mockReturnValue(1);
    const rendered = renderSignOut({ account });

    await signOut(rendered);

    expect(rendered.owedPurges.add).not.toHaveBeenCalled();
  });
});

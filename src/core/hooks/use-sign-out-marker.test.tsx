import { describe, expect, it } from '@jest/globals';
import { act } from '@testing-library/react';

import { createFakeDevicePurgeMarkers } from '../../../test/core/fake-device-purge-markers';
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
// session ends, so a kill before the purge leaves it for the next launch

const OTHER_MARKER: DevicePurgeMarker = {
  userId: USER_B,
  clearGuestLibrary: false,
  deviceWide: true,
};

// the sign out that records the markers as the session ends
const renderSignOut = ({
  markers = createFakeDevicePurgeMarkers(),
  auth = {},
  ...setup
}: SessionEndSetup = {}) => {
  const atSignOut: (readonly DevicePurgeMarker[])[] = [];
  const rendered = renderSessionEndHook(useSignOut, {
    ...setup,
    markers,
    auth: {
      signOut: () => {
        atSignOut.push(markers.stored());
        return Promise.resolve();
      },
      ...auth,
    },
  });
  return { ...rendered, atSignOut };
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
});

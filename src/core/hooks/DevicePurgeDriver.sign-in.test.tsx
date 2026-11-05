import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import { renderDevicePurgeDriver } from '../../../test/core/device-purge-driver-support';
import { createDeferred } from '../../../test/core/fake-library-repository';
import {
  USER_A,
  USER_B,
  type FakeSessionAccount,
} from '../../../test/core/session-library-support';
import type { DevicePurgeMarker } from '../repositories/device-purge-marker-repository';

// a marked user who signs in again (ADR-0018, update of 2026-11-04, "Launch" applied in the
// process): their sign out did not stand, so their marker goes and their documents stay

const USER_C = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';

const OTHER_MARKER: DevicePurgeMarker = {
  userId: USER_C,
  clearGuestLibrary: true,
  deviceWide: true,
};

const failAccountLibrary = (account: FakeSessionAccount): void => {
  account.purgeDeviceData.mockImplementation(() => {
    throw new Error('storage unavailable');
  });
};

describe('DevicePurgeDriver for a marked user who signs in again', () => {
  it.each<[string, DevicePurgeMarker]>([
    [
      'a failed account-library step',
      { userId: USER_A, clearGuestLibrary: false, deviceWide: false },
    ],
    ['a failed removal', { userId: USER_A, clearGuestLibrary: true, deviceWide: true }],
  ])(
    'unmarks them once signed in again after a sign out that left a marker (%s): a relaunch whose session comes back late keeps their documents',
    async (_case, leftBehind) => {
      const first = await renderDevicePurgeDriver({ session: { userId: USER_A } });
      // the sign out of user A ended the session and left the marker
      first.markers.add(leftBehind);
      first.markers.add(OTHER_MARKER);
      await first.emit(null);

      await first.emit({ userId: USER_A });

      expect(first.markers.stored()).toStrictEqual([OTHER_MARKER]);
      // user A queues writes offline, then the app is killed
      first.unmount();

      // offline with an expired token: no session at launch, the stored one comes back refreshed
      const next = await renderDevicePurgeDriver({ markers: first.markers.stored() });
      await next.emit({ userId: USER_A });

      expect(next.factoryCalls()).toStrictEqual([USER_C]);
      expect(next.accountsOf(USER_A)).toStrictEqual([]);
      expect(next.markers.stored()).toStrictEqual([]);
    },
  );

  it('leaves the markers of the users who do not sign in', async () => {
    const rendered = await renderDevicePurgeDriver();
    rendered.markers.add(OTHER_MARKER);

    await rendered.emit({ userId: USER_B });
    await rendered.emit({ userId: USER_B });

    expect(rendered.markers.remove).not.toHaveBeenCalled();
    expect(rendered.markers.stored()).toStrictEqual([OTHER_MARKER]);
    expect(rendered.accountRepositoryFor).not.toHaveBeenCalled();
    expect(rendered.deviceWideUntouched()).toBe(true);
  });

  it('skips the queued launch purge of a user signed in meanwhile, and unmarks them', async () => {
    const removal = createDeferred();
    const rendered = await renderDevicePurgeDriver({
      restoring: true,
      markers: [
        { userId: USER_A, clearGuestLibrary: true, deviceWide: true },
        { userId: USER_B, clearGuestLibrary: false, deviceWide: false },
      ],
    });
    rendered.removePersistedCache.mockReturnValueOnce(removal.promise);
    await rendered.setRestoring(false);

    // user A's purge waits for the persisted cache, user B's is queued behind it
    await rendered.emit({ userId: USER_B });

    expect(rendered.markers.stored().map(({ userId }) => userId)).toContain(USER_B);

    await act(async () => {
      removal.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });

  it('unmarks a user signed in while their launch purge runs, instead of marking them again', async () => {
    const removal = createDeferred();
    const rendered = await renderDevicePurgeDriver({
      restoring: true,
      markers: [{ userId: USER_A, clearGuestLibrary: true, deviceWide: true }],
      onAccount: (_userId, account) => {
        failAccountLibrary(account);
      },
    });
    rendered.removePersistedCache.mockReturnValueOnce(removal.promise);
    await rendered.setRestoring(false);

    await rendered.emit({ userId: USER_A });
    await act(async () => {
      removal.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });

  it('settles the marker of a gone user signed in when their purge ends: the account is gone', async () => {
    const rendered = await renderDevicePurgeDriver({
      session: { userId: USER_A },
      // the local sign out fails: user A stays the session's user
      auth: { signOut: () => Promise.reject(new Error('storage unavailable')) },
      onAccount: (_userId, account) => {
        failAccountLibrary(account);
      },
    });

    await rendered.reportGone(USER_A);

    expect(rendered.markers.stored()).toStrictEqual([
      { userId: USER_A, clearGuestLibrary: false, deviceWide: false },
    ]);
  });
});

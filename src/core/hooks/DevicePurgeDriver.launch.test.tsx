import { describe, expect, it } from '@jest/globals';

import {
  DRIVER_PROBE_QUERY_KEY,
  renderDevicePurgeDriver,
  settleDriver,
} from '../../../test/core/device-purge-driver-support';
import {
  USER_A,
  USER_B,
  type FakeSessionAccount,
} from '../../../test/core/session-library-support';
import { DevicePurgeError } from '../errors/device-purge-errors';

// the launch purge of the purge-pending markers (ADR-0018, update of 2026-11-04)

const USER_C = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';

const failAccountLibrary = (account: FakeSessionAccount): void => {
  account.purgeDeviceData.mockImplementation(() => {
    throw new Error('storage unavailable');
  });
};

describe('DevicePurgeDriver at launch', () => {
  it('purges every marked user through a new instance of their library, signed out', async () => {
    const rendered = await renderDevicePurgeDriver({
      markers: [
        { userId: USER_A, clearGuestLibrary: true, deviceWide: true },
        { userId: USER_B, clearGuestLibrary: false, deviceWide: false },
      ],
    });

    expect(rendered.factoryCalls()).toStrictEqual([USER_A, USER_B]);
    expect(rendered.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(rendered.accountsOf(USER_B)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    // user A owed the device-wide steps, user B did not: one generation, the guest library cleared once
    expect(rendered.guest.clear).toHaveBeenCalledTimes(1);
    expect(rendered.recentSearches.stored()).toStrictEqual([]);
    expect(rendered.queryClient.getQueryData(DRIVER_PROBE_QUERY_KEY)).toBeUndefined();
    expect(rendered.removePersistedCache).toHaveBeenCalledTimes(1);
    expect(rendered.result.current).toBe(1);
    expect(rendered.markers.stored()).toStrictEqual([]);
    expect(rendered.auth.signOut).not.toHaveBeenCalled();
    expect(rendered.captureError).not.toHaveBeenCalled();
  });

  it('keeps the guest library of a marker that recorded it kept', async () => {
    const rendered = await renderDevicePurgeDriver({
      markers: [{ userId: USER_A, clearGuestLibrary: false, deviceWide: true }],
    });

    expect(rendered.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(rendered.guest.clear).not.toHaveBeenCalled();
    expect(rendered.recentSearches.stored()).toStrictEqual([]);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });

  it("unmarks the session's user, who keeps their data: that sign out did not complete", async () => {
    const rendered = await renderDevicePurgeDriver({
      session: { userId: USER_A },
      markers: [{ userId: USER_A, clearGuestLibrary: true, deviceWide: true }],
    });

    expect(rendered.markers.stored()).toStrictEqual([]);
    expect(rendered.accountRepositoryFor).not.toHaveBeenCalled();
    expect(rendered.deviceWideUntouched()).toBe(true);
  });

  it("purges only the marked user's documents while another user is signed in", async () => {
    const rendered = await renderDevicePurgeDriver({
      session: { userId: USER_B },
      markers: [
        { userId: USER_A, clearGuestLibrary: true, deviceWide: true },
        { userId: USER_B, clearGuestLibrary: true, deviceWide: true },
      ],
    });

    // user B is signed in: unmarked, never purged; user A's documents only, nothing device-wide
    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);
    expect(rendered.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(rendered.deviceWideUntouched()).toBe(true);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });

  it('rewrites the marker when the account-library step fails, and the next launch retries that step only', async () => {
    const first = await renderDevicePurgeDriver({
      markers: [{ userId: USER_A, clearGuestLibrary: true, deviceWide: true }],
      onAccount: (_userId, account) => {
        failAccountLibrary(account);
      },
    });

    expect(first.captureError).toHaveBeenCalledWith(new DevicePurgeError('account-library'), {
      source: 'device-purge',
      tags: { step: 'account-library' },
    });
    // the device-wide steps ran once
    expect(first.guest.clear).toHaveBeenCalledTimes(1);
    const rewritten = [{ userId: USER_A, clearGuestLibrary: false, deviceWide: false }];
    expect(first.markers.stored()).toStrictEqual(rewritten);
    first.unmount();

    const next = await renderDevicePurgeDriver({ markers: first.markers.stored() });

    expect(next.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(next.deviceWideUntouched()).toBe(true);
    expect(next.markers.stored()).toStrictEqual([]);
  });

  it('waits for the persisted cache restore, which would put purged queries back', async () => {
    const rendered = await renderDevicePurgeDriver({
      restoring: true,
      markers: [{ userId: USER_A, clearGuestLibrary: true, deviceWide: true }],
    });

    expect(rendered.markers.list).not.toHaveBeenCalled();
    expect(rendered.gone.listenerCount()).toBe(0);

    await rendered.setRestoring(false);

    expect(rendered.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(rendered.markers.stored()).toStrictEqual([]);
    expect(rendered.gone.listenerCount()).toBe(1);
  });

  it('waits for the session, then runs once per mount', async () => {
    const loading = await renderDevicePurgeDriver({
      session: 'loading',
      markers: [{ userId: USER_A, clearGuestLibrary: true, deviceWide: true }],
    });

    expect(loading.markers.list).not.toHaveBeenCalled();
    expect(loading.accountRepositoryFor).not.toHaveBeenCalled();
    loading.unmount();

    const rendered = await renderDevicePurgeDriver({
      markers: [{ userId: USER_A, clearGuestLibrary: true, deviceWide: true }],
    });
    // a marker written later (a sign out) waits for the next launch
    rendered.markers.add({ userId: USER_C, clearGuestLibrary: true, deviceWide: true });
    await rendered.emit({ userId: USER_B });
    await rendered.emit(null);
    await settleDriver();

    expect(rendered.markers.list).toHaveBeenCalledTimes(1);
    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);
    expect(rendered.markers.stored()).toStrictEqual([
      { userId: USER_C, clearGuestLibrary: true, deviceWide: true },
    ]);
  });

  it('reports a purge that rejects, keeps its marker and still runs the next one', async () => {
    const reporterDown = new Error('reporter unavailable');
    let reports = 0;
    const rendered = await renderDevicePurgeDriver({
      markers: [
        { userId: USER_A, clearGuestLibrary: true, deviceWide: true },
        { userId: USER_B, clearGuestLibrary: false, deviceWide: false },
      ],
      onAccount: (userId, account) => {
        if (userId === USER_A) {
          failAccountLibrary(account);
        }
      },
      // the report of A's failed step throws, as a broken reporter would: A's purge rejects
      captureError: () => {
        reports += 1;
        if (reports === 1) {
          throw reporterDown;
        }
      },
    });

    expect(rendered.captureError.mock.calls[1]).toStrictEqual([
      reporterDown,
      { source: 'device-purge-driver' },
    ]);
    expect(rendered.factoryCalls()).toStrictEqual([USER_A, USER_B]);
    expect(rendered.accountsOf(USER_B)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    // the purge of user A never settled its marker: the next launch tries again
    expect(rendered.markers.stored()).toStrictEqual([
      { userId: USER_A, clearGuestLibrary: true, deviceWide: true },
    ]);
  });
});

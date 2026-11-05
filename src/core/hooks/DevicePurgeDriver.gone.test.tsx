import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import {
  DRIVER_PROBE_QUERY_KEY,
  renderDevicePurgeDriver,
} from '../../../test/core/device-purge-driver-support';
import { createDeferred } from '../../../test/core/fake-library-repository';
import { USER_A, USER_B } from '../../../test/core/session-library-support';
import { AuthError } from '../errors/auth-errors';
import type { DevicePurgeMarker } from '../repositories/device-purge-marker-repository';

// the purge of a user AuthRepository.onUserGone reports (ADR-0018, update of 2026-11-04)

describe('DevicePurgeDriver for a user gone', () => {
  it("marks the session's user, signs out, purges their documents and the device, then unmarks", async () => {
    const atSignOut: (readonly DevicePurgeMarker[])[] = [];
    const rendered = await renderDevicePurgeDriver({ session: { userId: USER_A } });
    rendered.auth.signOut.mockImplementation(() => {
      atSignOut.push(rendered.markers.stored());
      return Promise.resolve();
    });

    await rendered.reportGone(USER_A);

    expect(atSignOut).toStrictEqual([
      [{ userId: USER_A, clearGuestLibrary: true, deviceWide: true }],
    ]);
    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);
    const [purged] = rendered.accountsOf(USER_A);
    expect(purged?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(rendered.auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      purged?.purgeDeviceData.mock.invocationCallOrder[0] ?? 0,
    );
    expect(rendered.guest.clear).toHaveBeenCalledTimes(1);
    expect(rendered.recentSearches.stored()).toStrictEqual([]);
    expect(rendered.queryClient.getQueryData(DRIVER_PROBE_QUERY_KEY)).toBeUndefined();
    expect(rendered.removePersistedCache).toHaveBeenCalledTimes(1);
    expect(rendered.result.current).toBe(1);
    expect(rendered.markers.stored()).toStrictEqual([]);
    expect(rendered.captureError).not.toHaveBeenCalled();
  });

  it.each(['checking', 'merging', 'failed'] as const)(
    'keeps the guest library while the merge is %s',
    async (mergeStatus) => {
      const rendered = await renderDevicePurgeDriver({ session: { userId: USER_A }, mergeStatus });

      await rendered.reportGone(USER_A);

      expect(rendered.markers.add).toHaveBeenCalledWith({
        userId: USER_A,
        clearGuestLibrary: false,
        deviceWide: true,
      });
      expect(rendered.guest.clear).not.toHaveBeenCalled();
      expect(rendered.recentSearches.stored()).toStrictEqual([]);
    },
  );

  it('reports a sign out that rejects and still purges; never an unknown the repository reported', async () => {
    const network = await renderDevicePurgeDriver({
      session: { userId: USER_A },
      auth: { signOut: () => Promise.reject(new AuthError('network')) },
    });

    await network.reportGone(USER_A);

    expect(network.captureError).toHaveBeenCalledTimes(1);
    expect(network.captureError).toHaveBeenCalledWith(new AuthError('network'), {
      source: 'device-purge-driver',
      tags: { step: 'sign-out', reason: 'network' },
    });
    expect(network.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    // still signed in locally, as the gone user only: the device-wide steps run
    expect(network.recentSearches.stored()).toStrictEqual([]);
    expect(network.markers.stored()).toStrictEqual([]);
    network.unmount();

    const unknown = await renderDevicePurgeDriver({
      session: { userId: USER_A },
      auth: { signOut: () => Promise.reject(new AuthError('unknown')) },
    });

    await unknown.reportGone(USER_A);

    expect(unknown.captureError).not.toHaveBeenCalled();
    expect(unknown.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
  });

  it("purges only the gone user's documents while another user is signed in", async () => {
    const rendered = await renderDevicePurgeDriver({ session: { userId: USER_B } });

    await rendered.reportGone(USER_A);

    expect(rendered.auth.signOut).not.toHaveBeenCalled();
    expect(rendered.markers.add).toHaveBeenCalledTimes(1);
    expect(rendered.markers.add).toHaveBeenCalledWith({
      userId: USER_A,
      clearGuestLibrary: false,
      deviceWide: true,
    });
    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);
    expect(rendered.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(rendered.deviceWideUntouched()).toBe(true);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });

  it('runs one purge for a user reported again while it runs; a repeat after it is harmless', async () => {
    const removal = createDeferred();
    const rendered = await renderDevicePurgeDriver({ session: { userId: USER_A } });
    rendered.removePersistedCache.mockReturnValueOnce(removal.promise);

    await rendered.reportGone(USER_A);
    await rendered.reportGone(USER_A);
    // another user's report waits for the running purge
    await rendered.reportGone(USER_B);

    expect(rendered.auth.signOut).toHaveBeenCalledTimes(1);
    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);

    await act(async () => {
      removal.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(rendered.factoryCalls()).toStrictEqual([USER_A, USER_B]);
    expect(rendered.markers.stored()).toStrictEqual([]);

    await rendered.reportGone(USER_A);

    // signed out by then: A's documents only, again
    expect(rendered.auth.signOut).toHaveBeenCalledTimes(1);
    expect(rendered.factoryCalls()).toStrictEqual([USER_A, USER_B, USER_A]);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });

  it('purges nothing when the session ends without a report (revoked, expired, offline)', async () => {
    const rendered = await renderDevicePurgeDriver({ session: { userId: USER_A } });

    await rendered.emit(null);
    await rendered.emit({ userId: USER_A });

    expect(rendered.accountRepositoryFor).not.toHaveBeenCalled();
    expect(rendered.markers.add).not.toHaveBeenCalled();
    expect(rendered.auth.signOut).not.toHaveBeenCalled();
    expect(rendered.deviceWideUntouched()).toBe(true);
  });

  it('listens once the session is known, until unmounted', async () => {
    const loading = await renderDevicePurgeDriver({ session: 'loading' });

    expect(loading.gone.listenerCount()).toBe(0);
    loading.unmount();

    const rendered = await renderDevicePurgeDriver({ session: { userId: USER_A } });

    expect(rendered.gone.listenerCount()).toBe(1);
    rendered.unmount();
    expect(rendered.gone.listenerCount()).toBe(0);
  });
});

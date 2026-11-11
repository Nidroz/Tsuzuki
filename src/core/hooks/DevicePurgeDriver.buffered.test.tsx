import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import {
  createBufferedUserGoneSource,
  createLateSessionSource,
} from '../../../test/core/buffered-auth-sources';
import { renderDevicePurgeDriver } from '../../../test/core/device-purge-driver-support';
import { createDeferred } from '../../../test/core/fake-library-repository';
import { USER_A } from '../../../test/core/session-library-support';
import type { RenderedDevicePurgeDriver } from '../../../test/core/device-purge-driver-support';

// the users reported gone between the driver's mount and its readiness (ADR-0018, update of
// 2026-11-04): the repository keeps them until a listener subscribes (its own buffering:
// auth-repository-user-gone-delivery.test.ts); the driver subscribes once ready, then purges each
// once

const USER_C = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';

// lets what a report or a session change starts settle
const settle = async (change: () => void): Promise<void> => {
  await act(async () => {
    change();
    await jest.advanceTimersByTimeAsync(0);
  });
};

// nothing marked, signed out, purged or cleared
const expectNothingDone = (rendered: RenderedDevicePurgeDriver): void => {
  expect(rendered.markers.add).not.toHaveBeenCalled();
  expect(rendered.auth.signOut).not.toHaveBeenCalled();
  expect(rendered.accountRepositoryFor).not.toHaveBeenCalled();
  expect(rendered.deviceWideUntouched()).toBe(true);
};

describe('DevicePurgeDriver for users reported gone before it is ready', () => {
  it("purges the session's user reported while the session loads, once it is known", async () => {
    const session = createLateSessionSource();
    const gone = createBufferedUserGoneSource();
    const rendered = await renderDevicePurgeDriver({
      auth: {
        onAuthStateChange: session.subscribe,
        onUserGone: gone.subscribe,
        signOut: () => {
          session.report(null);
          return Promise.resolve();
        },
      },
    });

    await settle(() => {
      gone.report(USER_A);
      gone.report(USER_A);
    });

    expect(gone.listenerCount()).toBe(0);
    expect(gone.pending()).toStrictEqual([USER_A]);
    expectNothingDone(rendered);

    await settle(() => {
      session.report({ userId: USER_A });
    });

    expect(gone.listenerCount()).toBe(1);
    expect(gone.pending()).toStrictEqual([]);
    expect(rendered.markers.add).toHaveBeenCalledTimes(1);
    expect(rendered.markers.add).toHaveBeenCalledWith({
      userId: USER_A,
      clearGuestLibrary: true,
      deviceWide: true,
    });
    expect(rendered.auth.signOut).toHaveBeenCalledTimes(1);
    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);
    expect(rendered.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(rendered.guest.clear).toHaveBeenCalledTimes(1);
    expect(rendered.removePersistedCache).toHaveBeenCalledTimes(1);
    expect(rendered.markers.stored()).toStrictEqual([]);
    expect(rendered.captureError).not.toHaveBeenCalled();
  });

  it('purges each user reported while the cache restores once, after the restore', async () => {
    const gone = createBufferedUserGoneSource();
    const removal = createDeferred();
    const rendered = await renderDevicePurgeDriver({
      restoring: true,
      auth: { onUserGone: gone.subscribe },
    });
    rendered.removePersistedCache.mockReturnValueOnce(removal.promise);

    await settle(() => {
      gone.report(USER_A);
      gone.report(USER_C);
    });

    expect(gone.listenerCount()).toBe(0);
    expectNothingDone(rendered);

    await rendered.setRestoring(false);

    // the purge of user A waits for the cache removal; a report of A meanwhile queues nothing
    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);
    await settle(() => {
      gone.report(USER_A);
    });
    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);

    await settle(() => {
      removal.resolve();
    });

    expect(rendered.factoryCalls()).toStrictEqual([USER_A, USER_C]);
    expect(rendered.markers.add.mock.calls).toStrictEqual([
      [{ userId: USER_A, clearGuestLibrary: false, deviceWide: true }],
      [{ userId: USER_C, clearGuestLibrary: false, deviceWide: true }],
    ]);
    expect(rendered.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(rendered.accountsOf(USER_C)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(rendered.auth.signOut).not.toHaveBeenCalled();
    expect(rendered.markers.stored()).toStrictEqual([]);
    expect(rendered.captureError).not.toHaveBeenCalled();
  });

  it('waits for the session and the restore both before it listens', async () => {
    const session = createLateSessionSource();
    const gone = createBufferedUserGoneSource();
    const rendered = await renderDevicePurgeDriver({
      restoring: true,
      auth: { onAuthStateChange: session.subscribe, onUserGone: gone.subscribe },
    });

    await settle(() => {
      gone.report(USER_A);
    });
    // the session known, signed out, while the cache still restores
    await settle(() => {
      session.report(null);
    });

    expect(gone.listenerCount()).toBe(0);
    expect(gone.pending()).toStrictEqual([USER_A]);
    expectNothingDone(rendered);

    await rendered.setRestoring(false);

    expect(gone.listenerCount()).toBe(1);
    expect(rendered.markers.add).toHaveBeenCalledTimes(1);
    expect(rendered.factoryCalls()).toStrictEqual([USER_A]);
    expect(rendered.accountsOf(USER_A)[0]?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(rendered.markers.stored()).toStrictEqual([]);
  });
});

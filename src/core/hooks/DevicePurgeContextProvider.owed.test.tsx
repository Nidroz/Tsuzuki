import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import {
  createFakeDevicePurgeMarkers,
  type FakeDevicePurgeMarkers,
} from '../../../test/core/fake-device-purge-markers';
import { createFakeGuestLibraryRepository } from '../../../test/core/fake-library-repository';
import { createFakeRecentSearchesRepository } from '../../../test/core/fake-recent-searches-repository';
import { createSessionAccount, USER_A } from '../../../test/core/session-library-support';
import { DevicePurgeMarkerOperationError } from '../errors/device-purge-errors';
import type { ErrorReporter } from '../errors/error-reporter';
import { createQueryClient } from '../query/query-client';
import { noCaptcha } from '../repositories/auth-repository';
import type { DevicePurgeMarker } from '../repositories/device-purge-marker-repository';
import { AuthContextProvider } from './AuthContextProvider';
import { DevicePurgeContextProvider } from './DevicePurgeContextProvider';
import { GuestMergeContext, type GuestMergeValue } from './guest-merge-context';
import { RecentSearchesContextProvider } from './RecentSearchesContextProvider';
import { SessionLibraryContext } from './session-library-context';
import { useDevicePurge } from './use-device-purge';

// the purges owed to the files while the app storage runs on memory (R-09): with `owedPurges`,
// every device purge first records its user there, before any step; without it, nothing is owed

const IDLE_MERGE: GuestMergeValue = { status: 'idle', retry: () => undefined };
const STORED_SEARCH = 'frieren';

// renders useDevicePurge() under the provider, given `owedPurges` when there is one
const setup = (owedPurges?: FakeDevicePurgeMarkers) => {
  const queryClient = createQueryClient();
  const recentSearches = createFakeRecentSearchesRepository([STORED_SEARCH]);
  const account = createSessionAccount();
  const guest = createFakeGuestLibraryRepository();
  const removePersistedCache = jest.fn<() => void>();
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const sessionLibrary = {
    account,
    userId: USER_A,
    guest,
    accountRepositoryFor: () => createSessionAccount(),
  };
  const auth = createSessionAuthRepository({ userId: USER_A });
  const markers = createFakeDevicePurgeMarkers();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContextProvider repository={auth} captcha={noCaptcha}>
        <RecentSearchesContextProvider repository={recentSearches}>
          <SessionLibraryContext value={sessionLibrary}>
            <GuestMergeContext value={IDLE_MERGE}>
              <DevicePurgeContextProvider
                removePersistedCache={removePersistedCache}
                reporter={{ captureError }}
                markers={markers}
                {...(owedPurges && { owedPurges })}
              >
                {children}
              </DevicePurgeContextProvider>
            </GuestMergeContext>
          </SessionLibraryContext>
        </RecentSearchesContextProvider>
      </AuthContextProvider>
    </QueryClientProvider>
  );
  const { result } = renderHook(useDevicePurge, { wrapper });
  const purge = async (clearGuestLibrary: boolean, deviceWide: boolean) => {
    let failed: readonly string[] = [];
    await act(async () => {
      failed = await result.current({ userId: USER_A, account, clearGuestLibrary, deviceWide });
    });
    return failed;
  };
  return { account, guest, recentSearches, removePersistedCache, captureError, markers, purge };
};

const owedOf = (deviceWide: boolean): DevicePurgeMarker => ({
  userId: USER_A,
  clearGuestLibrary: false,
  deviceWide,
});

describe('DevicePurgeContextProvider with owed purges', () => {
  it("records the purge's user as owed before any step runs", async () => {
    const owed = createFakeDevicePurgeMarkers();
    const deps = setup(owed);
    const owedAtFirstStep: (readonly DevicePurgeMarker[])[] = [];
    deps.account.purgeDeviceData.mockImplementation(() => {
      owedAtFirstStep.push(owed.stored());
    });

    expect(await deps.purge(true, true)).toStrictEqual([]);

    expect(owedAtFirstStep).toStrictEqual([[owedOf(true)]]);
    // the purge still runs whole on memory
    expect(deps.guest.clear).toHaveBeenCalledTimes(1);
    expect(deps.recentSearches.stored()).toStrictEqual([]);
    expect(deps.removePersistedCache).toHaveBeenCalledTimes(1);
    expect(deps.captureError).not.toHaveBeenCalled();
  });

  it('never owes the guest library, and never lowers a device-wide step already owed', async () => {
    const owed = createFakeDevicePurgeMarkers([owedOf(true)]);
    const deps = setup(owed);

    // a settled marker of the memory process: its account-library step only
    await deps.purge(false, false);
    expect(owed.stored()).toStrictEqual([owedOf(true)]);

    const fresh = createFakeDevicePurgeMarkers();
    const other = setup(fresh);
    await other.purge(false, false);
    expect(fresh.stored()).toStrictEqual([owedOf(false)]);
    await other.purge(true, true);
    expect(fresh.stored()).toStrictEqual([owedOf(true)]);
  });

  it('reports a record that fails as owe, and still runs the purge', async () => {
    const owed = createFakeDevicePurgeMarkers();
    owed.add.mockImplementation(() => {
      throw new Error(`keychain write failed for ${USER_A}`);
    });
    const deps = setup(owed);

    expect(await deps.purge(true, true)).toStrictEqual([]);

    expect(deps.account.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(deps.guest.clear).toHaveBeenCalledTimes(1);
    expect(deps.removePersistedCache).toHaveBeenCalledTimes(1);
    expect(deps.captureError.mock.calls).toStrictEqual([
      [
        new DevicePurgeMarkerOperationError('owe'),
        { source: 'device-purge-marker', tags: { operation: 'owe' } },
      ],
    ]);
  });

  it('records nothing without owedPurges, the app storage reaching the files', async () => {
    const deps = setup();

    expect(await deps.purge(true, true)).toStrictEqual([]);

    expect(deps.account.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(deps.guest.clear).toHaveBeenCalledTimes(1);
    // the purge-pending markers are the callers' (sign out, driver), never the purge's
    expect(deps.markers.add).not.toHaveBeenCalled();
    expect(deps.captureError).not.toHaveBeenCalled();
  });
});

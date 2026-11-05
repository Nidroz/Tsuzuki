import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import { createFakeDevicePurgeMarkers } from '../../../test/core/fake-device-purge-markers';
import { createFakeGuestLibraryRepository } from '../../../test/core/fake-library-repository';
import { createFakeRecentSearchesRepository } from '../../../test/core/fake-recent-searches-repository';
import { createSessionAccount, USER_A } from '../../../test/core/session-library-support';
import type { ErrorReporter } from '../errors/error-reporter';
import { createQueryClient } from '../query/query-client';
import { noCaptcha } from '../repositories/auth-repository';
import { AuthContextProvider } from './AuthContextProvider';
import { MISSING_DEVICE_PURGE_PROVIDER_MESSAGE } from './device-purge-context';
import { DevicePurgeContextProvider } from './DevicePurgeContextProvider';
import { GuestMergeContext, type GuestMergeValue } from './guest-merge-context';
import { MISSING_RECENT_SEARCHES_PROVIDER_MESSAGE } from './recent-searches-context';
import { RecentSearchesContextProvider } from './RecentSearchesContextProvider';
import {
  MISSING_SESSION_LIBRARY_PROVIDER_MESSAGE,
  SessionLibraryContext,
  useSessionLibrary,
} from './session-library-context';
import { useDevicePurge, usePurgeGeneration, type DevicePurge } from './use-device-purge';
import { useRecentSearches } from './use-recent-searches';

const STORED_SEARCH = 'frieren';
const QUERY_KEY = ['probe'] as const;
const IDLE_MERGE: GuestMergeValue = { status: 'idle', retry: () => undefined };

const setup = () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(QUERY_KEY, 1);
  const recentSearches = createFakeRecentSearchesRepository([STORED_SEARCH]);
  const account = createSessionAccount();
  const guest = createFakeGuestLibraryRepository();
  const removePersistedCache = jest.fn<() => void>();
  const reporter = { captureError: jest.fn<ErrorReporter['captureError']>() };
  const sessionLibrary = {
    account,
    userId: USER_A,
    guest,
    accountRepositoryFor: () => createSessionAccount(),
  };
  const auth = createSessionAuthRepository({ userId: USER_A });
  const markers = createFakeDevicePurgeMarkers();
  const Providers = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContextProvider repository={auth} captcha={noCaptcha}>
        <RecentSearchesContextProvider repository={recentSearches}>
          <SessionLibraryContext value={sessionLibrary}>
            <GuestMergeContext value={IDLE_MERGE}>
              <DevicePurgeContextProvider
                removePersistedCache={removePersistedCache}
                reporter={reporter}
                markers={markers}
              >
                {children}
              </DevicePurgeContextProvider>
            </GuestMergeContext>
          </SessionLibraryContext>
        </RecentSearchesContextProvider>
      </AuthContextProvider>
    </QueryClientProvider>
  );
  return { queryClient, recentSearches, account, guest, removePersistedCache, reporter, Providers };
};

describe('DevicePurgeContextProvider', () => {
  it('binds the purge to the contexts and advances the generation once it ended', async () => {
    const { Providers, ...deps } = setup();
    const { result } = renderHook(
      () => ({ purge: useDevicePurge(), generation: usePurgeGeneration() }),
      { wrapper: Providers },
    );

    expect(result.current.generation).toBe(0);

    let failed: readonly string[] | undefined;
    await act(async () => {
      failed = await result.current.purge({
        account: deps.account,
        clearGuestLibrary: true,
        deviceWide: true,
      });
    });

    expect(failed).toStrictEqual([]);
    expect(deps.account.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(deps.guest.clear).toHaveBeenCalledTimes(1);
    expect(deps.recentSearches.stored()).toStrictEqual([]);
    expect(deps.queryClient.getQueryData(QUERY_KEY)).toBeUndefined();
    expect(deps.removePersistedCache).toHaveBeenCalledTimes(1);
    expect(deps.reporter.captureError).not.toHaveBeenCalled();
    expect(result.current.generation).toBe(1);
  });

  it('remounts a child keyed with the generation, which no longer shows purged searches', async () => {
    const { Providers, account } = setup();
    const seen: (readonly string[])[] = [];
    let mounts = 0;
    const purgeRef: { current: DevicePurge | null } = { current: null };

    function RecentSearchesProbe() {
      const { searches } = useRecentSearches();
      useEffect(() => {
        mounts += 1;
      }, []);
      useEffect(() => {
        seen.push(searches);
      }, [searches]);
      return null;
    }
    function KeyedProbe() {
      const purge = useDevicePurge();
      useEffect(() => {
        purgeRef.current = purge;
      }, [purge]);
      return <RecentSearchesProbe key={usePurgeGeneration()} />;
    }
    render(<KeyedProbe />, { wrapper: Providers });

    await act(() => purgeRef.current?.({ account, clearGuestLibrary: false, deviceWide: true }));

    expect(mounts).toBe(2);
    expect(seen).toStrictEqual([[STORED_SEARCH], []]);
  });

  it('makes its hooks and useSessionLibrary throw outside their providers', () => {
    const { queryClient, recentSearches } = setup();
    const queryOnly = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const sessionLibrary = {
      account: null,
      userId: null,
      guest: createFakeGuestLibraryRepository(),
      accountRepositoryFor: () => createSessionAccount(),
    };
    const withoutPurge = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <RecentSearchesContextProvider repository={recentSearches}>
          <SessionLibraryContext value={sessionLibrary}>{children}</SessionLibraryContext>
        </RecentSearchesContextProvider>
      </QueryClientProvider>
    );

    expect(() => renderHook(useSessionLibrary)).toThrow(MISSING_SESSION_LIBRARY_PROVIDER_MESSAGE);
    expect(() => renderHook(usePurgeGeneration)).toThrow(MISSING_DEVICE_PURGE_PROVIDER_MESSAGE);
    expect(() => renderHook(useDevicePurge, { wrapper: queryOnly })).toThrow(
      MISSING_RECENT_SEARCHES_PROVIDER_MESSAGE,
    );
    expect(() => renderHook(useDevicePurge, { wrapper: withoutPurge })).toThrow(
      MISSING_DEVICE_PURGE_PROVIDER_MESSAGE,
    );
  });
});

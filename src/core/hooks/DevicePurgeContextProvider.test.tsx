import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

import { createFakeGuestLibraryRepository } from '../../../test/core/fake-library-repository';
import { createFakeRecentSearchesRepository } from '../../../test/core/fake-recent-searches-repository';
import { createSessionAccount } from '../../../test/core/session-library-support';
import type { ErrorReporter } from '../errors/error-reporter';
import { createQueryClient } from '../query/query-client';
import { MISSING_DEVICE_PURGE_PROVIDER_MESSAGE } from './device-purge-context';
import { DevicePurgeContextProvider } from './DevicePurgeContextProvider';
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

const setup = () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(QUERY_KEY, 1);
  const recentSearches = createFakeRecentSearchesRepository([STORED_SEARCH]);
  const account = createSessionAccount();
  const guest = createFakeGuestLibraryRepository();
  const removePersistedCache = jest.fn<() => void>();
  const reporter = { captureError: jest.fn<ErrorReporter['captureError']>() };
  const sessionLibrary = { account, guest };
  const Providers = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RecentSearchesContextProvider repository={recentSearches}>
        <SessionLibraryContext value={sessionLibrary}>
          <DevicePurgeContextProvider
            removePersistedCache={removePersistedCache}
            reporter={reporter}
          >
            {children}
          </DevicePurgeContextProvider>
        </SessionLibraryContext>
      </RecentSearchesContextProvider>
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

    await act(() => result.current.purge({ account: deps.account, clearGuestLibrary: true }));

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

    await act(() => purgeRef.current?.({ account, clearGuestLibrary: false }));

    expect(mounts).toBe(2);
    expect(seen).toStrictEqual([[STORED_SEARCH], []]);
  });

  it('makes its hooks and useSessionLibrary throw outside their providers', () => {
    const { queryClient, recentSearches } = setup();
    const queryOnly = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const sessionLibrary = { account: null, guest: createFakeGuestLibraryRepository() };
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

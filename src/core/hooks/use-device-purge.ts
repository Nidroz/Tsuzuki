import { useQueryClient } from '@tanstack/react-query';
import { use, useCallback } from 'react';

import type { OfflineAccountLibraryRepository } from '../repositories/library-repository';
import { purgeDeviceUserData } from './device-purge';
import {
  DevicePurgeContext,
  MISSING_DEVICE_PURGE_PROVIDER_MESSAGE,
  type DevicePurgeValue,
} from './device-purge-context';
import {
  MISSING_RECENT_SEARCHES_PROVIDER_MESSAGE,
  RecentSearchesContext,
} from './recent-searches-context';
import { useSessionLibrary } from './session-library-context';

export interface DevicePurgeOptions {
  /** the account instance of the session that ends, taken when the sign out or deletion started */
  readonly account: OfflineAccountLibraryRepository;
  /** false while the guest merge has not concluded (keepsGuestLibrary) */
  readonly clearGuestLibrary: boolean;
}

/** purges the device for `options` (purgeDeviceUserData); never rejects */
export type DevicePurge = (options: DevicePurgeOptions) => Promise<void>;

/** the value of the nearest DevicePurgeContextProvider; throws outside of it */
export const useDevicePurgeContext = (): DevicePurgeValue => {
  const value = use(DevicePurgeContext);
  if (value === null) {
    throw new Error(MISSING_DEVICE_PURGE_PROVIDER_MESSAGE);
  }
  return value;
};

/**
 * the device purge of a sign out or an account deletion (ADR-0018), bound to the query client, the
 * recent searches repository, the guest library of the session and the DevicePurgeContextProvider.
 * throws outside of any of them
 */
export const useDevicePurge = (): DevicePurge => {
  const queryClient = useQueryClient();
  const recentSearches = use(RecentSearchesContext);
  if (recentSearches === null) {
    throw new Error(MISSING_RECENT_SEARCHES_PROVIDER_MESSAGE);
  }
  const { guest } = useSessionLibrary();
  const { removePersistedCache, reporter, advanceGeneration } = useDevicePurgeContext();
  return useCallback(
    ({ account, clearGuestLibrary }: DevicePurgeOptions) =>
      purgeDeviceUserData({
        account,
        guest,
        clearGuestLibrary,
        recentSearches,
        queryClient,
        removePersistedCache,
        reporter,
        advanceGeneration,
      }),
    [guest, recentSearches, queryClient, removePersistedCache, reporter, advanceGeneration],
  );
};

/**
 * the number of device purges so far: key a screen with it to reset its state after a purge (the
 * search route: text, filters, results, recent searches). throws outside DevicePurgeContextProvider
 */
export const usePurgeGeneration = (): number => useDevicePurgeContext().generation;

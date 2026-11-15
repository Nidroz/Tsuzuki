import { useQueryClient } from '@tanstack/react-query';
import { use, useCallback } from 'react';

import type { DevicePurgeStep } from '../errors/device-purge-errors';
import type { DevicePurgeMarker } from '../repositories/device-purge-marker-repository';
import { purgeDeviceUserData, type DevicePurgeTarget } from './device-purge';
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
  /**
   * the user whose documents go: the user of `account`. recorded first, before any step, as owed
   * to the files while the app storage runs on memory (owed-device-purges.ts)
   */
  readonly userId: string;
  /**
   * an account instance of the user whose documents go: the session's, taken when the sign out
   * or deletion started, or a new instance of a marked or gone user
   */
  readonly account: DevicePurgeTarget;
  /** false while the guest merge has not concluded (keepsGuestLibrary) */
  readonly clearGuestLibrary: boolean;
  /** false runs the `account-library` step only (purgeDeviceUserData) */
  readonly deviceWide: boolean;
}

/**
 * purges the device for `options` (purgeDeviceUserData) and resolves the steps that failed; never
 * rejects
 */
export type DevicePurge = (options: DevicePurgeOptions) => Promise<readonly DevicePurgeStep[]>;

/** the value of the nearest DevicePurgeContextProvider; throws outside of it */
export const useDevicePurgeContext = (): DevicePurgeValue => {
  const value = use(DevicePurgeContext);
  if (value === null) {
    throw new Error(MISSING_DEVICE_PURGE_PROVIDER_MESSAGE);
  }
  return value;
};

/**
 * marks `marker.userId` before their session ends (a sign out, a gone user): writes their
 * purge-pending marker, then, while the app storage runs on memory, owes that purge to the files
 * (the provider's `owedPurges`: `deviceWide` OR-merged with a record already there, never
 * lowered, `clearGuestLibrary` false). never throws: a failure of either is reported
 */
export type MarkDevicePurge = (marker: DevicePurgeMarker) => void;

/**
 * the MarkDevicePurge of the nearest DevicePurgeContextProvider; throws outside of it. on memory,
 * the marker goes with the process: the owed record is what outlives a kill inside `signOut()`
 * (the revocation may hang up to the fetch bound) or before the purge starts, and the next launch
 * on the files carries it into their markers (owed-device-purges.ts)
 */
export const useMarkDevicePurge = (): MarkDevicePurge => {
  const { markers, owePurge } = useDevicePurgeContext();
  return useCallback(
    (marker: DevicePurgeMarker) => {
      markers.add(marker);
      owePurge(marker.userId, marker.deviceWide);
    },
    [markers, owePurge],
  );
};

/**
 * the device purge of a sign out, an account deletion, a marked or a gone user (ADR-0018), bound
 * to the query client, the recent searches repository, the guest library of the session and the
 * DevicePurgeContextProvider. while the app storage runs on memory, the user is first recorded as
 * owed to the files (the provider's `owedPurges`), synchronously, before any step runs; a failed
 * record is reported and the purge still runs. a sign out and a gone purge owed it already, as
 * they marked the user (useMarkDevicePurge): the record is then written again, its flags merged.
 * throws outside of any of them
 */
export const useDevicePurge = (): DevicePurge => {
  const queryClient = useQueryClient();
  const recentSearches = use(RecentSearchesContext);
  if (recentSearches === null) {
    throw new Error(MISSING_RECENT_SEARCHES_PROVIDER_MESSAGE);
  }
  const { guest } = useSessionLibrary();
  const { removePersistedCache, reporter, owePurge, advanceGeneration } = useDevicePurgeContext();
  return useCallback(
    ({ userId, account, clearGuestLibrary, deviceWide }: DevicePurgeOptions) => {
      owePurge(userId, deviceWide);
      return purgeDeviceUserData({
        account,
        guest,
        clearGuestLibrary,
        deviceWide,
        recentSearches,
        queryClient,
        removePersistedCache,
        reporter,
        advanceGeneration,
      });
    },
    [
      guest,
      recentSearches,
      queryClient,
      removePersistedCache,
      reporter,
      owePurge,
      advanceGeneration,
    ],
  );
};

/**
 * the number of device purges so far: key a screen with it to reset its state after a purge (the
 * search route: text, filters, results, recent searches). throws outside DevicePurgeContextProvider
 */
export const usePurgeGeneration = (): number => useDevicePurgeContext().generation;

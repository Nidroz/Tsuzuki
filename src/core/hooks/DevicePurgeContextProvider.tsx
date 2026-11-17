import { useCallback, useMemo, useState, type ReactNode } from 'react';

import type { ErrorReporter } from '../errors/error-reporter';
import type { DevicePurgeMarkerRepository } from '../repositories/device-purge-marker-repository';
import { DevicePurgeContext, type DevicePurgeValue } from './device-purge-context';
import { DevicePurgeDriver } from './DevicePurgeDriver';
import { guardDevicePurgeMarkers } from './device-purge-markers';
import { guardOwedDevicePurges, OWE_NO_DEVICE_PURGE } from './owed-device-purges';

export interface DevicePurgeContextProviderProps {
  /**
   * deletes the persisted query cache document (the persister's removeClient), and cancels
   * a save still waiting. pass a stable function (module level)
   */
  removePersistedCache: () => void | PromiseLike<void>;
  /**
   * receives the purge steps that failed, the marker failures, the sign out and account deletion
   * failures, the stuck write retries and discards that failed (useLibrarySyncIssues), and the
   * programming errors of the library actions (useLibraryEntryActions)
   */
  reporter: ErrorReporter;
  /**
   * the purge-pending markers of the device (ADR-0018, update of 2026-11-04); pass a stable object
   * (module level)
   */
  markers: DevicePurgeMarkerRepository;
  /**
   * only while the app storage runs on memory: where each device purge first records its user as
   * owed to the files, for the next launch on them (owed-device-purges.ts); pass a stable object
   * (module level)
   */
  owedPurges?: DevicePurgeMarkerRepository;
  children: ReactNode;
}

const FIRST_GENERATION = 0;

/**
 * gives useDevicePurge(), usePurgeGeneration() and the purge-pending markers the persisted cache
 * removal, the reporter, the markers (their failures reported, never thrown), the record of the
 * purges owed to the files (with `owedPurges` only) and the purge generation (ADR-0018 "Device
 * purge"), and renders DevicePurgeDriver, the purges of a marked or gone user. render it inside
 * the query client provider, AuthContextProvider, RecentSearchesContextProvider and
 * SessionLibraryContextProvider, whose repositories the purge binds
 */
export function DevicePurgeContextProvider({
  removePersistedCache,
  reporter,
  markers,
  owedPurges,
  children,
}: DevicePurgeContextProviderProps) {
  const [generation, setGeneration] = useState(FIRST_GENERATION);
  const advanceGeneration = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const guarded = useMemo(() => guardDevicePurgeMarkers(markers, reporter), [markers, reporter]);
  const owePurge = useMemo(
    () =>
      owedPurges === undefined ? OWE_NO_DEVICE_PURGE : guardOwedDevicePurges(owedPurges, reporter),
    [owedPurges, reporter],
  );
  const value = useMemo(
    (): DevicePurgeValue => ({
      removePersistedCache,
      reporter,
      markers: guarded,
      owePurge,
      generation,
      advanceGeneration,
    }),
    [removePersistedCache, reporter, guarded, owePurge, generation, advanceGeneration],
  );
  return (
    <DevicePurgeContext value={value}>
      <DevicePurgeDriver />
      {children}
    </DevicePurgeContext>
  );
}

import { useCallback, useMemo, useState, type ReactNode } from 'react';

import type { ErrorReporter } from '../errors/error-reporter';
import { DevicePurgeContext, type DevicePurgeValue } from './device-purge-context';

export interface DevicePurgeContextProviderProps {
  /**
   * deletes the persisted query cache document: the persister's removeClient, which also cancels
   * a save still waiting. pass a stable function (module level)
   */
  removePersistedCache: () => void | PromiseLike<void>;
  /** receives the purge steps that failed, and the sign out and account deletion failures */
  reporter: ErrorReporter;
  children: ReactNode;
}

const FIRST_GENERATION = 0;

/**
 * gives useDevicePurge() and usePurgeGeneration() the persisted cache removal, the reporter and
 * the purge generation (ADR-0018 "Device purge"). render it inside the query client provider,
 * RecentSearchesContextProvider and SessionLibraryContextProvider, whose repositories the purge
 * binds
 */
export function DevicePurgeContextProvider({
  removePersistedCache,
  reporter,
  children,
}: DevicePurgeContextProviderProps) {
  const [generation, setGeneration] = useState(FIRST_GENERATION);
  const advanceGeneration = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const value = useMemo(
    (): DevicePurgeValue => ({ removePersistedCache, reporter, generation, advanceGeneration }),
    [removePersistedCache, reporter, generation, advanceGeneration],
  );
  return <DevicePurgeContext value={value}>{children}</DevicePurgeContext>;
}

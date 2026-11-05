import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { queryKeys } from '../query/keys';
import type { OfflineAccountLibraryRepository } from '../repositories/library-repository';
import { useSessionLibrary } from './session-library-context';
import { useDevicePurgeContext } from './use-device-purge';
import { useLatest } from './use-latest';
import { useLibraryContext } from './use-library-context';

/**
 * the report source of a stuck write retry that rejected, or of a discard that threw (a storage
 * failure): never with a write, a key or a user id
 */
export const LIBRARY_SYNC_ISSUES_REPORT_SOURCE = 'library-sync-issues';

/** the stuck writes of the live account library and the user's ways out (ADR-0017 "Stuck writes") */
export interface LibrarySyncIssues {
  /** the stuck writes of the live account library now; 0 when the live library is not one */
  readonly stuckCount: number;
  /** true while a retry of the live account library runs */
  readonly retrying: boolean;
  /**
   * the user's Try again: sends the stuck writes again (`retryStuckWrites`). ignored while a retry
   * runs or when the live library is not an account library; never throws
   */
  readonly retry: () => void;
  /**
   * the user's Discard, once confirmed: removes the writes stuck now (`discardStuckWrites`) and
   * refetches the library, so the views show the server state. returns how many it removed: 0
   * when the live library is not an account library, or when the storage failed (reported)
   */
  readonly discard: () => number;
}

const subscribeToNothing = (): (() => void) => () => undefined;
const noStuckWrite = (): number => 0;

/**
 * the stuck writes of the session's account library (ADR-0017 "Stuck writes", A-10), active only
 * while that instance is the live library of the nearest LibraryContextProvider, which it is once
 * its guest merge is done (signed out, while the session loads or the merge has not succeeded:
 * no stuck write, the actions do nothing). the count is read with `stuckWriteCount()` and follows
 * `subscribeToSyncState`. after a retry run that confirmed writes, and after a discard that
 * removed some, the live library scope is invalidated (non-exact, as LibraryReplayDriver does), so
 * the list and the entries refetch. a retry that rejects, or a discard that throws, goes to the
 * reporter of the DevicePurgeContextProvider with LIBRARY_SYNC_ISSUES_REPORT_SOURCE. throws
 * outside SessionLibraryContextProvider, LibraryContextProvider, DevicePurgeContextProvider or the
 * query client provider
 */
export const useLibrarySyncIssues = (): LibrarySyncIssues => {
  const queryClient = useQueryClient();
  const { repository, scope } = useLibraryContext();
  const { account } = useSessionLibrary();
  const { reporter } = useDevicePurgeContext();
  const live = account !== null && repository === account ? account : null;
  const latestLive = useLatest(live);
  const latestReporter = useLatest(reporter);

  const subscribe = useCallback(
    (listener: () => void) =>
      live === null ? subscribeToNothing() : live.subscribeToSyncState(listener),
    [live],
  );
  const getSnapshot = useCallback(
    () => (live === null ? noStuckWrite() : live.stuckWriteCount()),
    [live],
  );
  const stuckCount = useSyncExternalStore(subscribe, getSnapshot);

  // the instance whose retry runs: a retry of another instance never shows as pending
  const [retryingFor, setRetryingFor] = useState<OfflineAccountLibraryRepository | null>(null);
  // set synchronously, so two taps of one frame start one retry
  const inFlightRef = useRef<OfflineAccountLibraryRepository | null>(null);

  const retry = useCallback(() => {
    if (live === null || inFlightRef.current === live) {
      return;
    }
    inFlightRef.current = live;
    setRetryingFor(live);
    const settle = (): void => {
      if (inFlightRef.current === live) {
        inFlightRef.current = null;
      }
      setRetryingFor((current) => (current === live ? null : current));
    };
    live.retryStuckWrites().then(
      (run) => {
        settle();
        // kept writes too: the server holds a newer copy the views have not read yet
        if (run.confirmed > 0 && latestLive.current === live) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.library.all(scope) });
        }
      },
      (error: unknown) => {
        settle();
        latestReporter.current.captureError(error, { source: LIBRARY_SYNC_ISSUES_REPORT_SOURCE });
      },
    );
  }, [live, latestLive, latestReporter, queryClient, scope]);

  const discard = useCallback((): number => {
    if (live === null) {
      return 0;
    }
    let removed: number;
    try {
      removed = live.discardStuckWrites();
    } catch (error) {
      // the notice stays, with the count read from the device
      latestReporter.current.captureError(error, { source: LIBRARY_SYNC_ISSUES_REPORT_SOURCE });
      return 0;
    }
    if (removed > 0) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.all(scope) });
    }
    return removed;
  }, [live, latestReporter, queryClient, scope]);

  const retrying = live !== null && retryingFor === live;
  return useMemo(
    () => ({ stuckCount, retrying, retry, discard }),
    [stuckCount, retrying, retry, discard],
  );
};

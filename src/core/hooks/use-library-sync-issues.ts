import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { queryKeys } from '../query/keys';
import { useSessionLibrary } from './session-library-context';
import {
  IDLE_SYNC_ACTIONS,
  subscribeToSyncActions,
  syncActionsOf,
  updateSyncActions,
  type LibrarySyncFeedback,
} from './library-sync-actions';
import { useDevicePurgeContext } from './use-device-purge';
import { useLatest } from './use-latest';
import { useLibraryContext } from './use-library-context';

/**
 * the report source of a stuck write retry that rejected, or of a discard that threw (a storage
 * failure): never with a write, a key or a user id
 */
export const LIBRARY_SYNC_ISSUES_REPORT_SOURCE = 'library-sync-issues';

export type { LibrarySyncFeedback } from './library-sync-actions';

/** the stuck writes of the live account library and the user's ways out (ADR-0017 "Stuck writes") */
export interface LibrarySyncIssues {
  /** the stuck writes of the live account library now; 0 when the live library is not one */
  readonly stuckCount: number;
  /**
   * true while a retry of the live account library runs, started by any hook of that instance
   * (the library and favorites tabs share it)
   */
  readonly retrying: boolean;
  /**
   * what the last Try again or Discard on the instance could not do, shared by its hooks:
   * `offline` after a retry run that ended offline, `discard-failed` after a discard whose
   * storage failed. cleared when the next retry or discard starts, and with the last stuck write;
   * null when the live library is not an account library
   */
  readonly feedback: LibrarySyncFeedback | null;
  /**
   * the user's Try again: sends the stuck writes again (`retryStuckWrites`). ignored while a retry
   * of the instance runs, from any hook, or when the live library is not an account library;
   * never throws
   */
  readonly retry: () => void;
  /**
   * the user's Discard, once confirmed: removes the writes stuck now (`discardStuckWrites`) and
   * refetches the library, so the views show the server state. returns how many it removed: 0
   * when the live library is not an account library, or when the storage failed (reported, and
   * the `discard-failed` feedback)
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
 * the list and the entries refetch. the running retry and the feedback of the last action are
 * kept per instance (library-sync-actions), shared by every hook of it: the tabs mounted together
 * show one retry and one feedback. a retry that rejects, or a discard that throws, goes to the
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

  const subscribeToActions = useCallback(
    (listener: () => void) =>
      live === null ? subscribeToNothing() : subscribeToSyncActions(live, listener),
    [live],
  );
  const getActions = useCallback(
    () => (live === null ? IDLE_SYNC_ACTIONS : syncActionsOf(live)),
    [live],
  );
  const actions = useSyncExternalStore(subscribeToActions, getActions);

  // the feedback of an action goes with the last stuck write: a later stuck write never shows it
  useEffect(() => {
    if (live !== null && stuckCount === 0) {
      updateSyncActions(live, { feedback: null });
    }
  }, [live, stuckCount]);

  const retry = useCallback(() => {
    // the shared state is set synchronously, so two taps of one frame, or one per tab, start one
    // retry
    if (live === null || syncActionsOf(live).retrying) {
      return;
    }
    updateSyncActions(live, { retrying: true, feedback: null });
    live.retryStuckWrites().then(
      (run) => {
        updateSyncActions(live, {
          retrying: false,
          ...(run.status === 'offline' && { feedback: 'offline' }),
        });
        // kept writes too: the server holds a newer copy the views have not read yet
        if (run.confirmed > 0 && latestLive.current === live) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.library.all(scope) });
        }
      },
      (error: unknown) => {
        updateSyncActions(live, { retrying: false });
        latestReporter.current.captureError(error, { source: LIBRARY_SYNC_ISSUES_REPORT_SOURCE });
      },
    );
  }, [live, latestLive, latestReporter, queryClient, scope]);

  const discard = useCallback((): number => {
    if (live === null) {
      return 0;
    }
    updateSyncActions(live, { feedback: null });
    let removed: number;
    try {
      removed = live.discardStuckWrites();
    } catch (error) {
      // the notice stays, with the count read from the device, and says the discard failed
      latestReporter.current.captureError(error, { source: LIBRARY_SYNC_ISSUES_REPORT_SOURCE });
      updateSyncActions(live, { feedback: 'discard-failed' });
      return 0;
    }
    if (removed > 0) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.all(scope) });
    }
    return removed;
  }, [live, latestReporter, queryClient, scope]);

  const { retrying } = actions;
  // a feedback stored before the count reached 0 is never shown while the effect clears it
  const feedback = stuckCount === 0 ? null : actions.feedback;
  return useMemo(
    () => ({ stuckCount, retrying, feedback, retry, discard }),
    [stuckCount, retrying, feedback, retry, discard],
  );
};

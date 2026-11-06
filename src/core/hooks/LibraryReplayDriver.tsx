import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef } from 'react';

import type { ErrorReporter } from '../errors/error-reporter';
import { LIBRARY_REPLAY_REPORT_SOURCE } from '../errors/library-errors';
import { queryKeys } from '../query/keys';
import type {
  LibraryReplayRun,
  OfflineAccountLibraryRepository,
} from '../repositories/offline-account-library-repository';
import type { ForegroundSubscription } from './foreground';
import { useLibraryContext } from './use-library-context';

export interface LibraryReplayDriverProps {
  /**
   * the account library whose guest merge is done, null otherwise (signed out, the session
   * loading, a merge not done): its queued writes are replayed only while it is the library of
   * the nearest LibraryContextProvider
   */
  readonly account: OfflineAccountLibraryRepository | null;
  /** receives a run that rejected; read when it rejects, never a reason to restart the driver */
  readonly reporter: ErrorReporter;
  /** the app foreground: a return to the foreground starts a run. pass a stable function */
  readonly subscribeToForeground?: ForegroundSubscription | undefined;
}

/**
 * the replay driver of the offline account library (ADR-0017 "Hooks"), rendered inside the
 * LibraryContextProvider of the session library: while `account` is the live library, it replays
 * its queued writes when it becomes live, when the device reconnects (TanStack's onlineManager),
 * when the app returns to the foreground, and when the instance tells that a write stayed queued.
 * the triggers of one step start one run (the account library joins a run in flight itself).
 * after a run that confirmed writes, the live library scope is invalidated, so the lists and
 * entries refetch the server state. the runs of an instance are aborted once it is no longer
 * live (a sign out, another user, an unmount). a run never throws into react: one that rejects is
 * reported. renders nothing
 */
export function LibraryReplayDriver({
  account,
  reporter,
  subscribeToForeground,
}: LibraryReplayDriverProps) {
  const queryClient = useQueryClient();
  const { repository, scope } = useLibraryContext();
  const live = account !== null && repository === account ? account : null;

  // the latest reporter, set during the commit: a new one never aborts the runs
  const reporterRef = useRef(reporter);
  useLayoutEffect(() => {
    reporterRef.current = reporter;
  }, [reporter]);

  useEffect(() => {
    if (live === null) {
      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;
    // a joined run resolves every caller with the same result: it invalidates once
    const handled = new WeakSet<LibraryReplayRun>();
    let scheduled = false;

    const conclude = (run: LibraryReplayRun): void => {
      if (signal.aborted || handled.has(run)) {
        return;
      }
      handled.add(run);
      if (run.confirmed > 0) {
        // kept writes too: the server holds a newer copy the views have not read yet
        void queryClient.invalidateQueries({ queryKey: queryKeys.library.all(scope) });
      }
    };

    const replay = (): void => {
      scheduled = false;
      if (signal.aborted) {
        return;
      }
      live.replayQueuedWrites({ signal }).then(conclude, (error: unknown) => {
        reporterRef.current.captureError(error, { source: LIBRARY_REPLAY_REPORT_SOURCE });
      });
    };

    // the triggers of one synchronous step (a foreground return that also reconnects) start one run
    const trigger = (): void => {
      if (!scheduled) {
        scheduled = true;
        void Promise.resolve().then(replay);
      }
    };

    trigger();
    const unsubscribers = [
      onlineManager.subscribe((online) => {
        if (online) {
          trigger();
        }
      }),
      live.subscribeToQueuedWrites(trigger),
      subscribeToForeground?.((foreground) => {
        if (foreground) {
          trigger();
        }
      }),
    ];
    return () => {
      controller.abort();
      for (const unsubscribe of unsubscribers) {
        unsubscribe?.();
      }
    };
  }, [live, queryClient, scope, subscribeToForeground]);

  return null;
}

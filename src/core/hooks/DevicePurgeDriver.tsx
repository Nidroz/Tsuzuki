import { useIsRestoring } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import type { DevicePurgeMarker } from '../repositories/device-purge-marker-repository';
import { keepsGuestLibrary } from './device-purge';
import { useSessionLibrary } from './session-library-context';
import { reportSignOutFailure } from './sign-out-failure';
import { useAuthContext } from './use-auth-context';
import { useDevicePurge, useDevicePurgeContext } from './use-device-purge';
import { useGuestMerge } from './use-guest-merge';
import { useLatest } from './use-latest';

/** the source of the driver's reports: a failed local sign out of a gone user, a run that threw */
export const DEVICE_PURGE_DRIVER_REPORT_SOURCE = 'device-purge-driver';

// what a purge of a marked or gone user owes besides that user's documents
type OwedPurge = Pick<DevicePurgeMarker, 'clearGuestLibrary' | 'deviceWide'>;

interface PurgeRuns {
  /** the last run queued, settled whatever its outcome: the next one starts after it */
  tail: Promise<void>;
  /** the users whose run is queued or running: a repeat of one of them queues nothing */
  readonly queued: Set<string>;
}

/**
 * the purges of a marked or gone user (ADR-0018, update of 2026-11-04), rendered by
 * DevicePurgeContextProvider; renders nothing.
 *
 * it is ready once the session is known and the persisted query cache was restored, so no purge
 * runs before a restore that would put the purged queries back.
 *
 * launch: once ready, once per mount (the composition root mounts it once per app process),
 * every marker is read: the session's user is unmarked (that sign out did not complete), every
 * other marked user gets the device purge with the recorded `clearGuestLibrary` and `deviceWide`.
 * gone: from the moment it is ready, each user AuthRepository.onUserGone reports is marked
 * (`clearGuestLibrary` from the guest library rule when that user is the session's, else false;
 * `deviceWide` true), signed out when it is the session's user (a rejection is reported and the
 * purge goes on: the account is gone), then purged.
 *
 * each purge takes that user's documents through a new instance of that user's offline account
 * library (whose purge closes every instance of that user, and only them), runs the device-wide
 * steps only when no other user is signed in at that moment, then settles the marker (removed, or
 * rewritten for the next launch when the `account-library` step failed). the purges run one after
 * the other; a user reported again while their purge is queued or running gets no second one. a
 * session that ends without a report purges nothing: the queue waits for that user's next sign in
 * (ADR-0017). no report holds a user id
 */
export function DevicePurgeDriver() {
  const { repository, state } = useAuthContext();
  const { accountRepositoryFor } = useSessionLibrary();
  const { status: mergeStatus } = useGuestMerge();
  const { markers, reporter } = useDevicePurgeContext();
  const purge = useDevicePurge();
  const restoring = useIsRestoring();
  // the session known and the persisted cache restored (PersistQueryClientProvider)
  const ready = state.status !== 'loading' && !restoring;
  const sessionUserId = state.session?.userId ?? null;
  // read as each step starts: the session and the merge move while a purge waits for the previous
  const latest = useLatest({
    repository,
    sessionUserId,
    mergeStatus,
    accountRepositoryFor,
    markers,
    reporter,
    purge,
  });
  const runsRef = useRef<PurgeRuns>({ tail: Promise.resolve(), queued: new Set() });
  const launchedRef = useRef(false);

  const enqueue = useCallback(
    (userId: string, task: () => Promise<void>): void => {
      const runs = runsRef.current;
      if (runs.queued.has(userId)) {
        return;
      }
      runs.queued.add(userId);
      runs.tail = runs.tail.then(task).then(
        () => {
          runs.queued.delete(userId);
        },
        (error: unknown) => {
          runs.queued.delete(userId);
          // unexpected: the purge and the markers never throw
          latest.current.reporter.captureError(error, {
            source: DEVICE_PURGE_DRIVER_REPORT_SOURCE,
          });
        },
      );
    },
    [latest],
  );

  const purgeUser = useCallback(
    async (userId: string, owed: OwedPurge): Promise<void> => {
      const current = latest.current;
      const failed = await current.purge({
        // created inside the step: a factory that throws fails the `account-library` step
        account: {
          purgeDeviceData: () => {
            current.accountRepositoryFor(userId).purgeDeviceData();
          },
        },
        clearGuestLibrary: owed.clearGuestLibrary,
        // a user signed in meanwhile keeps their recent searches and caches
        deviceWide:
          owed.deviceWide && (current.sessionUserId === null || current.sessionUserId === userId),
      });
      current.markers.settle(userId, failed);
    },
    [latest],
  );

  const purgeGone = useCallback(
    async (userId: string): Promise<void> => {
      const current = latest.current;
      const isSessionUser = current.sessionUserId === userId;
      // read before the session ends: the status reads `idle` once signed out
      const clearGuestLibrary = isSessionUser && !keepsGuestLibrary(current.mergeStatus);
      current.markers.add({ userId, clearGuestLibrary, deviceWide: true });
      if (isSessionUser) {
        try {
          await current.repository.signOut();
        } catch (error) {
          reportSignOutFailure(current.reporter, DEVICE_PURGE_DRIVER_REPORT_SOURCE, error);
        }
      }
      await purgeUser(userId, { clearGuestLibrary, deviceWide: true });
    },
    [latest, purgeUser],
  );

  useEffect(() => {
    if (!ready || launchedRef.current) {
      return;
    }
    launchedRef.current = true;
    for (const { userId, clearGuestLibrary, deviceWide } of markers.list()) {
      if (userId === sessionUserId) {
        // still signed in: that sign out did not complete, nothing is owed
        markers.remove(userId);
      } else {
        enqueue(userId, () => purgeUser(userId, { clearGuestLibrary, deviceWide }));
      }
    }
  }, [ready, sessionUserId, markers, enqueue, purgeUser]);

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    return repository.onUserGone((userId) => {
      enqueue(userId, () => purgeGone(userId));
    });
  }, [ready, repository, enqueue, purgeGone]);

  return null;
}

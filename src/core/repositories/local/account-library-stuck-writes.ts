// the stuck writes of the offline account library (ADR-0017 "Stuck writes"): a queued write the
// database refused alone, or one whose replay runs keep failing `unknown`, counted for the notice,
// sent again on the user's retry, or removed once the user confirmed. a stuck write is never
// dropped otherwise. writes hold personal data: never logged
import { isLibraryWriteStuck } from '../../domain/library-sync';
import type { LibraryCallOptions } from '../library-repository';
import type { LibraryReplayRun } from '../offline-account-library-repository';
import { isClosed, notifySyncState, recordId } from './account-library-coordination';
import { replayQueuedWrites, type ReplayContext } from './account-library-replay';

/**
 * the OfflineAccountLibraryRepository `stuckWriteCount` (contract in
 * ../offline-account-library-repository.ts).
 */
export const stuckWriteCount = ({ coordination }: ReplayContext): number =>
  isClosed(coordination) ? 0 : coordination.store.readRecords().filter(isLibraryWriteStuck).length;

/**
 * the OfflineAccountLibraryRepository `retryStuckWrites`: releases the refused writes queued now
 * for this process, tells the sync state listeners, then joins or starts a run.
 */
export const retryStuckWrites = (
  context: ReplayContext,
  options?: LibraryCallOptions,
): Promise<LibraryReplayRun> => {
  const { coordination } = context;
  if (!isClosed(coordination)) {
    // the refused writes queued now only: one confirmed or replaced since is no longer released
    coordination.released.clear();
    for (const record of coordination.store.readRecords()) {
      if (record.refused === true) {
        coordination.released.set(recordId(record), record.seq);
      }
    }
    notifySyncState(coordination);
  }
  return replayQueuedWrites(context, options);
};

/**
 * the OfflineAccountLibraryRepository `discardStuckWrites`: removes the writes stuck now, the
 * device copy untouched, and tells the sync state listeners when it removed any.
 */
export const discardStuckWrites = ({ coordination }: ReplayContext): number => {
  if (isClosed(coordination)) {
    return 0;
  }
  const removed = coordination.store.removeStuck();
  if (removed > 0) {
    notifySyncState(coordination);
  }
  return removed;
};

/** the OfflineAccountLibraryRepository `subscribeToSyncState`. */
export const subscribeToSyncState = (
  { coordination }: ReplayContext,
  listener: () => void,
): (() => void) => {
  // a wrapper per subscription: the same listener subscribed twice is two subscriptions
  const subscription = (): void => {
    listener();
  };
  // a closed coordination never notifies again
  if (!isClosed(coordination)) {
    coordination.syncListeners.add(subscription);
  }
  return () => {
    coordination.syncListeners.delete(subscription);
  };
};

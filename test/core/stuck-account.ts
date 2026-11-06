// a fake offline account library whose stuck writes a test drives (ADR-0017 "Stuck writes"), for
// the useLibrarySyncIssues tests and the library screens showing its notice. no testing library
// import: the core (jsdom) and mobile projects both load it
import { jest } from '@jest/globals';

import type { LibraryEntry } from '@core/domain/library-entry';
import type {
  LibraryReplayRun,
  OfflineAccountLibraryRepository,
} from '@core/repositories/offline-account-library-repository';

import {
  createFakeAccountLibraryRepository,
  createStuckWriteMocks,
} from './fake-library-repository';

const NOTHING_REPLAYED: LibraryReplayRun = { status: 'done', confirmed: 0 };

/**
 * the fake account repository as an offline account library: no queued write, a replay that finds
 * nothing to send, a queue subscription never called, a purge that does nothing (jest mocks), and
 * the stuck write members of createStuckWriteMocks
 */
const createOfflineAccount = (entries: readonly LibraryEntry[]) =>
  ({
    ...createFakeAccountLibraryRepository(entries),
    replayQueuedWrites: jest.fn<OfflineAccountLibraryRepository['replayQueuedWrites']>(() =>
      Promise.resolve(NOTHING_REPLAYED),
    ),
    subscribeToQueuedWrites: jest.fn<OfflineAccountLibraryRepository['subscribeToQueuedWrites']>(
      () => () => undefined,
    ),
    queuedWriteCount: jest.fn<OfflineAccountLibraryRepository['queuedWriteCount']>(() => 0),
    ...createStuckWriteMocks(),
    purgeDeviceData: jest.fn<OfflineAccountLibraryRepository['purgeDeviceData']>(),
  }) satisfies OfflineAccountLibraryRepository;

export type FakeOfflineAccount = ReturnType<typeof createOfflineAccount>;

export interface StuckAccount {
  /** the offline account library fake, its stuck write members driven below */
  readonly account: FakeOfflineAccount;
  /** sets the stuck count `stuckWriteCount()` answers, then calls every sync state listener */
  readonly setStuckCount: (count: number) => void;
  /** the sync state listeners subscribed now */
  readonly listenerCount: () => number;
}

/**
 * an offline account library fake holding `entries` whose `stuckWriteCount()` answers `stuckCount` until
 * `setStuckCount` changes it and tells the listeners of `subscribeToSyncState`, as the account
 * library does after a run, a retry or a discard. `retryStuckWrites` and `discardStuckWrites`
 * keep the defaults of createStuckWriteMocks (a run that confirmed nothing, nothing removed)
 */
export const createStuckAccount = (
  stuckCount: number,
  entries: readonly LibraryEntry[] = [],
): StuckAccount => {
  const account = createOfflineAccount(entries);
  const listeners = new Set<() => void>();
  let count = stuckCount;
  account.stuckWriteCount.mockImplementation(() => count);
  account.subscribeToSyncState.mockImplementation((listener) => {
    // a wrapper per subscription: the same listener subscribed twice is two subscriptions
    const subscription = (): void => {
      listener();
    };
    listeners.add(subscription);
    return () => {
      listeners.delete(subscription);
    };
  });
  const setStuckCount = (next: number): void => {
    count = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return { account, setStuckCount, listenerCount: () => listeners.size };
};

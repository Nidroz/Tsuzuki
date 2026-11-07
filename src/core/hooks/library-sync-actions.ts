// the state of the user's actions on the stuck writes of one account library instance (A-10,
// R-03): its retry running and the feedback of its last action. shared by every
// useLibrarySyncIssues of the instance, so the library and favorites tabs, which stay mounted
// together, show one retry and one feedback
import type { OfflineAccountLibraryRepository } from '../repositories/offline-account-library-repository';

/**
 * the feedback of the last action on the stuck writes that did not happen: a Try again that found
 * the device offline, or a Discard whose storage failed
 */
export type LibrarySyncFeedback = 'offline' | 'discard-failed';

export interface LibrarySyncActionState {
  /** true while a retry of the instance runs */
  readonly retrying: boolean;
  /** cleared when the next retry or discard starts, or once no stuck write is left */
  readonly feedback: LibrarySyncFeedback | null;
  /**
   * bumped each time a feedback is set, the same one again included: each feedback is a new
   * outcome, so a view keyed by it shows (and announces) it anew
   */
  readonly feedbackId: number;
}

/** the parts of the action state the actions set; feedbackId follows feedback */
export type LibrarySyncActionChange = Partial<
  Pick<LibrarySyncActionState, 'retrying' | 'feedback'>
>;

/** no retry running, no feedback */
export const IDLE_SYNC_ACTIONS: LibrarySyncActionState = {
  retrying: false,
  feedback: null,
  feedbackId: 0,
};

interface SyncActionStore {
  state: LibrarySyncActionState;
  readonly listeners: Set<() => void>;
}

// keyed by the instance itself: a weak map, so the store goes with an instance no longer used
// (signed out, another user), and each test's new instances start idle
const stores = new WeakMap<OfflineAccountLibraryRepository, SyncActionStore>();

const storeOf = (instance: OfflineAccountLibraryRepository): SyncActionStore => {
  const existing = stores.get(instance);
  if (existing !== undefined) {
    return existing;
  }
  const created: SyncActionStore = { state: IDLE_SYNC_ACTIONS, listeners: new Set() };
  stores.set(instance, created);
  return created;
};

/** the action state of `instance` now, idle until an action started */
export const syncActionsOf = (instance: OfflineAccountLibraryRepository): LibrarySyncActionState =>
  stores.get(instance)?.state ?? IDLE_SYNC_ACTIONS;

/** calls `listener` on each change of the action state of `instance`; returns the unsubscribe */
export const subscribeToSyncActions = (
  instance: OfflineAccountLibraryRepository,
  listener: () => void,
): (() => void) => {
  const { listeners } = storeOf(instance);
  // a wrapper per subscription: the same listener subscribed twice is two subscriptions
  const subscription = (): void => {
    listener();
  };
  listeners.add(subscription);
  return () => {
    listeners.delete(subscription);
  };
};

/**
 * sets part of the action state of `instance`, telling its listeners when it changed: a feedback
 * set, even the one shown already, bumps feedbackId
 */
export const updateSyncActions = (
  instance: OfflineAccountLibraryRepository,
  change: LibrarySyncActionChange,
): void => {
  const store = storeOf(instance);
  const feedbackSet = change.feedback !== undefined && change.feedback !== null;
  const next: LibrarySyncActionState = {
    ...store.state,
    ...change,
    feedbackId: feedbackSet ? store.state.feedbackId + 1 : store.state.feedbackId,
  };
  if (
    next.retrying === store.state.retrying &&
    next.feedback === store.state.feedback &&
    next.feedbackId === store.state.feedbackId
  ) {
    return;
  }
  store.state = next;
  for (const listener of [...store.listeners]) {
    listener();
  }
};

// the types of the way out of a guest merge refused at the entry cap (ADR-0016, R-09) and its
// steps outside react; the hook is use-guest-merge-room.ts
import { applyContentFilter } from '../domain/content-filter';
import type { LibraryEntry } from '../domain/library-entry';
import type { MediaKey } from '../domain/media';
import type { OfflineAccountLibraryRepository } from '../repositories/offline-account-library-repository';
import { withAllowedCover, type CoverSource } from './library-covers';

/**
 * the report source of an unexpected failure (not a LibraryRemoteError) of the account library
 * read or of a removal, reported as a fixed LibraryFailureError('guest-merge-room'), told apart
 * from a failed merge run (`guest-merge`): never with the caught error, a key or a value
 */
export const GUEST_MERGE_ROOM_REPORT_SOURCE = 'guest-merge-room';

/**
 * what the last removal could not do: `offline` when the device was offline (nothing written) or
 * the server did not confirm it (kept queued on the device, ADR-0017), `failed` for any other
 * failure
 */
export const GUEST_MERGE_ROOM_FAILURES = ['offline', 'failed'] as const;

export type GuestMergeRoomFailure = (typeof GUEST_MERGE_ROOM_FAILURES)[number];

/** the account library read: running, failed, or answered */
export type GuestMergeRoomStatus = 'loading' | 'error' | 'ready';

export interface UseGuestMergeRoomOptions {
  /** the adult content setting (BR-06): off, the adult entries are hidden and counted */
  readonly showAdult: boolean;
}

/** a way out of a guest merge refused at the entry cap (ADR-0016, R-09) */
export interface GuestMergeRoom {
  /**
   * true while the merge is `failed` with `library-full` and the session has an account instance;
   * otherwise nothing is read and the actions do nothing
   */
  readonly active: boolean;
  /** the account library read of this refusal; `loading` while inactive */
  readonly status: GuestMergeRoomStatus;
  /**
   * the account entries once `ready`, in the repository order, the adult ones hidden unless
   * `showAdult` (BR-06), each cover kept on the catalog provider's hosts only; empty otherwise
   */
  readonly entries: readonly LibraryEntry[];
  /** the adult entries hidden from `entries` */
  readonly hiddenCount: number;
  /** reads the account library again, after a read error */
  readonly reload: () => void;
  /**
   * true while a removal runs, then once it succeeded until the merge restarts: `remove` and
   * `retry` are ignored meanwhile
   */
  readonly busy: boolean;
  /** the key whose removal runs now, null otherwise */
  readonly removingKey: MediaKey | null;
  /** what the last removal of this refusal could not do; cleared when the next one starts */
  readonly failure: GuestMergeRoomFailure | null;
  /** the identity of `failure`: one more per failure, the same one again included */
  readonly failureId: number;
  /**
   * removes `key` from the account library (its count goes down: nothing is ever written past the
   * cap), then retries the merge. one at a time; ignored while busy or inactive; never throws
   */
  readonly remove: (key: MediaKey) => void;
  /** the merge's Try again; ignored while busy or inactive */
  readonly retry: () => void;
}

/** the entries of the room as shown, with the adult ones hidden */
export interface GuestMergeRoomEntries {
  readonly entries: readonly LibraryEntry[];
  readonly hiddenCount: number;
}

/**
 * `entries` as the room shows them: in their order, the adult ones hidden unless `showAdult`
 * (BR-06) and counted, each cover kept on the hosts of `source` only (display copies)
 */
export const guestMergeRoomEntriesOf = (
  entries: readonly LibraryEntry[],
  showAdult: boolean,
  source: CoverSource,
): GuestMergeRoomEntries => {
  const matching = entries.map((entry) => ({
    entry: withAllowedCover(entry, source),
    isAdult: entry.media.isAdult,
  }));
  const { items, hiddenCount } = applyContentFilter(matching, showAdult);
  return { entries: items.map(({ entry }) => entry), hiddenCount };
};

/**
 * removes `key` from `account` and tells whether the server confirmed it, per call: the offline
 * account library resolves a removal it kept queued (offline, or the request failed without a
 * definite answer) after calling the listeners of `subscribeToQueuedWrites`, so the removal is
 * confirmed when none was called during the call. the queued write count cannot tell it: a removal
 * of a key already queued (stuck, or queued offline) replaces that write and leaves the count as
 * it was. nothing else writes to the account meanwhile: the live library is the pending one, and
 * no replay runs before the merge is done; a notification of another write would read as
 * unconfirmed, the safe side (offline feedback, no merge retry). the listener is unsubscribed once
 * the call settled, a rejection included
 */
export const removeConfirmed = async (
  account: OfflineAccountLibraryRepository,
  key: MediaKey,
): Promise<boolean> => {
  let queuedNotifications = 0;
  const unsubscribe = account.subscribeToQueuedWrites(() => {
    queuedNotifications += 1;
  });
  try {
    await account.remove(key);
  } finally {
    unsubscribe();
  }
  return queuedNotifications === 0;
};

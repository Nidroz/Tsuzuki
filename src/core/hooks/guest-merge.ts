// one run of the merge of the guest library into an account library (BR-08, FR-22, ADR-0016),
// driven by SessionLibraryContextProvider. plain typescript over the repository interfaces.
// entries are personal data: never logged, never put in an error or a report
import type {
  AccountLibraryRepository,
  GuestLibraryRepository,
} from '../repositories/library-repository';

/**
 * how a run ended: the guest store held nothing (`empty`, no account call), its entries were
 * merged and removed from the device (`merged`), or the session's account changed meanwhile
 * (`stale`: the guest store is kept, the next session's merge handles it)
 */
export type GuestMergeOutcome = 'empty' | 'merged' | 'stale';

export interface GuestMergeRun {
  readonly guest: GuestLibraryRepository;
  /** the account library of the session the run was started for */
  readonly account: AccountLibraryRepository;
  /**
   * settles once the earlier work settled: the previous run, so runs never overlap, and the
   * pending writes made before the run, which reached their repository
   */
  readonly settleWrites: () => Promise<void>;
  /** false once the session's account is no longer `account` */
  readonly isCurrent: () => boolean;
  /**
   * aborted once the session's account is no longer `account`: passed to the merge, which sends
   * no further batch then (ADR-0017)
   */
  readonly signal: AbortSignal;
  /** called once the guest entries are about to be sent to the account */
  readonly onMerging: () => void;
  /**
   * called with the error of a removal of the merged entries that failed, the run still ending
   * `merged`. the error only: it holds no entry
   */
  readonly onCleanupFailed: (error: unknown) => void;
}

/**
 * merges the guest store into `account`: waits for the earlier work (settleWrites), lists the
 * guest store, merges its entries into the account, then removes from the device exactly the
 * entries the account confirmed (removeUnchanged: an entry changed or added meanwhile stays).
 * checks the session between the steps: a run whose session ended removes nothing, and `signal`
 * stops its merge before the next batch. a rejection of a step up to the merge rejects the run,
 * and nothing is removed after a failed merge. a failed removal ends the run `merged`, given to
 * `onCleanupFailed`: the account holds every listed entry or a newer copy, and the next merge
 * sends the entries left on the device again (kept, BR-08) and removes them
 */
export const mergeGuestLibrary = async ({
  guest,
  account,
  settleWrites,
  isCurrent,
  signal,
  onMerging,
  onCleanupFailed,
}: GuestMergeRun): Promise<GuestMergeOutcome> => {
  await settleWrites();
  if (!isCurrent()) {
    return 'stale';
  }
  const entries = await guest.list();
  if (entries.length === 0) {
    return 'empty';
  }
  if (!isCurrent()) {
    return 'stale';
  }
  onMerging();
  await account.mergeGuestEntries(entries, { signal });
  // the entries are in this account, but the session is another one's now: they stay on the
  // device, and the next session's merge sends them. merging them again keeps their values (BR-08):
  // an entry is kept, or, its time ahead of the server, written again with the same values at its
  // later capped time (ADR-0016 Update)
  if (!isCurrent()) {
    return 'stale';
  }
  try {
    await guest.removeUnchanged(entries);
  } catch (error: unknown) {
    onCleanupFailed(error);
  }
  return 'merged';
};

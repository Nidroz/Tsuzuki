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
  /** settles once the pending writes made before the run reached their repository */
  readonly settleWrites: () => Promise<void>;
  /** false once the session's account is no longer `account` */
  readonly isCurrent: () => boolean;
  /** called once the guest entries are about to be sent to the account */
  readonly onMerging: () => void;
}

/**
 * merges the guest store into `account`: waits for the pending writes, lists the guest store,
 * merges its entries into the account, then removes from the device exactly the entries the
 * account confirmed (removeUnchanged: an entry changed or added meanwhile stays). checks the
 * session between the steps: a run whose session ended removes nothing. a rejection of any step
 * rejects the run, and nothing is removed after a failed merge
 */
export const mergeGuestLibrary = async ({
  guest,
  account,
  settleWrites,
  isCurrent,
  onMerging,
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
  await account.mergeGuestEntries(entries);
  // the entries are in this account, but the session is another one's now: they stay on the
  // device, and the next session's merge sends them (a retry of a merge is a no-op, BR-08)
  if (!isCurrent()) {
    return 'stale';
  }
  await guest.removeUnchanged(entries);
  return 'merged';
};

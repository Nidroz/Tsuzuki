import { createContext } from 'react';

/**
 * where the merge of the guest library into the account library of the session stands (BR-08,
 * FR-22, ADR-0016): `checking` while the guest store is read (the library shows its loading
 * state), `merging` while its entries are sent to the account, `failed` once a merge failed (the
 * guest store kept, the library still pending until a retry succeeds: no read, no write), `idle`
 * otherwise: signed out, the session loading, or the merge concluded without failure (nothing to
 * merge, or merged)
 */
export const GUEST_MERGE_STATUSES = ['idle', 'checking', 'merging', 'failed'] as const;

export type GuestMergeStatus = (typeof GUEST_MERGE_STATUSES)[number];

/**
 * why the last merge failed: `library-full` when the account library holds
 * LIBRARY_ENTRIES_PER_USER_MAX entries already and refused the guest entries (a condition of the
 * user: a retry fails again until titles are removed from the account), `other` for any other
 * failure
 */
export const GUEST_MERGE_FAILURES = ['library-full', 'other'] as const;

export type GuestMergeFailure = (typeof GUEST_MERGE_FAILURES)[number];

/** the merge of the guest library, given by SessionLibraryContextProvider */
export interface GuestMergeValue {
  readonly status: GuestMergeStatus;
  /**
   * why the merge failed, given with the `failed` status only; a `failed` value without it reads
   * as `other`
   */
  readonly failure?: GuestMergeFailure;
  /** runs the merge again after a failure; ignored in any other status */
  readonly retry: () => void;
}

/** the guest merge status and its retry, set by SessionLibraryContextProvider */
export const GuestMergeContext = createContext<GuestMergeValue | null>(null);

export const MISSING_GUEST_MERGE_PROVIDER_MESSAGE =
  'useGuestMerge is used outside SessionLibraryContextProvider: render the tree inside SessionLibraryContextProvider';

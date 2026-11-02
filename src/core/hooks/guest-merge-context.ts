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

/** the merge of the guest library, given by SessionLibraryContextProvider */
export interface GuestMergeValue {
  readonly status: GuestMergeStatus;
  /** runs the merge again after a failure; ignored in any other status */
  readonly retry: () => void;
}

/** the guest merge status and its retry, set by SessionLibraryContextProvider */
export const GuestMergeContext = createContext<GuestMergeValue | null>(null);

export const MISSING_GUEST_MERGE_PROVIDER_MESSAGE =
  'useGuestMerge is used outside SessionLibraryContextProvider: render the tree inside SessionLibraryContextProvider';

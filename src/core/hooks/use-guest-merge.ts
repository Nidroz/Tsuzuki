import { use } from 'react';

import {
  GuestMergeContext,
  MISSING_GUEST_MERGE_PROVIDER_MESSAGE,
  type GuestMergeValue,
} from './guest-merge-context';

export type { GuestMergeStatus, GuestMergeValue } from './guest-merge-context';

/**
 * the merge of the guest library into the account of the session (ADR-0016): its status and its
 * retry, from the nearest SessionLibraryContextProvider; throws outside of it
 */
export const useGuestMerge = (): GuestMergeValue => {
  const value = use(GuestMergeContext);
  if (value === null) {
    throw new Error(MISSING_GUEST_MERGE_PROVIDER_MESSAGE);
  }
  return value;
};

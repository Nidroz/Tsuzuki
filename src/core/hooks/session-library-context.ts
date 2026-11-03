import { createContext, use } from 'react';

import type {
  GuestLibraryRepository,
  OfflineAccountLibraryRepository,
} from '../repositories/library-repository';

/** the libraries of the session, given by SessionLibraryContextProvider (ADR-0018) */
export interface SessionLibraryValue {
  /**
   * the offline account library of the user signed in, whatever the guest merge phase (checking,
   * merging, failed or done); null signed out or while the session loads. the sign out and the
   * account deletion sync and purge this instance
   */
  readonly account: OfflineAccountLibraryRepository | null;
  /** the guest library of the device, shown signed out */
  readonly guest: GuestLibraryRepository;
}

/** the account instance of the session and the guest library, set by SessionLibraryContextProvider */
export const SessionLibraryContext = createContext<SessionLibraryValue | null>(null);

export const MISSING_SESSION_LIBRARY_PROVIDER_MESSAGE =
  'useSessionLibrary is used outside SessionLibraryContextProvider: render the tree inside SessionLibraryContextProvider';

/**
 * the account instance of the session and the guest library of the nearest
 * SessionLibraryContextProvider; throws outside of it
 */
export const useSessionLibrary = (): SessionLibraryValue => {
  const value = use(SessionLibraryContext);
  if (value === null) {
    throw new Error(MISSING_SESSION_LIBRARY_PROVIDER_MESSAGE);
  }
  return value;
};

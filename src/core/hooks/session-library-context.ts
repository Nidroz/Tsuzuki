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
  /**
   * the user id of `account`, null exactly when `account` is: the sign out writes this user's
   * purge-pending marker
   */
  readonly userId: string | null;
  /** the guest library of the device, shown signed out */
  readonly guest: GuestLibraryRepository;
  /**
   * the factory of the offline account libraries the provider was given: a new instance of a user
   * id per call. the device purge of a marked or gone user (DevicePurgeDriver) purges that user's
   * documents through a new instance, whose purge closes every instance of that user only
   */
  readonly accountRepositoryFor: (userId: string) => OfflineAccountLibraryRepository;
}

/**
 * the account instance of the session and its user id, the guest library and the account library
 * factory, set by SessionLibraryContextProvider
 */
export const SessionLibraryContext = createContext<SessionLibraryValue | null>(null);

export const MISSING_SESSION_LIBRARY_PROVIDER_MESSAGE =
  'useSessionLibrary is used outside SessionLibraryContextProvider: render the tree inside SessionLibraryContextProvider';

/**
 * the account instance of the session and its user id, the guest library and the account library
 * factory of the nearest SessionLibraryContextProvider; throws outside of it
 */
export const useSessionLibrary = (): SessionLibraryValue => {
  const value = use(SessionLibraryContext);
  if (value === null) {
    throw new Error(MISSING_SESSION_LIBRARY_PROVIDER_MESSAGE);
  }
  return value;
};

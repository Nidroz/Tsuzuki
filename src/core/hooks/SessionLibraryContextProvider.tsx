import { useMemo, type ReactNode } from 'react';

import type { LibraryRepository } from '../repositories/library-repository';
import { LibraryContextProvider } from './LibraryContextProvider';
import { useAuthSession } from './use-auth-session';

export interface SessionLibraryContextProviderProps {
  /** the guest library, shown signed out; pass a stable object (module level) */
  guest: LibraryRepository;
  /**
   * the account library of a signed-in user id, called once per user id while signed in; pass a
   * stable function (module level)
   */
  accountRepositoryFor: (userId: string) => LibraryRepository;
  children: ReactNode;
}

const neverSettles = <T,>(): Promise<T> => new Promise<T>(() => undefined);

/**
 * the library while the session is not known yet: every call stays pending, so the library
 * screens show their loading state, never the guest library to a signed-in user nor an empty one.
 * no write reaches it: library actions wait for a loaded entry, which never comes
 */
export const PENDING_LIBRARY_REPOSITORY: LibraryRepository = Object.freeze({
  list: neverSettles,
  get: neverSettles,
  save: neverSettles,
  remove: neverSettles,
});

/**
 * the LibraryContextProvider of the session's library (docs/ARCHITECTURE.md §4 "Library
 * switch"): the guest library signed out, the account library of the user signed in (one per user
 * id: a token refresh keeps it, another user or a new sign in gets a new one), the pending library
 * while the session loads. render it inside AuthContextProvider and the query client provider
 */
export function SessionLibraryContextProvider({
  guest,
  accountRepositoryFor,
  children,
}: SessionLibraryContextProviderProps) {
  const { status, session } = useAuthSession();
  const userId = session?.userId ?? null;
  const account = useMemo(
    () => (userId === null ? null : accountRepositoryFor(userId)),
    [accountRepositoryFor, userId],
  );
  const repository = status === 'loading' ? PENDING_LIBRARY_REPOSITORY : (account ?? guest);
  return <LibraryContextProvider repository={repository}>{children}</LibraryContextProvider>;
}

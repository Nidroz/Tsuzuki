import type { LibraryRepository } from '../repositories/library-repository';

const neverSettles = <T>(): Promise<T> => new Promise<T>(() => undefined);

/**
 * the library while the session is not known yet, or until the guest library was merged into the
 * account (a merge running or failed): every call stays pending, so the library screens never show
 * the guest library to a signed-in user, an empty one, nor an account library lacking a guest
 * entry. no write reaches it: library actions wait for a loaded entry, which never comes. given by
 * SessionLibraryContextProvider
 */
export const PENDING_LIBRARY_REPOSITORY: LibraryRepository = Object.freeze({
  list: neverSettles,
  get: neverSettles,
  save: neverSettles,
  remove: neverSettles,
});

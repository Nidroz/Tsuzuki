import { use } from 'react';

import {
  LibraryContext,
  MISSING_LIBRARY_PROVIDER_MESSAGE,
  type LibraryContextValue,
} from './library-context';

/** the library repository and writer of the nearest LibraryContextProvider; throws outside of it */
export const useLibraryContext = (): LibraryContextValue => {
  const value = use(LibraryContext);
  if (value === null) {
    throw new Error(MISSING_LIBRARY_PROVIDER_MESSAGE);
  }
  return value;
};

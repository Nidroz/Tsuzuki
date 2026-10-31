import { createContext } from 'react';

import type { LibraryScope } from '../query/keys';
import type { LibraryRepository } from '../repositories/library-repository';
import type { LibraryWriter } from './library-writer';

/** the library of the current user, given by LibraryContextProvider */
export interface LibraryContextValue {
  /** the active repository: the hooks read the list from it (L-04), never pick one themselves */
  readonly repository: LibraryRepository;
  /** the writes over that repository: optimistic, `+1` coalesced, serialized per key */
  readonly writer: LibraryWriter;
  /**
   * the cache scope of that writer: the library hooks key every query with it, so the queries of
   * one library never meet those of another (docs/ARCHITECTURE.md §6 "Query keys")
   */
  readonly scope: LibraryScope;
}

/** the library repository, its writer and their cache scope, set by LibraryContextProvider */
export const LibraryContext = createContext<LibraryContextValue | null>(null);

export const MISSING_LIBRARY_PROVIDER_MESSAGE =
  'a library hook is used outside LibraryContextProvider: render the tree inside LibraryContextProvider';

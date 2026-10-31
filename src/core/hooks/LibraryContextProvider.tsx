import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';

import { queryKeys, toLibraryScope, type LibraryScope } from '../query/keys';
import type { LibraryRepository } from '../repositories/library-repository';
import { LibraryContext, type LibraryContextValue } from './library-context';
import { createLibraryWriter } from './library-writer';

export interface LibraryContextProviderProps {
  /** pass a stable object (module level): a new one builds a new writer and re-renders consumers */
  repository: LibraryRepository;
  children: ReactNode;
}

// the last scope given to a writer: every writer gets its own, never reused
let lastLibraryScope = 0;

// a new cache scope, one per writer (docs/ARCHITECTURE.md §6 "Writes"): not an owner id, so the
// same user signed in again never meets the late writes of the previous writer
const nextLibraryScope = (): LibraryScope => {
  lastLibraryScope += 1;
  return toLibraryScope(lastLibraryScope);
};

/**
 * gives the tree the library repository, its writer and their cache scope; the library hooks
 * read them. render it inside the query client provider: the writer keeps the optimistic entries
 * in that cache. a new repository (the session library switch, A-03) or query client gets a new
 * writer and a new scope in the same render, so the hooks never read the previous library's keys.
 * the previous scope's queries are then removed, its pending coalesced writes go to the repository
 * they were made for, and once they settled its queries are removed again; on unmount too
 */
export function LibraryContextProvider({ repository, children }: LibraryContextProviderProps) {
  const queryClient = useQueryClient();
  const value = useMemo((): LibraryContextValue => {
    const scope = nextLibraryScope();
    return { repository, writer: createLibraryWriter({ queryClient, repository, scope }), scope };
  }, [queryClient, repository]);

  useEffect(
    () => () => {
      const { writer, scope } = value;
      // no mounted hook reads this scope any more: its fetches are cancelled, its entries leave
      const removeScope = (): void => {
        queryClient.removeQueries({ queryKey: queryKeys.library.all(scope) });
      };
      removeScope();
      // never rejects: a failed write already reached the action that made it. a flushed write
      // that succeeded set its entry again, so the scope is removed once more after it
      void writer.flushAll().then(removeScope);
    },
    [queryClient, value],
  );

  return <LibraryContext value={value}>{children}</LibraryContext>;
}

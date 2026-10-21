import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';

import type { LibraryRepository } from '../repositories/library-repository';
import { LibraryContext } from './library-context';
import { createLibraryWriter } from './library-writer';

export interface LibraryContextProviderProps {
  /** pass a stable object (module level): a new one builds a new writer and re-renders consumers */
  repository: LibraryRepository;
  children: ReactNode;
}

/**
 * gives the tree the library repository and its writer; the library hooks read them. render it
 * inside the query client provider: the writer keeps the optimistic entries in that cache. when
 * the repository changes (the auth switch, A-03) or the provider unmounts, the pending coalesced
 * writes go to the repository they were made for
 */
export function LibraryContextProvider({ repository, children }: LibraryContextProviderProps) {
  const queryClient = useQueryClient();
  const writer = useMemo(
    () => createLibraryWriter({ queryClient, repository }),
    [queryClient, repository],
  );
  useEffect(
    () => () => {
      // never rejects: a failed write already reached the action that made it
      void writer.flushAll();
    },
    [writer],
  );
  const value = useMemo(() => ({ repository, writer }), [repository, writer]);
  return <LibraryContext value={value}>{children}</LibraryContext>;
}

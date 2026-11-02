import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';

import { queryKeys, toLibraryScope, type LibraryScope } from '../query/keys';
import type { LibraryRepository } from '../repositories/library-repository';
import type { ForegroundSubscription } from './foreground';
import { LibraryContext, type LibraryContextValue } from './library-context';
import { createLibraryWriter } from './library-writer';

/** a library value retired by LibraryContextProvider: a new repository or query client, an unmount */
export interface RetiredLibrary {
  /** the repository of the retired value */
  readonly repository: LibraryRepository;
  /**
   * its writer's flushAll(): settles once the pending coalesced writes made on it reached that
   * repository; never rejects
   */
  readonly flushed: Promise<void>;
}

export interface LibraryContextProviderProps {
  /** pass a stable object (module level): a new one builds a new writer and re-renders consumers */
  repository: LibraryRepository;
  /**
   * told of each retired value, in the commit that retires it, before the effects of the parents
   * run. read when the value retires: a new function never retires the live value
   */
  onRetired?: (retired: RetiredLibrary) => void;
  /**
   * the app foreground (src/platform/app-state.ts on mobile): going to the background writes the
   * live writer's pending coalesced changes at once (flushAll), so a killed app loses none of
   * them. pass a stable function (module level): a new one subscribes again
   */
  subscribeToForeground?: ForegroundSubscription | undefined;
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
 * they were made for, and once they settled its queries are removed again; on unmount too. each
 * retired value is reported to `onRetired` with the promise of that flush. an extra effect cleanup
 * of a live value (StrictMode, Activity) flushes and reports it too, but never removes its queries
 */
export function LibraryContextProvider({
  repository,
  onRetired,
  subscribeToForeground,
  children,
}: LibraryContextProviderProps) {
  const queryClient = useQueryClient();
  const value = useMemo((): LibraryContextValue => {
    const scope = nextLibraryScope();
    return { repository, writer: createLibraryWriter({ queryClient, repository, scope }), scope };
  }, [queryClient, repository]);

  // the latest callback, set during the commit: not an effect dependency, so a new one never
  // retires the live value
  const onRetiredRef = useRef(onRetired);
  useLayoutEffect(() => {
    onRetiredRef.current = onRetired;
  }, [onRetired]);

  // the value whose effect is set up, null between a cleanup and the next setup: StrictMode and
  // Activity run a cleanup of the live value then set it up again in the same commit
  const currentRef = useRef<LibraryContextValue | null>(null);
  useEffect(() => {
    currentRef.current = value;
    return () => {
      currentRef.current = null;
      const { repository: retired, writer, scope } = value;
      // no mounted hook reads a retired scope any more: its fetches are cancelled, its entries
      // leave. checked after the commit, so a cleanup of the live value removes nothing
      const removeScope = (): void => {
        if (currentRef.current !== value) {
          queryClient.removeQueries({ queryKey: queryKeys.library.all(scope) });
        }
      };
      void Promise.resolve().then(removeScope);
      // never rejects: a failed write already reached the action that made it. a flushed write
      // that succeeded set its entry again, so the scope is removed once more after it
      const flushed = writer.flushAll();
      void flushed.then(removeScope);
      onRetiredRef.current?.({ repository: retired, flushed });
    };
  }, [queryClient, value]);

  // the background: the live writer's pending coalesced writes leave now, those of the account
  // library reaching its write-ahead queue (ADR-0017). one subscription for every value
  useEffect(() => {
    if (subscribeToForeground === undefined) {
      return undefined;
    }
    return subscribeToForeground((foreground) => {
      if (!foreground) {
        void currentRef.current?.writer.flushAll();
      }
    });
  }, [subscribeToForeground]);

  return <LibraryContext value={value}>{children}</LibraryContext>;
}

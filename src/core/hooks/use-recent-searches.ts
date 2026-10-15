import { use, useCallback, useMemo, useRef, useState } from 'react';

import { addRecentSearch } from '../domain/recent-searches';
import {
  MISSING_RECENT_SEARCHES_PROVIDER_MESSAGE,
  RecentSearchesContext,
} from './recent-searches-context';

export interface RecentSearches {
  /** prepared queries, newest first (FR-02) */
  readonly searches: readonly string[];
  /** records a prepared query (prepareSearchQuery) as the newest search, and stores the list */
  readonly add: (query: string) => void;
  /** empties the list, the stored one included */
  readonly clear: () => void;
}

const NO_SEARCHES: readonly string[] = [];

/**
 * the recent searches of the nearest RecentSearchesContextProvider, with `add` and `clear`;
 * throws outside of it. the list is read synchronously on mount, so the first frame shows it.
 * `add` and `clear` are stable. personal data: never logged. the state belongs to this hook
 * instance
 */
export const useRecentSearches = (): RecentSearches => {
  const repository = use(RecentSearchesContext);
  if (repository === null) {
    throw new Error(MISSING_RECENT_SEARCHES_PROVIDER_MESSAGE);
  }
  const [searches, setSearches] = useState(() => repository.load());
  // the latest list, so two calls before a render both apply: a closure would see a stale list
  const latestRef = useRef(searches);

  // each change is stored first, then shown
  const add = useCallback(
    (query: string) => {
      const next = addRecentSearch(latestRef.current, query);
      repository.save(next);
      latestRef.current = next;
      setSearches(next);
    },
    [repository],
  );
  const clear = useCallback(() => {
    repository.clear();
    latestRef.current = NO_SEARCHES;
    setSearches(NO_SEARCHES);
  }, [repository]);

  return useMemo(() => ({ searches, add, clear }), [searches, add, clear]);
};

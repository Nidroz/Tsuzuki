import type { ReactNode } from 'react';

import type { RecentSearchesRepository } from '../repositories/recent-searches-repository';
import { RecentSearchesContext } from './recent-searches-context';

export interface RecentSearchesContextProviderProps {
  /** pass a stable object (module level): a new one re-renders every consumer */
  repository: RecentSearchesRepository;
  children: ReactNode;
}

/** gives the tree the recent searches repository; useRecentSearches reads it */
export function RecentSearchesContextProvider({
  repository,
  children,
}: RecentSearchesContextProviderProps) {
  return <RecentSearchesContext value={repository}>{children}</RecentSearchesContext>;
}

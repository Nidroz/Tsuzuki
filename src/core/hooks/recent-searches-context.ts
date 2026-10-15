import { createContext } from 'react';

import type { RecentSearchesRepository } from '../repositories/recent-searches-repository';

/** the recent searches repository, set by RecentSearchesContextProvider */
export const RecentSearchesContext = createContext<RecentSearchesRepository | null>(null);

export const MISSING_RECENT_SEARCHES_PROVIDER_MESSAGE =
  'useRecentSearches is used outside RecentSearchesContextProvider: render the tree inside RecentSearchesContextProvider';

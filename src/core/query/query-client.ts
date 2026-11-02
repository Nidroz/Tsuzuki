import { QueryClient } from '@tanstack/react-query';

import { LIBRARY_KEY_ROOT, SEARCH_KEY_ROOT } from './keys';
import { PERSISTED_CACHE_MAX_AGE, SEARCH_GC_TIME, STALE_TIMES } from './stale-times';

/**
 * a new query client per call (no module singleton): the composition root owns the app one,
 * each test builds its own.
 */
export const createQueryClient = (): QueryClient => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // at least the persister max age, or restored queries are garbage collected right away
        gcTime: PERSISTED_CACHE_MAX_AGE,
        // retries and backoff belong to the catalog http client in src/core/catalog/http/,
        // not to the cache
        retry: false,
      },
    },
  });
  // every search key gets the search lifetimes, a page written with setQueryData (the next page
  // prefetch) included, not the default gc time of the persisted queries
  client.setQueryDefaults([SEARCH_KEY_ROOT], {
    staleTime: STALE_TIMES.search,
    gcTime: SEARCH_GC_TIME,
  });
  // library queries never pause offline (ADR-0017): the guest store never needs the network, and
  // the offline account library answers from its device copy itself. catalog queries keep the
  // default 'online' mode: offline they pause instead of failing, and keep their success state
  client.setQueryDefaults([LIBRARY_KEY_ROOT], { networkMode: 'always' });
  return client;
};

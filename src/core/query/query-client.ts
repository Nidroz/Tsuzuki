import { QueryClient } from '@tanstack/react-query';

import { PERSISTED_CACHE_MAX_AGE } from './stale-times';

/**
 * a new query client per call (no module singleton): the composition root owns the app one,
 * each test builds its own.
 */
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // at least the persister max age, or restored queries are garbage collected right away
        gcTime: PERSISTED_CACHE_MAX_AGE,
        // provider retries and backoff belong to the shared rate limiter (C-02), not to the cache
        retry: false,
      },
    },
  });

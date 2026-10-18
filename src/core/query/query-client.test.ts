import { describe, expect, it } from '@jest/globals';

import { queryKeys } from './keys';
import { createQueryClient } from './query-client';
import { PERSISTED_CACHE_MAX_AGE, SEARCH_GC_TIME, STALE_TIMES } from './stale-times';

describe('createQueryClient', () => {
  it('keeps queries as long as the persisted cache and never retries', () => {
    const queries = createQueryClient().getDefaultOptions().queries;
    expect(queries?.gcTime).toBe(PERSISTED_CACHE_MAX_AGE);
    expect(queries?.retry).toBe(false);
  });

  it('gives a search page written with setQueryData the search lifetimes', () => {
    const client = createQueryClient();
    const key = queryKeys.search('mal', { kind: 'anime', query: 'frieren', page: 2 });

    client.setQueryData(key, { items: [], page: 2, lastPage: 2, hasNextPage: false });

    // the stored query got the search gc time; observers of the key get its stale time
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    expect(query?.options.gcTime).toBe(SEARCH_GC_TIME);
    expect(client.getQueryDefaults(key).staleTime).toBe(STALE_TIMES.search);
  });

  it('keeps the default lifetimes for keys outside the search root', () => {
    const client = createQueryClient();
    const key = queryKeys.top('mal', 'anime', 1);

    client.setQueryData(key, { items: [], page: 1, lastPage: 1, hasNextPage: false });

    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    expect(query?.options.gcTime).toBe(PERSISTED_CACHE_MAX_AGE);
    expect(client.getQueryDefaults(key).staleTime).toBeUndefined();
  });

  it('returns a new client on each call', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });

  it('does not share the cache between clients', () => {
    const first = createQueryClient();
    first.setQueryData(['library'], []);
    expect(createQueryClient().getQueryData(['library'])).toBeUndefined();
  });
});

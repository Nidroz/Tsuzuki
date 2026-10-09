import { describe, expect, it } from '@jest/globals';

import { createQueryClient } from './query-client';
import { PERSISTED_CACHE_MAX_AGE } from './stale-times';

describe('createQueryClient', () => {
  it('keeps queries as long as the persisted cache and never retries', () => {
    const queries = createQueryClient().getDefaultOptions().queries;
    expect(queries?.gcTime).toBe(PERSISTED_CACHE_MAX_AGE);
    expect(queries?.retry).toBe(false);
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

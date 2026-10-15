import { describe, expect, it } from '@jest/globals';

import { PERSISTED_CACHE_MAX_AGE, SEARCH_GC_TIME, STALE_TIMES } from './stale-times';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe('STALE_TIMES', () => {
  it('matches the cache durations of the architecture', () => {
    expect(STALE_TIMES).toStrictEqual({
      mediaDetail: DAY_MS,
      top: 6 * HOUR_MS,
      season: 6 * HOUR_MS,
      search: 10 * MINUTE_MS,
      genres: 7 * DAY_MS,
      library: 0,
    });
  });
});

describe('PERSISTED_CACHE_MAX_AGE', () => {
  it('is 7 days', () => {
    expect(PERSISTED_CACHE_MAX_AGE).toBe(7 * DAY_MS);
  });

  it('is at least every stale time', () => {
    for (const staleTime of Object.values(STALE_TIMES)) {
      expect(PERSISTED_CACHE_MAX_AGE).toBeGreaterThanOrEqual(staleTime);
    }
  });
});

describe('SEARCH_GC_TIME', () => {
  it('is 30 minutes', () => {
    expect(SEARCH_GC_TIME).toBe(30 * MINUTE_MS);
  });

  it('keeps an unused search at least as long as it stays fresh', () => {
    expect(SEARCH_GC_TIME).toBeGreaterThanOrEqual(STALE_TIMES.search);
  });
});

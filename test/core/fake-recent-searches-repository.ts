// an in-memory test double of the recent searches repository (src/core/repositories/), for tests
// of code that reads and records recent searches without any storage
import { jest } from '@jest/globals';

import type { RecentSearchesRepository } from '@core/repositories/recent-searches-repository';

const NO_SEARCHES: readonly string[] = [];

/**
 * a repository over an in-memory list, `initial` at first: its methods are jest mocks, so a test
 * sees the calls, and `stored()` reads the list without calling `load`
 */
export const createFakeRecentSearchesRepository = (initial: readonly string[] = NO_SEARCHES) => {
  let stored = initial;
  return {
    load: jest.fn<RecentSearchesRepository['load']>(() => stored),
    save: jest.fn<RecentSearchesRepository['save']>((searches) => {
      stored = searches;
    }),
    clear: jest.fn<RecentSearchesRepository['clear']>(() => {
      stored = NO_SEARCHES;
    }),
    stored: (): readonly string[] => stored,
  } satisfies RecentSearchesRepository & { readonly stored: () => readonly string[] };
};

export type FakeRecentSearchesRepository = ReturnType<typeof createFakeRecentSearchesRepository>;

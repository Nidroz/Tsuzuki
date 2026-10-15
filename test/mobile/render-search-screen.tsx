// renders the search screen with a strict fake catalog provider and an in-memory recent searches
// repository, for the SearchScreen tests. the tests mock expo-router's router themselves
import type { CatalogProvider } from '@core/catalog/catalog-provider';
import type { Language } from '@core/i18n/index';
import { jest } from '@jest/globals';
import { act, screen } from '@testing-library/react-native';

import { createStrictFakeCatalogProvider } from '@core/catalog/__fixtures__/fake-catalog-provider';
import { createFakeRecentSearchesRepository } from '../core/fake-recent-searches-repository';
import { renderWithProviders } from './render-with-providers';
import { SearchScreen } from '@features/search/SearchScreen';

export interface SearchScreenSetup {
  /** what the provider answers to each search; every other method rejects */
  readonly search?: CatalogProvider['search'];
  /** the stored recent searches, newest first */
  readonly recentSearches?: readonly string[];
  readonly language?: Language;
}

/** renders SearchScreen and returns its fake provider and recent searches repository */
export const renderSearchScreen = async ({
  search,
  recentSearches = [],
  language = 'en',
}: SearchScreenSetup = {}) => {
  const provider = createStrictFakeCatalogProvider(search === undefined ? {} : { search });
  const repository = createFakeRecentSearchesRepository(recentSearches);
  await renderWithProviders(<SearchScreen />, {
    language,
    catalogProvider: provider,
    recentSearchesRepository: repository,
  });
  return { provider, repository };
};

/** the search field */
export const searchInput = () => screen.getByTestId('search-input');

// a debounced text renders, its query starts in an effect, the provider settles, then tanstack
// query notifies its observers on a zero-delay timer: each step needs its own round
const SETTLE_ROUNDS = 3;

/** advances the fake clock by `ms`, then lets the resulting renders, queries and promises settle */
export const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
  for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
  }
};

/** a search that never settles by itself: it rejects when its signal aborts */
export const pendingUntilAborted: CatalogProvider['search'] = (_params, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });

import { jest } from '@jest/globals';

import {
  createStrictFakeCatalogProvider,
  EMPTY_PAGE,
} from '@core/catalog/__fixtures__/fake-catalog-provider';
import type * as JikanProvider from '@core/catalog/jikan/jikan-catalog-provider';

/**
 * the jikan provider module whose factory always returns one strict fake provider, so the
 * composition root gets no http. the Discover route, the initial tab, gets an empty top list; every
 * other method rejects until the test sets it up (`createJikanCatalogProvider(...)` returns that
 * provider). use it from a jest.mock factory:
 * `jest.mock('@core/catalog/jikan/jikan-catalog-provider', () => jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule())`
 */
export const fakeJikanModule = (): typeof JikanProvider => {
  const provider = createStrictFakeCatalogProvider({
    getTop: () => Promise.resolve(EMPTY_PAGE),
  });
  return {
    ...jest.requireActual<typeof JikanProvider>('@core/catalog/jikan/jikan-catalog-provider'),
    createJikanCatalogProvider: () => provider,
  };
};

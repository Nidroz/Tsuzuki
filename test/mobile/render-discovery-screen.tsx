// renders the discovery screen with a strict fake catalog provider, for the DiscoveryScreen tests.
// the tests mock expo-router's router themselves
import type { CatalogProvider } from '@core/catalog/catalog-provider';
import type { Language } from '@core/i18n/index';

import { createStrictFakeCatalogProvider } from '@core/catalog/__fixtures__/fake-catalog-provider';
import { DiscoveryScreen } from '@features/discovery/DiscoveryScreen';
import {
  answersEverySeasonPage,
  answersEveryTopPage,
} from '@features/discovery/__fixtures__/discovery-pages';
import { renderWithProviders } from './render-with-providers';

// the same clock and settle steps as the search screen
export { advance } from './render-search-screen';

export interface DiscoveryScreenSetup {
  /** what the provider answers to each top request; every page by default */
  readonly getTop?: CatalogProvider['getTop'];
  /** what the provider answers to each season request; every page by default */
  readonly getCurrentSeason?: CatalogProvider['getCurrentSeason'];
  readonly language?: Language;
}

/** renders DiscoveryScreen and returns its fake provider, whose other methods reject */
export const renderDiscoveryScreen = async ({
  getTop = answersEveryTopPage,
  getCurrentSeason = answersEverySeasonPage,
  language = 'en',
}: DiscoveryScreenSetup = {}) => {
  const provider = createStrictFakeCatalogProvider({ getTop, getCurrentSeason });
  await renderWithProviders(<DiscoveryScreen />, { language, catalogProvider: provider });
  return { provider };
};

type FakeProvider = ReturnType<typeof createStrictFakeCatalogProvider>;

/** the params of the foreground top requests, in order: the prefetches pass a background priority */
export const foregroundTops = (provider: FakeProvider) =>
  provider.getTop.mock.calls
    .filter(([, , options]) => options?.priority !== 'background')
    .map(([params]) => params);

/** the pages of the foreground season requests, in order */
export const foregroundSeasons = (provider: FakeProvider) =>
  provider.getCurrentSeason.mock.calls
    .filter(([, , options]) => options?.priority !== 'background')
    .map(([page]) => page);

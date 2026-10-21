// a catalog provider of jest mocks and sample results, for tests of code that wraps or uses a
// provider without any http
import { jest } from '@jest/globals';

import type { CatalogProvider, MediaDetail, MediaSummary, Page } from '../catalog-provider';

/** the instance id of the fake provider. */
export const FAKE_INSTANCE_ID = 'fake-instance';

/** the search text limit of the fake provider, unlike any real one so forwarding shows. */
export const FAKE_SEARCH_QUERY_MAX_LENGTH = 42;

/** the genre id limit of the fake provider, unlike any real one so forwarding shows. */
export const FAKE_SEARCH_GENRES_MAX = 7;

/** the image hosts of the fake provider, unlike any real one so forwarding shows. */
export const FAKE_IMAGE_HOSTS: readonly string[] = ['images.fake.test'];

/** an empty first page. */
export const EMPTY_PAGE: Page<MediaSummary> = {
  items: [],
  page: 1,
  lastPage: 1,
  hasNextPage: false,
};

/** a clean anime detail, mal id 1. */
export const SAMPLE_DETAIL: MediaDetail = {
  key: { namespace: 'mal', kind: 'anime', externalId: 1 },
  title: 'Sample',
  titleEnglish: null,
  imageUrl: null,
  format: 'tv',
  status: 'finished',
  totalUnits: 12,
  score: null,
  year: 2020,
  genres: [],
  isAdult: false,
  synopsis: null,
  titleNative: null,
};

/** a provider of the mal namespace whose methods are jest mocks without an implementation. */
export const createFakeCatalogProvider = () =>
  ({
    namespace: 'mal',
    instanceId: FAKE_INSTANCE_ID,
    searchQueryMaxLength: FAKE_SEARCH_QUERY_MAX_LENGTH,
    searchGenresMax: FAKE_SEARCH_GENRES_MAX,
    imageHosts: FAKE_IMAGE_HOSTS,
    search: jest.fn<CatalogProvider['search']>(),
    getDetail: jest.fn<CatalogProvider['getDetail']>(),
    getTop: jest.fn<CatalogProvider['getTop']>(),
    getCurrentSeason: jest.fn<CatalogProvider['getCurrentSeason']>(),
    getGenres: jest.fn<CatalogProvider['getGenres']>(),
  }) satisfies CatalogProvider;

/** the methods of a catalog provider, which a strict fake answers. */
export type CatalogProviderMethods = Pick<
  CatalogProvider,
  'search' | 'getDetail' | 'getTop' | 'getCurrentSeason' | 'getGenres'
>;

/** the rejection of a strict fake method the test did not set up. */
export const unexpectedCallMessage = (method: keyof CatalogProviderMethods): string =>
  `unexpected call to the fake catalog provider: ${method}`;

const rejectUnexpected = (method: keyof CatalogProviderMethods) => (): Promise<never> =>
  Promise.reject(new Error(unexpectedCallMessage(method)));

/**
 * createFakeCatalogProvider whose methods run the given `overrides`, every other method rejecting
 * with an error naming it: a test states the calls it expects. the methods stay jest mocks
 */
export const createStrictFakeCatalogProvider = (
  overrides: Partial<CatalogProviderMethods> = {},
) => {
  const provider = createFakeCatalogProvider();
  provider.search.mockImplementation(overrides.search ?? rejectUnexpected('search'));
  provider.getDetail.mockImplementation(overrides.getDetail ?? rejectUnexpected('getDetail'));
  provider.getTop.mockImplementation(overrides.getTop ?? rejectUnexpected('getTop'));
  provider.getCurrentSeason.mockImplementation(
    overrides.getCurrentSeason ?? rejectUnexpected('getCurrentSeason'),
  );
  provider.getGenres.mockImplementation(overrides.getGenres ?? rejectUnexpected('getGenres'));
  return provider;
};

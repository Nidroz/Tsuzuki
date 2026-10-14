// a catalog provider of jest mocks and sample results, for tests of code that wraps or uses a
// provider without any http
import { jest } from '@jest/globals';

import type { CatalogProvider, MediaDetail, MediaSummary, Page } from '../catalog-provider';

/** the instance id of the fake provider. */
export const FAKE_INSTANCE_ID = 'fake-instance';

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
    search: jest.fn<CatalogProvider['search']>(),
    getDetail: jest.fn<CatalogProvider['getDetail']>(),
    getTop: jest.fn<CatalogProvider['getTop']>(),
    getCurrentSeason: jest.fn<CatalogProvider['getCurrentSeason']>(),
    getGenres: jest.fn<CatalogProvider['getGenres']>(),
  }) satisfies CatalogProvider;

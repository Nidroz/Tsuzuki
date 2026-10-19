import { useMemo } from 'react';

import type { CatalogProvider } from '../catalog/catalog-provider';
import { queryKeys } from '../query/keys';
import { STALE_TIMES } from '../query/stale-times';
import { useCatalogProvider } from './use-catalog-provider';
import {
  LIST_KEY_PAGE,
  usePagedCatalogList,
  type CatalogListOptions,
  type CatalogPageList,
  type PagedCatalogListResult,
} from './use-paged-catalog-list';

export type UseCurrentSeasonOptions = CatalogListOptions;

// the pages of the titles of the current season
const seasonList = (provider: CatalogProvider): CatalogPageList => ({
  listKey: queryKeys.season(provider.namespace, LIST_KEY_PAGE),
  pageKey: (page) => queryKeys.season(provider.namespace, page),
  fetchPage: (page, ...request) => provider.getCurrentSeason(page, ...request),
  staleTime: STALE_TIMES.season,
});

/**
 * one page of the titles of the current season (FR-05, usePagedCatalogList). while another page
 * loads, the page before stays as placeholder data
 */
export const useCurrentSeason = (
  page: number,
  { showAdult }: UseCurrentSeasonOptions,
): PagedCatalogListResult => {
  const provider = useCatalogProvider();
  const list = useMemo(() => seasonList(provider), [provider]);
  return usePagedCatalogList({ list, page }, { showAdult, placeholder: 'same-list' });
};

import { useMemo } from 'react';

import type { CatalogProvider, SearchParams } from '../catalog/catalog-provider';
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

/** how long the search text stays unchanged before it is searched (FR-01), in milliseconds */
export const SEARCH_DEBOUNCE_MS = 400;

export type UseSearchOptions = CatalogListOptions;

// the pages of the search `params`, whatever its page. the query defaults of the search keys add
// the search gc time (query-client.ts)
const searchList = (provider: CatalogProvider, params: SearchParams): CatalogPageList => ({
  listKey: queryKeys.search(provider.namespace, { ...params, page: LIST_KEY_PAGE }),
  pageKey: (page) => queryKeys.search(provider.namespace, { ...params, page }),
  fetchPage: (page, ...request) => provider.search({ ...params, page }, ...request),
  staleTime: STALE_TIMES.search,
});

/**
 * one page of catalog search results for `params` (usePagedCatalogList). null searches nothing:
 * the query stays idle under its own key, without data. the results of the search just before
 * stay as placeholder data while a new key loads, whatever search they belong to, never across an
 * idle state: after a cleared field, a new search starts without results
 */
export const useSearch = (
  params: SearchParams | null,
  { showAdult }: UseSearchOptions,
): PagedCatalogListResult => {
  const provider = useCatalogProvider();
  const list = useMemo(
    () => (params === null ? null : searchList(provider, params)),
    [provider, params],
  );
  return usePagedCatalogList(
    list === null || params === null
      ? { list: null, idleKey: queryKeys.searchIdle(provider.namespace) }
      : { list, page: params.page },
    { showAdult, placeholder: 'previous-key' },
  );
};
